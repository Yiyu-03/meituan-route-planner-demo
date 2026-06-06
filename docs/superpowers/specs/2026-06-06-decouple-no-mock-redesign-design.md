# 设计文档：前后端解耦 · 去 Mock · 产品化重设

- 日期：2026-06-06
- 状态：待用户审阅
- 范围：把"本地生活路线规划"从 hackathon demo 改造为可小规模生产使用的产品

---

## 1. 背景与目标

当前项目是一个 Vite + React 的 demo，存在三个结构问题：

1. **Agent loop（推荐工程）跑在前端** `src/engine/`：打分/组合/校验/修复逻辑暴露在浏览器 bundle 里，且依赖 mock POI 数据。
2. **两套规划逻辑并存**：前端 `src/engine`（确定性 + mock 数据）与后端 `api/ai/plan.js`（LLM 主导 + 高德真 POI），逻辑会漂移。
3. **大量 mock**：前端 mock POI 库、`server/` 内存版 mock backend、上海兜底假路线、硬编码城市锚点。

### 目标

- **前后端彻底解耦**：agent loop 只在后端；前端只负责展示。
- **通通去 mock**：任何地方不许出现 mock 数据或伪造的 POI 特征。
- **可小规模生产**：真实数据源（高德）、真实持久化（Neon Postgres）、真实账户（用户名/密码）。
- **并行开发**：拆成两条 git worktree（后端 / 前端），靠冻结的契约并行推进。

### no-mock 数据政策（贯穿全文）

数据合法性按来源判定：

| 来源 | 是否合法 | 例子 |
|---|---|---|
| 高德真实返回 | ✅ | rating、cost(人均)、营业时间、坐标、tag、照片、电话 |
| 用户输入 / 用户预先选择 | ✅ | 自然语言里的预算/时间/人数/规避；用户选的画像、偏好、必去类目、节奏 |
| 由上述两者规则推导 | ✅（需标注"估算"） | 场景标签从高德 tag 映射；停留时长由用户时长+节奏反推 |
| 凭空造的 per-POI 默认值 | ❌ 禁止 | 假点评数、假排队指数、给无数据的店编评分 |

高德拿不到、又非用户输入的特征（点评数、排队指数）→ 从模型中删除并重分配权重，**绝不填默认值**。前端对应的"排队风险"卡片一并删除。

---

## 2. 总体架构

```
┌─────────────────────────┐        ┌─────────────────────────────┐
│  worktree B (前端)       │        │   worktree A (后端)          │
│  Vite 静态站             │        │   Vercel Functions(无状态)   │
│  ─ /login + /app 分离    │        │   ─ agent loop(确定性骨架)   │
│  ─ 高德 JS 地图          │ ─SSE─  │   ─ 高德真 POI + 缓存        │
│  ─ 手帐编辑感 UI         │  契约  │   ─ DeepSeek 点缀(意图/解释) │
│  ─ 消费 SSE 流           │        │   ─ Neon Postgres            │
└─────────────────────────┘        └─────────────────────────────┘
            │                                     │
            └──────────────► contract/ ◄──────────┘
              共享：TS 类型 + SSE 事件 zod schema + SSE fixtures
```

### 运行时与部署（Vercel）

- 部署目标：**Vercel Functions（Node runtime）+ Fluid Compute**。Vercel 无常驻 VM，但本产品（偶发规划 + 流式）无需常驻机器。
- `vercel.json` 设 `maxDuration: 60`，配合 Fluid Compute，解决旧版 10s 超时被 kill 的问题。
- 函数无状态：禁止内存态，所有持久化进 Neon Postgres。
- 前端为纯静态站（`dist/`）；后端为 `api/` 下一组无状态函数。

---

## 3. 接缝：`contract/`（必须最先冻结）

两条 worktree 并行不漂移的唯一前提。位于仓库根，双方 import。

```
contract/
  types.ts      # Constraints / ScoredPOI / RouteNode / Route / PlanResult（从 src/types 抽取）
  events.ts     # SSE 事件的 zod schema（运行时校验）
  fixtures/     # 录制的真实 SSE 流（前端离线开发用）
```

### SSE 契约 · `POST /api/plan`（`text/event-stream`）

请求体（字段全部来自用户输入/选择）：

```jsonc
{
  "request": "周末下午在静安找个安静咖啡，再吃顿本帮菜，人均300内",
  "preferences": {
    "personaPick": "auto|couple|family|friends|solo",
    "prefs": ["quiet","budget"],
    "budgetPref": null
  },
  "previousPlan": null,        // replan 时传上一版，实现"只改必要节点"
  "sessionId": "可选"
}
```

