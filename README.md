# 美团 AI Hackathon · 本地生活路线智能规划 Demo

这是一个 Vite + React + TypeScript 的本地生活路线规划 Demo。用户输入一句自然语言出行需求后，系统基于本地 mock POI 数据生成可执行路线，并展示预算、营业、排队、移动成本、推荐理由、备选方案和局部重规划结果。

当前版本的重点不是接真实服务，而是把“本地生活路线 Agent”跑通并讲清楚：路线不是 LLM 直接编出来的攻略文本，而是经过结构化约束抽取、候选召回、个性化排序、路线组合、约束校验和必要修复后生成的路线对象。

## 当前能力

- 自然语言输入：识别城市/区域、时间、人数、预算、偏好、规避条件、交通节奏等。
- 多约束路线：串联 3 个以上 POI，覆盖餐饮、咖啡、文化、娱乐、购物、夜景等本地生活场景。
- 用户画像：支持情侣约会、带娃家庭、朋友聚会、独自闲逛，并可由文本自动推断。
- mock 登录/注册：昵称、出行偏好、预算偏好写入 localStorage。
- 用户 session/history：最近规划记录按 mock userId 分开保存，未登录态也有独立访客归属。
- 偏好注入：安静、省钱、少排队、亲子友好、预算偏好会进入规划输入并影响推荐排序。
- 多轮修改：支持“换一家评分更高的餐厅”“预算降到 300”“不要太赶”等局部 replan。
- 数据来源说明：在“查看规划依据”附录中说明 mock 数据源、Vercel API adapter 和未来可替换的真实接口。
- 独立 mock backend：`server/` 提供 mock auth、mock history、mock POI search 和 mock route estimate，用于说明服务端与数据源接口形态。
- 高德 API adapter 雏形：`api/amap/poi-search` 和 `api/amap/route-walking` 可在 Vercel 配置 `AMAP_KEY` 后调用真实高德 Web 服务。
- 评测脚本：验证路线数量、预算/营业/排队/画像语义护栏、同输入不同画像差异等。

## Agent Loop

核心链路如下：

```text
parseConstraints
  -> retrieveCandidates
  -> scorePOIs
  -> buildRouteCandidates
  -> validateRoute
  -> repair/replan
  -> explainRoute
```

含义：

- `parseConstraints`：抽取区域、时间、同行人数、预算、偏好、规避条件和必去类目。
- `retrieveCandidates`：从本地 mock POI 中按区域、类目、营业和规避条件召回候选。
- `scorePOIs`：结合画像、偏好、预算、距离、UGC、人均和排队风险做个性化排序。
- `buildRouteCandidates`：从前排候选中组合 3-5 个 POI，生成多条候选路线。
- `validateRoute`：检查营业时间、预算、交通时间、步行距离、排队风险、类目覆盖和 POI 数量。
- `repair/replan`：发现硬冲突或收到用户修改时，只替换必要节点，尽量保留路线结构。
- `explainRoute`：把结构化结果转成人能看懂的路线解释、风险提醒和推荐理由。

## 数据源说明

当前路线主流程默认使用本地 mock 数据，保证比赛现场和 Vercel 页面稳定可跑：

- POI：名称、区域、坐标、类目、营业时间、人均、评分、点评数。
- UGC：一句摘要，用于解释推荐亮点和风险提醒。
- 排队：mock queueBase，用于排队风险展示和少排队偏好降权。
- 地图：mock 距离和 ETA，用于移动成本、步行/车程展示和路线校验。

这些字段按真实服务接口形态组织，后续可替换为：

- 高德开放平台：POI 搜索、地理编码、路径规划、距离矩阵、交通态势。
- 美团/点评侧生活数据：UGC、排队、人均、团购、评分、营业、门店履约等。

当前没有接入真实美团/点评交易、排队、UGC、团购数据，也没有真实登录认证或数据库。

## 高德 API Adapter

项目已提供 Vercel Serverless API 雏形，用于说明真实地图/POI 数据源的接入方式。前端主流程不强依赖这些接口；没有配置 key 时，Demo 仍使用本地 mock POI。

接口:

- `GET /api/amap/poi-search?keyword=咖啡&city=上海&area=新天地`
- `GET /api/amap/route-walking?origin=121.4737,31.2304&destination=121.4740,31.2310`

返回策略:

- 未配置 `AMAP_KEY`：返回 `status: "not_configured"`，不报错。
- 已配置 `AMAP_KEY`：调用高德 Web 服务，返回标准化的 POI 或步行路线估算结果。

本地测试 adapter 需要使用 Vercel 的函数运行环境，普通 `npm run dev` 只启动 Vite 前端:

```bash
npx vercel dev
curl "http://localhost:3000/api/amap/poi-search?keyword=咖啡&city=上海"
curl "http://localhost:3000/api/amap/route-walking?origin=121.4737,31.2304&destination=121.4740,31.2310"
```

Vercel 配置 `AMAP_KEY`:

1. 到高德开放平台注册应用并开通 Web 服务 API。
2. 在 Vercel 项目里进入 `Settings -> Environment Variables`。
3. 新增变量 `AMAP_KEY`，值为你的高德 Web 服务 key。
4. 重新部署项目。

配置后，adapter 可以调用真实高德 POI 搜索和步行路径估算；当前路线生成仍默认走本地 mock，以保证 Demo 稳定。后续如要切换为真实数据源，应让 `retrieveCandidates` 和 ETA 估算读取 adapter 返回结果，而不是让 LLM 直接生成路线文本。

## Mock Backend

项目包含一个独立的最小服务端示例，用于回应“用户、历史路线、POI 搜索、路径估算这些数据源从哪里来”。

```bash
cd server
npm install
npm run dev
```

默认地址:

```text
http://localhost:8787
```

主要接口:

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /me`
- `GET /history`
- `POST /history`
- `GET /poi/search`
- `POST /route/estimate`

当前前端仍默认使用本地 mock 数据和 localStorage，Vercel Demo 不依赖这个服务端。`server/` 只是数据源抽象层的可运行示例:未来可把 mock POI search 替换为高德 POI/地理编码，把 mock route estimate 替换为高德路径规划/距离矩阵/交通态势，把生活数据替换为美团/点评 UGC、人均、排队、营业、团购等接口。

如果要在 Vercel 上展示真实地图数据接入能力，优先使用上面的 `api/amap/*` serverless adapter；`server/` 主要用于本地说明服务端接口形态。

详细说明见 [docs/API_SERVER.md](docs/API_SERVER.md)。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址，通常是：

```text
http://localhost:5173
```

## 验证

```bash
npm run build
npm run eval
```

如果本地沙盒环境中 `npm run eval` 因 `tsx` 创建临时 IPC pipe 报 `EPERM`，可使用等价命令：

```bash
node --import tsx scripts/runEval.ts
```

## Vercel 部署

推荐配置：

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

前端 Demo 不依赖服务端环境变量；如果要启用高德 adapter，在 Vercel 环境变量中配置 `AMAP_KEY`。

## 演示建议

1. 先用一句自然语言生成路线，停留在用户首页，展示时间轴、预算、营业、排队、移动成本和推荐理由。
2. 切换 mock 用户或编辑偏好，说明偏好会注入规划输入并影响路线。
3. 使用“临时改一下”做一次局部 replan，强调只替换必要节点。
4. 打开“查看规划依据”，展示 Agent Loop、候选排序、约束校验、修复记录和数据源抽象层。
5. 最后运行评测或展示评测结果，证明路线不是预制模板。

## 中期验收清单

见 [docs/MID_STAGE_CHECKLIST.md](docs/MID_STAGE_CHECKLIST.md)。
