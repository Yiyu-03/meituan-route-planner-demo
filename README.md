# 漫游·手帐 · Stroll Journal

一句自然语言，生成一条**真实可走**的城市漫游路线——并把它做成可分享的手帐。

> 在线体验：<https://meituan-route-planner-demo.vercel.app>

这不是"让大模型编一段攻略文本"。路线是一个结构化对象：经过需求理解 → 真实 POI 召回 → 个性化打分 → 路线组合 → 体检 → 修复 → 排序 → 真实步行/车程接腿，最后由大模型写推荐理由。**全程不编造地点**——候选只来自高德真实 POI，数据不足时如实提示，而不是伪造外地路线。

## 能做什么

- **对话式规划**：输入"成都春熙路，朋友聚会，先火锅再喝咖啡"，Agent 用 ReAct(推理→搜索→观察)实时把思考流式吐给前端；信息确实不足时才反问澄清。
- **真实数据**：高德 Web 服务 POI + 真实步行/驾车路径；DeepSeek 负责理解与文案。带缓存以省配额。
- **基于此方案修改(refine)**：把"第一站火锅换更便宜的""去掉第二站""人均压到 100 以内"这类指令，结合**初始 query + 历史路线**交给大模型做最小改动，并带"改方案"思考流。
- **手帐分享卡**：把各站拍立得照片用朱砂"毛线针"连线缝在一起(缺图自动落 SVG 占位)，一键导出 PNG / 调系统分享。
- **多会话便签墙**：历史方案按账户/访客分别保存，可随时翻回再改。
- **账户**：用户名 + 密码，或访客直接进入。

## 架构(前后端解耦)

```
前端(纯展示)  ──HTTP/SSE──▶  契约层 contract/  ◀──  后端(全部 Agent 逻辑)
Vite+React+TS                 zod 事件 schema        Vercel Serverless Functions
                              (stage/thought/         + Neon Postgres
                               action/observation/    + 高德 Web 服务
                               route/explanation/      + DeepSeek
                               question/done/error)
```

- **契约层 `contract/`**：冻结的 SSE 事件 schema(zod)+ 类型，是前后端唯一接缝。前端只渲染事件，不含任何 Agent 逻辑。
- **后端 `lib/`**：所有规划逻辑。`api/plan` 由 `lib/handlers/plan.ts` 经 esbuild 打包(Vercel 不转译被 import 的 `.ts`)。
- **数据**：Neon Postgres(账户/历史/会话/POI 缓存)、高德(POI + 路径)、DeepSeek(理解 + 文案)。

## Agent 设计

```
ReAct 主循环(对话式新规划)
  reason ──▶ searchPOI │ askUser │ finish
确定性骨架(finish 后复用,也供 refine 复用)
  understand → retrieve → score → build → validate → repair → rank → attachLegs → explain
```

- **确定性骨架**保证路线可行、可解释、可复现;**大模型**只点缀两端(理解关键词、写推荐理由),不直接产出路线，少依赖泛化硬规则。
- **refine**(`lib/agent/loop.ts` 的 replan 分支):带初始 query + 当前各站人均/评分的 LLM 判断要改哪站、按什么标准;换店保子品类(换"更便宜的火锅"仍给火锅)、尊重便宜/高分意图,并发反思事件确保文案与最终路线一致。
- **诚实兜底**:高德不可用或候选不足 → 返回明确错误，绝不编造 POI。

## 技术栈

Vite · React 18 · TypeScript · Tailwind · Vercel Serverless Functions · Neon(`@neondatabase/serverless`)· 高德 Web 服务 & JS API · DeepSeek · zod · html-to-image · Vitest

## 本地开发

```bash
npm install
npm run dev          # Vite 前端(默认走 fixtures 离线数据)
npm test             # Vitest 全量
npm run build        # 打包函数 + tsc + vite build
```

在仓库根创建 `.env.local`(已 gitignore),填入下列变量后即可联真实后端:

```bash
DEEPSEEK_API_KEY=...            # DeepSeek
DEEPSEEK_MODEL=deepseek-v4-flash
AMAP_API_KEY=...               # 高德 Web 服务 key(后端 POI/路径)
VITE_AMAP_JS_KEY=...           # 高德 JS API key(前端地图，独立)
VITE_AMAP_SECURITY_CODE=...    # 高德 JS 安全密钥
DATABASE_URL=postgresql://...  # Neon Postgres
VITE_PLAN_SOURCE=live          # live=连真实后端;fixtures=离线/跑测试
```

> 跑 `npm test` 前把 `VITE_PLAN_SOURCE` 切回 `fixtures`(vitest 会加载 `.env.local`，live 会让前端测试连不上后端而失败)。

## 部署(Vercel)

生产即 staging。用 Vercel CLI 云端构建直传(用真值 env 构建)：

```bash
vercel --prod --yes
```

线上环境变量在 Vercel 项目 `Settings → Environment Variables` 配置(同上述变量名)。

## 目录速览

```
contract/          冻结的 SSE 事件契约(zod) + fixtures
lib/
  agent/           understand/retrieve/score/build/validate/repair/rank/explain
                   react.ts(ReAct 循环) loop.ts(线性 + refine) replan.ts(改方案)
  amap/            高德 client / POI 特征 / 缓存
  handlers/plan.ts api/plan 的真正实现(打包成 api/plan.js)
  db/              Neon 账户 / 历史 / 会话
api/               Vercel 函数:plan / auth / history / img-proxy
src/
  views/           LoginView / PlannerView
  components/      AgentThinking / RefineBar / StitchRouteCard / JournalCard ...
  design/          tokens.css(漫游手帐 v2 设计令牌) / icons.tsx(RoamSeal 印记)
```
