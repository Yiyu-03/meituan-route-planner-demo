# Mock API Server

`server/` 是一个独立的最小 mock backend，用来说明登录、历史路线、POI 搜索和路线估算这些数据源未来可以如何服务化。

当前前端 Demo 仍然默认使用本地 mock 数据和 localStorage，保证 Vercel 页面稳定可跑。这个 mock server 不是前端主流程的硬依赖。

## 启动

```bash
cd server
npm install
npm run dev
```

默认地址:

```text
http://localhost:8787
```

`server/package.json` 没有第三方依赖，`npm install` 只会生成 lockfile，方便比赛现场稳定启动。

## API

### GET /health

检查服务状态。

```bash
curl http://localhost:8787/health
```

### POST /auth/register

注册或更新一个 mock 用户，数据只保存在内存里。

```bash
curl -X POST http://localhost:8787/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"小王","prefs":["quiet","avoidQueue"],"budgetPref":200}'
```

返回:

```json
{
  "token": "mock-token-...",
  "user": {
    "userId": "mock-user-...",
    "nickname": "小王",
    "prefs": ["quiet", "avoidQueue"],
    "budgetPref": 200
  }
}
```

### POST /auth/login

用昵称登录 mock 用户。若内存里没有该昵称，会创建一个默认用户。

```bash
curl -X POST http://localhost:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"小王"}'
```

### GET /me

通过 mock token 获取当前用户。

```bash
curl http://localhost:8787/me \
  -H "Authorization: Bearer $TOKEN"
```

### GET /history

读取当前用户的历史路线。

```bash
curl http://localhost:8787/history \
  -H "Authorization: Bearer $TOKEN"
```

### POST /history

保存一条当前用户的历史路线。

```bash
curl -X POST http://localhost:8787/history \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"新天地安静晚饭","route":{"stops":["新天地精品咖啡","愚园路家常面馆"]}}'
```

### GET /poi/search

模拟高德 POI 搜索接口。支持 `keyword`、`city`、`area`。

```bash
curl "http://localhost:8787/poi/search?keyword=咖啡&city=上海&area=新天地"
```

### POST /route/estimate

模拟路径规划/距离矩阵接口。`from` / `to` 可以是 mock POI id、POI 名称，或 `{ "lat": number, "lng": number }`。

```bash
curl -X POST http://localhost:8787/route/estimate \
  -H 'Content-Type: application/json' \
  -d '{"from":"p-xintiandi-1","to":"p-xintiandi-2","mode":"walk"}'
```

返回:

```json
{
  "distanceMeters": 137,
  "durationMinutes": 2,
  "mode": "walk",
  "source": "mock_route_estimate"
}
```

## 数据源替换思路

当前 mock server 把数据源抽象成三类接口:

- 用户与历史: mock auth、mock user profile、mock history。
- 地点检索: mock POI search，对齐未来的高德 POI 搜索/地理编码。
- 路线估算: mock route estimate，对齐未来的高德路径规划、距离矩阵和交通态势。

未来接真实服务时，可以替换数据源实现，而不需要重写前端 UI 或 agent loop:

- 高德开放平台: POI 搜索、地理编码、路径规划、距离矩阵、交通态势。
- 美团/点评生活数据: UGC、人均、排队、营业、团购、评分、门店履约。
- 自有服务端: 登录态、用户偏好、历史路线、AB 实验、缓存。

核心原则是:数据源接口可替换，`parseConstraints -> retrieveCandidates -> scorePOIs -> buildRouteCandidates -> validateRoute -> repair/replan -> explainRoute` 这条规划链路不需要重写。