认证：登入后由 `Authorization: Bearer <sessionToken>` 携带（访客为匿名 device token）。

SSE 事件序列：

| event | 何时发 | data 关键字段 | 前端用途 |
|---|---|---|---|
| `stage` | 每个 loop 步骤始/末 | `{key,label,status,ms,summary}` | 点亮进度条 |
| `constraints` | 解析完意图 | 结构化约束对象 | 顶部"已理解" chips |
| `candidates` | 召回+打分后 | `ScoredPOI[]`（含真照片/坐标） | 地图撒点 + 候选 |
| `route` | 确定性路线算完（秒级） | `{route}` | 立刻渲染地图路线 + 时间轴 |
| `explanation` | LLM 解释流式返回（后到） | `{routeId, delta}` | 推荐理由打字式补入 |
| `done` | 全部完成、已落库 | `{planId, routes, dataSources}` | 存历史、数据来源面板 |
| `error` | 任一硬失败 | `{code, message, recoverable}` | 诚实空态 |

关键时序：`route` 在确定性骨架跑完后**秒级先到**，用户立刻看到地图与路线；`explanation` 由 DeepSeek 慢慢流，不阻塞。

错误码（替代假路线）：`needs-clarification`（城市不明）/ `insufficient-data`（高德真实 POI < 2）/ `upstream-unavailable`（高德/LLM 不可用）。

---

## 4. 后端子设计（worktree A）

### 目录结构

```
api/
  plan.js                      # POST /api/plan —— SSE 编排入口
  auth/ register.js  login.js  guest.js  me.js
  history/ index.js  [id].js
  lib/
    agent/
      loop.js          # 编排 stages，发 SSE 事件
      understand.js    # LLM 小调用：意图 + 高德搜索关键词（关键路径）
      retrieve.js      # 高德召回 + 缓存 + 特征提取
      score.js         # 移植 scorePOIs（no-mock 特征集）
      build.js         # 移植 beam search 组合
      validate.js      # 移植校验（删排队项）
      repair.js  rank.js
      explain.js       # DeepSeek 流式解释 + 确定性兜底文案
      persona.js       # 画像/场景权重（用户选择驱动）
    amap/  client.js  poiFeatures.js  cache.js
    deepseek/ client.js
    db/    schema.sql  client.js  users.js  plans.js  history.js
    sse.js  errors.js  auth.js（bcrypt + session）
vercel.json
```

### Agent loop：确定性骨架在中间，LLM 点缀在两头

```
resolveLocation(高德地名解析)        ← 复用现有 api/lib/locationResolver.js
  → understand   LLM 小调用(1~2s)：自然语言+偏好 → 结构化约束 + 搜索关键词
  → retrieve     高德 place/text 按关键词搜 → 真实店名 + 缓存          ┐
  → score        确定性打分                                            │ 关键路径
  → build        beam search 组合                                      │ 无 LLM
  → validate     约束体检                                              │ → route 秒级 SSE
  → repair       自动修复                                              ┘
  → explain      DeepSeek 流式写推荐理由（后到，不阻塞）
  → 落库 → done
```

**LLM 角色**：
1. `understand`（关键路径，小输出，快）：把"安静能接电话的咖啡"翻译成高德搜索关键词 + 结构化约束。**替代**原 `keywordsFor()` 的正则与硬编码城市锚点。输出极小（几十 token），约 1~2s。
2. `explain`（关键路径之外，流式）：把结构化结果写成中文推荐理由，流式吐 token。

**确定性骨架**（移植自 `src/engine`，喂高德真数据）：打分、组合、校验、修复。预算/营业/距离这些 LLM 算不准的硬约束由代码严守。

### 检索：关键认知

POI 查询**不需要提前知道店名**——给高德"类目/区域/氛围词"，它返回具体真实店。所以店名来自高德，不是 LLM 编造、不是硬编码。

### 高德数据层与特征映射

实测 `GET /v5/place/text?show_fields=business,photos` 返回：

| 推荐引擎特征 | 高德是否提供 | 处置 |
|---|---|---|
| 评分 rating | ✅ | 直接用（quality） |
| 人均 cost | ✅ | 直接用（budgetFit） |
| 营业时间 | ✅ | 直接用（open 校验） |
| 坐标 location | ✅ | 直接用（proximity） |
| 类目 type/typecode | ✅ | 直接用 |
| 标签 tag | ✅ | 规则映射场景标签（标"估算"） |
| 照片 photos | ✅ | 前端展示 |
| 电话 tel | ✅ | 订座/拨打 |
| 点评数 reviews | ❌ | **删除 popularity 特征** |
| 排队指数 queue | ❌ | **删除 queue 特征与卡片** |

