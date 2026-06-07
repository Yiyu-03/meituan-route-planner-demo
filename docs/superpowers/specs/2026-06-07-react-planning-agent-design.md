# 设计文档:ReAct 对话式规划 Agent

- 日期:2026-06-07
- 状态:待用户审阅
- 背景:现有"理解→召回"是一次性的(LLM 出关键词→并行搜高德→完),结果不好无补救,且与用户交互太少。升级为 ReAct(reason→act→observe 循环)+ 流式思考 + askUser 反问。

## 1. 目标
- **LLM 为主、可迭代**:agent 自己推理该搜什么、看结果决定下一步,直到候选满足需求(如"亲子餐厅"能被真正搜到)。
- **过程可感知**:把 Thought/Action/Observation 流式推给前端,用户看着 agent 工作。
- **双向交互**:模糊时 agent 反问用户(askUser),用户回答后从断点继续。
- **确定性骨架不变**:LLM 负责"找对地方",代码负责预算/营业/距离/排路线。
- **no-mock 不变**:候选只来自真实高德;拿不到就诚实。

## 2. 总体流程
```
POST /api/plan {request, preferences, previousPlan, conversationId?, answer?}
  ├─ 有 conversationId+answer → 从 Neon 载入对话,追加答案,续跑 ReAct
  └─ 否则 → 新建 ReAct
ReAct 循环(最多 MAX_STEPS=6):
  LLM(系统提示=工具+请求+scratchpad) → {thought, action}
    · action=searchPOI(keyword[,district]) → 高德 place/text+缓存 → observation 回灌
        流式: thought / action / observation
    · action=askUser(question[,options]) → 存对话到 Neon → 推 question 事件 → 结束流(等待)
    · action=finish → 候选 → 确定性骨架(score/build/validate/repair/rank/explain)→ route/explanation/done
  超过 MAX_STEPS 未 finish → 用现有候选强制 finish(诚实标注)
```

## 3. 契约扩展(`contract/`,需双 worktree 同步)
新增 SSE 事件(zod):
- `thought`:`{ type:'thought', text }`
- `action`:`{ type:'action', tool:'searchPOI'|'askUser'|'finish', args }`
- `observation`:`{ type:'observation', summary, count? }`
- `question`:`{ type:'question', conversationId, question, options?: string[] }`(发完即结束流)

`PlanRequestSchema` 增字段:`conversationId?: string`、`answer?: string`。

保留现有 `stage/constraints/candidates/route/explanation/done/error`。

## 4. 后端
- `lib/agent/react.ts`:ReAct 循环 + 工具分发 + scratchpad 维护(messages 数组)。
- 工具:
  - `searchPOI`:复用 `lib/amap/client` + `cache`(守额度)。
  - `askUser`:持久化对话 → 返回 `needsUser` 信号给 loop → 发 question 事件 + 结束。
  - `finish`:候选转 `EnrichedPOI[]` → 现有 `score/build/validate/repair/rank/explain`。
- `lib/deepseek/client.ts`:ReAct 用 tool-calling 或严格 JSON action 格式(`{thought, action:{tool,args}}`);max_tokens 已提到 2000(推理模型)。
- Neon 新表:
  ```sql
  conversations(id TEXT PK, owner TEXT, messages jsonb, candidates jsonb,
                constraints jsonb, city TEXT, created_at, expires_at)
  ```
  `lib/db/conversations.js`:save/load/expire。
- `lib/handlers/plan.ts`:支持 conversationId+answer 恢复;ReAct 编排取代直接 understand→retrieve(确定性骨架阶段不变)。
- 兜底:LLM tool-call 失败/超时 → 退回当前"LLM 关键词一次性召回"(已修可靠);仍失败才诚实 error。

## 5. 前端
- `usePlanStream`:处理 thought/action/observation(累积成"思考流")+ question(进入等待态)。
- 新组件 `AgentThinking.tsx`:实时渲染 Thought/Action/Observation(v2 手帐风,像手写推理)。
- 新组件 `AgentQuestion.tsx`:渲染反问(选项按钮 / 输入)→ 提交 `{conversationId, answer}` 续跑。
- `planStream.ts`:支持带 conversationId+answer 的续传;保存当前 conversationId。
- 思考流默认展开在方案生成中,完成后可折叠进"为什么这么排"抽屉。

## 6. 延迟与成本
- 多轮 LLM(deepseek-v4 每轮约 5-9s)→ 一次规划约 20-40s。
- 缓解:流式思考(可感知)、MAX_STEPS 上限、每步搜索可并行、POI 缓存。
- 成本:LLM token 增加,可接受(小规模 staging)。

## 7. 测试
- ReAct 循环单测(注入假 LLM + 假高德):searchPOI 迭代、askUser 暂停存库、finish 转骨架、MAX_STEPS 兜底。
- conversations 存取单测(Neon dev)。
- 契约 fixtures 增加含 thought/action/observation/question 的流。
- 真实 e2e:"带孩子找亲子餐厅" → 断言召回含亲子餐厅类候选;一次 askUser 往返。
- 浏览器:思考流渲染 + 反问交互 + 续跑。

## 8. 工作流
契约先冻结(加事件+字段+fixtures)→ 两 worktree 并行(后端 ReAct + 前端渲染/交互)→ 合并 → 充分测试 → 部署 staging 验。

## 9. 风险
- askUser 恢复依赖 conversations 持久化与过期清理。
- 延迟显著上升;需流式体验补偿,必要时给"跳过反问直接出方案"选项。
- 契约改动需前后端严格同步。