打分权重在删除 popularity/queue/ugc 后重新分配给 quality 与 prefMatch。

### POI 搜索缓存（守 5000 次/月搜索额度）

- 高德个人认证：地图加载 150 万/月（够），但**基础搜索仅 5000/月**，是瓶颈。
- `amap/cache.js`：搜索结果缓存进 `poi_cache(key, payload jsonb, fetched_at)`，key = 规范化(城市+关键词+类目)，TTL 14~30 天。命中缓存不再调高德。
- 步行腿结果同样缓存（坐标取整）。
- 缓存命中/穿透在 `dataSources` 中如实标注。

### DeepSeek 客户端

- 默认模型 `deepseek-v4-flash`（实测 JSON 模式 ~8.8s；用于流式解释不阻塞）。
- 超时提到 ~20s；处理 `reasoning_content`（v4 系列为推理模型）。
- `explain` 流式吐 token 进 `explanation` 事件。
- `understand` 用最小 prompt + 小 max_tokens 控制在 1~2s。

### 持久化（Neon Postgres）

```sql
users(id, username UNIQUE, password_hash, prefs jsonb, budget_pref, created_at)
sessions(token PK, user_id, expires_at)
guests(device_token PK, prefs jsonb, created_at)        -- 访客匿名身份
plans(id, user_id NULL, device_token NULL, request, constraints jsonb,
      routes jsonb, data_sources jsonb, created_at)
poi_cache(key PK, payload jsonb, fetched_at)            -- 守额度
```

### 认证（用户名 + 密码，零外部服务）

- `auth/register.js`：用户名 + 密码（bcrypt 哈希存 Neon）。
- `auth/login.js`：校验 → 签发 session token。
- `auth/guest.js`：签发匿名 device token（访客）。
- `auth/me.js`：当前身份。
- **找回密码小规模暂不做**（需邮件服务）；后续如接邮件再加。
- 登入后匿名历史（device_token 关联）迁移到 user。

---

## 5. 前端子设计（worktree B）

### 核心原则：前端零规划逻辑

删除 `src/engine`、`src/data`、`src/mock`。前端只做：发请求、收 SSE、渲染。

### 路由与登入页（与服务分离）

- `/login`（独立登入页）和 `/app`（规划服务）是两个页面。
- `AuthGate` 守卫：未登入访问 `/app` → 重定向 `/login`。
- 登入页形态：**硬门槛 + 访客入口**——用户名/密码登入、注册、「访客继续」三个入口。登入页本身按 v2 手帐美学做，给"翻开手帐第一页"的仪式感。

### 目录结构

```
src/
  api/    planStream.ts(SSE 客户端)  auth.ts  history.ts
  map/    AmapProvider.tsx(加载高德 JS SDK，独立 JS key)  RouteMap.tsx
  components/
    InputBar.tsx  ProgressTrail.tsx  PlanSummary.tsx
    Itinerary.tsx  StopCard.tsx  WhyDrawer.tsx
    AccountMenu.tsx  EmptyState.tsx
  views/  LoginView.tsx  PlannerView.tsx
  design/ tokens.css(设计 token)  icons.tsx(lucide-react 封装)
  types/  → 从 contract import
```

### 布局（已选定：地图主视图）

- 桌面：左侧地图占主区（路线 polyline + 编号 marker），右侧行程时间轴。
- 移动：地图占顶，行程用 bottom sheet 上拉覆盖；顶部常驻输入框 + 轻量进度条。

### 流式渲染体验

`stage`→进度点亮；`candidates`→地图撒点；`route`(2~3s)→画路线 + 出时间轴；`explanation`→每张卡推荐理由打字式补入；`error`→ EmptyState 诚实空态。

### 针对产品审查的改法

| 审查发现 | 改法 |
|---|---|
| 没有地图 | 地图升为主视图（高德 JS 真瓦片） |
| 像调试面板 | 结果优先；agent trace/约束/数据来源/修复记录全收进 WhyDrawer |
| 输入引导弱 | InputBar 结构化提示 + 一键示例 + 画像/偏好 chips |
| 建议调整可操作性差 | 校验 warn/fail 挂到对应 StopCard，旁边给"换一家" |
| 账户形同虚设 | 独立登入页 + AccountMenu + 历史同步 |
| 主次不分 | StopCard 只留用户动作（导航/订座/电话/收藏） |
| 移动端挤 | 移动优先 bottom sheet |

补 no-mock：删"排队风险"卡片；StopCard 每字段标来源（`高德`/`估算`）。

### v2 设计规范（手帐编辑感，已用户确认）

固化为 `design/tokens.css`，React 用 `lucide-react`：

- **品牌**：`漫游·手帐 / Stroll · Shanghai`；朱砂红印章 logo（非"圆角方块塞图标"）。
- **字体**：标题/手写感文案 `LXGW WenKai`（霞鹜文楷）；拉丁字与数字 `Fraunces`（斜体）；正文 `Noto Sans SC`。
- **配色**：暖纸基底 `#efe7d4` / 卡片 `#fbf6ea` / 墨黑 `#241f17` / 主强调朱砂红 `#bb3a2c` / 次琥珀 `#bd7c22` / 鼠尾草 `#5e7757`。单一主强调色，不均匀铺色。
- **材质**：横格纸底纹 + 细颗粒噪点 + 胶带 + 印章盖戳。
- **图片**：门店真实照片以拍立得样式呈现（白边、微旋转、压胶带）——去 AI 味的最强杠杆。
- **图标**：lucide 线性图标，禁用 emoji。
- 三站点圆点墨黑/朱砂/鼠尾草，与地图 pin 颜色对应。

### 高德地图（前端）

- 需**单独申请高德 JS API key**（Web 端，配安全密钥 + 域名白名单），与后端 Web 服务 key 分开。
- 地图加载 150 万/月免费额度，展示成本可忽略。
- ⚠️ 合规：JS API 非商用免费，商用需向高德获取商用授权，上线前确认。

---

## 6. 本地开发 / 测试

- **后端 A**：`vercel dev` 读 `.env.local`（key 已注入）+ Neon dev branch（或本地 Postgres）。测试：① agent loop 各函数单测（参照冒烟脚本模式）；② 契约一致性测试（zod 校验 SSE 输出）。
- **前端 B**：`npm run dev` 对着 `contract/fixtures/` 录好的真实 SSE 流跑，不依赖后端、不烧高德额度；另设开关指向 `vercel dev` 联调。
- **接缝守护**：共享契约测试，后端 SSE 输出与前端 fixtures 都须通过同一 zod schema，漂移即红。

---

## 7. 迁移 / 废弃清单（no-mock 清理）

- 删 `src/engine`、`src/data`(mock POI)、`src/mock`、`server/`(内存 mock backend)。
- 删 `api/ai/plan.js` 上海兜底假路线 + 硬编码城市锚点。
- 旧 `/api/ai/plan` 收敛为 `/api/plan`(SSE)。
- 保留并复用 `api/lib/locationResolver.js`（高德地名解析）、`api/lib/plannerLogger.js`。
- 删临时脚本 `scripts/smoke-backend.mjs`（或移入正式测试）。

---

## 8. 并行工作流（两条 worktree）

1. 在 main 上一起把 `contract/`（types + events + 初始 fixtures）定稿并提交。
2. 开两条 worktree：`feat/backend-agent-loop`、`feat/frontend-redesign`。
3. 各自对着冻结的契约开发；前端用 fixtures 离线跑。
4. 任一方需改契约 → 回 main 改 `contract/` → 双方同步 → 继续。
5. 后端联调通过契约测试后，前端切到 `vercel dev` 做端到端验证。

---

## 9. 已确认决策清单

- 并行两条 worktree，contract-first。
- 运行时：Vercel Functions + Fluid Compute + maxDuration 60 + SSE + Neon Postgres。
- 数据层：Neon Postgres。
- 认证：用户名 + 密码（bcrypt），独立 `/login` 页（硬门槛 + 访客入口），找回密码暂不做。
- 前端：纯展示 + 高德 JS 地图 + 产品化重设，v2 手帐编辑美学，lucide 图标。
- 后端 loop：确定性骨架 + LLM 两头点缀（understand 关键路径小调用 / explain 流式后补）。
- 去 mock：删除全部 mock 数据/伪造特征/假路线/硬编码锚点；诚实空态。
- 高德：后端 Web 服务 key（POI/路径/地名）+ 前端独立 JS key（地图）；搜索结果强制缓存守 5000/月额度。
- DeepSeek：默认 `deepseek-v4-flash`，超时 20s，处理 reasoning，流式解释。

---

## 10. 待澄清 / 风险

- 高德 JS API 商用授权需确认（合规）。
- 高德 5000 次/月搜索额度：缓存可显著放大，但若上量需升级认证档位或接美团/点评侧数据。
- `understand` 的 LLM 调用在关键路径，需控制延迟（小 prompt、小输出、超时兜底到正则关键词）。
- 找回密码缺失：用户忘密码暂无自助路径，小规模可接受，规模上来需接邮件服务。
