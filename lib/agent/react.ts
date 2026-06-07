import type { Constraints, PlanRequest, SSEEvent } from '../../contract/index.js'
import type { EnrichedPOI, RetrieveResult, UnderstandResult } from './types.js'
import { personaFor } from './persona.js'
import { planFromCandidates } from './loop.js'

export const MAX_STEPS = 4

/** Persisted/resumable ReAct state (matches conversations.state jsonb shape). */
export interface ReactState {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  candidates: EnrichedPOI[]
  constraints: Constraints
  city: string
  /** Geo anchor center for clustering (resolved user anchor or district center); null = densest-cluster. */
  anchorCenter?: { lat: number; lng: number } | null
}

export interface ReactDeps {
  resolveLocation: (raw: string) => Promise<{ status: string; city: string | null; district?: string | null; center?: { lat: number; lng: number }; message?: string }>
  understand: (raw: string, loc: any, persona: any, preferences: any) => Promise<UnderstandResult>
  retrieve: (keywords: string[], loc: any) => Promise<RetrieveResult>
  /** Single-keyword real POI search. With anchorCenter → place/around; else city-wide place/text. */
  searchPOI: (keyword: string, district?: string, anchorCenter?: { lat: number; lng: number }) => Promise<EnrichedPOI[]>
  /** Resolve a user anchor (区域名/具体地点) to a center; null when unresolvable. */
  resolveAnchor?: (anchorText: string, city: string) => Promise<{ lat: number; lng: number } | null>
  streamExplanation: (route: any, c: Constraints) => AsyncGenerator<string>
  savePlan: (record: any) => Promise<{ id: string }>
  saveConversation: (id: string, owner: string | null, state: ReactState) => Promise<{ id: string }>
  planId: () => string
  conversationId: () => string
  chatJson: (messages: any[]) => Promise<any | null>
  /** Resume: previously persisted state for this conversationId. */
  priorState?: ReactState
}

export interface ReactIdentity { deviceToken: string | null; userId: number | null }

const TOOLS_DOC = `你是一个出行规划 agent，用 ReAct(推理→行动→观察)方式工作。每一步只输出一个严格 JSON 对象，不要任何多余文字:
{"thought":"你的推理","action":{"tool":"searchPOI|askUser|finish","args":{...}}}
工具:
- searchPOI: 在已定位城市搜真实地点。args:{"keywords":["关键词1","关键词2",...],"district":"可选区县"}。**一开始就把所有相互独立、能确定的搜索词一次性放进 keywords 数组**(它们会并行执行,远快于一步一个);只有需要根据上一步结果再调整时才追加新的 searchPOI。也兼容单个 {"keyword":"..."}。
- askUser: 仅当用户意图本身缺失、搜索也无从下手时才反问。args:{"question":"问题","options":["可选项..."]}。问完即暂停等待。
- finish: 已有足够真实候选,产出方案。args:{}。
约束: 候选只能来自 searchPOI 的真实结果,不要编造地点。
反问铁律(askUser 是最后手段,先搜再说):
- **缺具体区域/商圈/街道/店名,绝不是反问的理由**——searchPOI 能在全市或任一区域直接搜,该搜就搜,别问用户"在哪个区""哪条街"。
- 城市已定位、必去类目已知,就直接 searchPOI;搜不到再换关键词搜,而不是问用户。
- 只有当"用户到底想要什么"这一层都不明(例如完全没给城市、或诉求笼统到无法落成任何搜索词)时,才 askUser,且一次问清。
- 拿不准时,默认"搜"而不是"问"。
效率铁律(每次 LLM 调用都很慢,务必遵守):
1. **第一步就把所有需要的关键词一次性放进 keywords 并行搜齐**:**constraints.mustCategories 里的每一个类目都必须有对应关键词**(用户明确提到的"中午吃饭/喝咖啡/看夜景"等更不能漏——别只搜主诉求而漏了配套的吃饭),每类 1-2 个词。
2. **只要每个必去类目都已有候选,立刻 finish**——通常第 2 步就该 finish。
3. **绝不重复搜索已搜过的词**;不要为了"更全"反复搜同义词。
4. 只有当某个必去类目完全无候选时,才追加一次不同方向的搜索。
最多 ${MAX_STEPS} 步,但目标是 2 步内 finish。`

function systemPrompt(constraints: Constraints, persona: any): string {
  return `${TOOLS_DOC}\n本次请求约束(已解析): ${JSON.stringify({
    city: constraints.city, district: constraints.district, startTime: constraints.startTime,
    durationMin: constraints.durationMin, party: constraints.party,
    diningBudget: constraints.diningBudgetPerCapita, prefs: constraints.prefs,
    mustCategories: constraints.mustCategories, persona: persona.id,
  })}`
}

function dedupeInto(into: Map<string, EnrichedPOI>, pois: EnrichedPOI[]): number {
  let added = 0
  for (const p of pois) {
    if (!into.has(p.id)) { into.set(p.id, p); added += 1 }
  }
  return added
}

function ratingRange(pois: EnrichedPOI[]): string {
  const rs = pois.map((p) => p.rating).filter((r): r is number => typeof r === 'number')
  if (!rs.length) return '评分缺失'
  return `评分 ${Math.min(...rs).toFixed(1)}~${Math.max(...rs).toFixed(1)}`
}

function actionSummary(action: any): string {
  const a = action?.args ?? {}
  if (action?.tool === 'searchPOI') return [a.keyword, a.district].filter(Boolean).join(' / ') || '搜索'
  if (action?.tool === 'askUser') return String(a.question ?? '反问')
  return '产出方案'
}

export async function* runReactLoop(
  req: PlanRequest, identity: ReactIdentity, deps: ReactDeps,
): AsyncGenerator<SSEEvent> {
  const persona = personaFor(req.preferences.personaPick)

  // ── 1) seed state: resume from prior, else resolve + understand ──────────
  let messages: ReactState['messages']
  let constraints: Constraints
  let city: string
  let anchorCenter: { lat: number; lng: number } | null = null
  const candById = new Map<string, EnrichedPOI>()

  if (deps.priorState) {
    messages = [...deps.priorState.messages]
    constraints = deps.priorState.constraints
    city = deps.priorState.city
    anchorCenter = deps.priorState.anchorCenter ?? null
    dedupeInto(candById, deps.priorState.candidates ?? [])
    if (req.answer) messages.push({ role: 'user', content: `用户回答: ${req.answer}` })
  } else {
    yield stage('resolve', '定位城市', 'running')
    const loc = await deps.resolveLocation(req.request)
    if (loc.status !== 'resolved' || !loc.city) {
      yield stage('resolve', '定位城市', 'fail')
      yield { type: 'error', code: 'needs-clarification', message: loc.message || '需要补充具体城市或区域，未默认回退。', recoverable: true }
      return
    }
    yield stage('resolve', '定位城市', 'ok', { summary: loc.city })

    yield stage('understand', '读懂需求', 'running')
    const understood = await deps.understand(req.request, loc, persona, req.preferences)
    constraints = { ...understood.constraints, district: understood.constraints.district ?? loc.district ?? null }
    city = loc.city
    // anchor center: user anchor (resolved) → resolved location center → null (densest-cluster at finish).
    if (understood.anchor && deps.resolveAnchor) {
      anchorCenter = await deps.resolveAnchor(understood.anchor, city).catch(() => null)
    }
    if (!anchorCenter && loc.center) anchorCenter = loc.center
    yield stage('understand', '读懂需求', 'ok', { summary: understood.llmUsed ? 'LLM 解析' : '规则解析' })
    yield { type: 'constraints', constraints }

    messages = [
      { role: 'system', content: systemPrompt(constraints, persona) },
      { role: 'user', content: `需求: ${req.request}` },
    ]
  }

  // ── 2) ReAct loop ────────────────────────────────────────────────────────
  let llmFailures = 0
  for (let step = 0; step < MAX_STEPS; step += 1) {
    let decision: any = null
    try {
      decision = await deps.chatJson(messages)
    } catch {
      decision = null
    }
    const action = decision?.action
    const tool = action?.tool

    if (!decision || (tool !== 'searchPOI' && tool !== 'askUser' && tool !== 'finish')) {
      // unparseable / unknown action → fall back to the reliable linear path
      llmFailures += 1
      yield* fallback(req, identity, deps, persona, constraints, city, candById)
      return
    }

    if (decision.thought) yield { type: 'thought', text: String(decision.thought) }
    yield { type: 'action', tool, args: actionSummary(action) }
    messages.push({ role: 'assistant', content: JSON.stringify(decision) })

    if (tool === 'searchPOI') {
      const district = action.args?.district ? String(action.args.district) : (constraints.district ?? undefined)
      // Accept a single keyword or a batch of independent keywords — run them in PARALLEL.
      const kws = (Array.isArray(action.args?.keywords) ? action.args.keywords : [action.args?.keyword])
        .map((k: any) => String(k ?? '').trim())
        .filter(Boolean)
        .slice(0, 6)
      const results = await Promise.all(
        kws.map((k) => deps.searchPOI(k, district, anchorCenter ?? undefined).catch(() => [] as EnrichedPOI[])),
      )
      const found = results.flat()
      const added = dedupeInto(candById, found)
      const head = kws.length > 1 ? `并行搜「${kws.join('、')}」: ` : ''
      const summary = found.length
        ? `${head}命中 ${found.length} 家(新增 ${added}),${ratingRange(found)},累计 ${candById.size}`
        : `${head}无命中,累计 ${candById.size}`
      yield { type: 'observation', summary, count: found.length }
      messages.push({ role: 'user', content: `观察: ${summary}` })
      continue
    }

    if (tool === 'askUser') {
      const question = String(action.args?.question ?? '需要更多信息').trim()
      const options = Array.isArray(action.args?.options)
        ? action.args.options.map((o: any) => String(o)).slice(0, 6)
        : undefined
      const id = deps.conversationId()
      const owner = identity.userId != null ? String(identity.userId) : identity.deviceToken
      const state: ReactState = { messages, candidates: [...candById.values()], constraints, city, anchorCenter }
      try { await deps.saveConversation(id, owner, state) } catch { /* best-effort; still ask */ }
      yield { type: 'question', conversationId: id, question, ...(options ? { options } : {}) }
      return
    }

    // tool === 'finish'
    yield* finishWith(candById, constraints, persona, req, identity, deps, false, anchorCenter)
    return
  }

  // ── 3) MAX_STEPS exhausted without finish → honest forced finish ──────────
  if (candById.size >= 2) {
    yield { type: 'thought', text: `已达最大步数,用当前 ${candById.size} 家真实候选直接出方案。` }
    yield* finishWith(candById, constraints, persona, req, identity, deps, true, anchorCenter)
    return
  }
  // not enough real candidates even after exhausting steps → fall back
  yield* fallback(req, identity, deps, persona, constraints, city, candById, anchorCenter)
}

function stage(key: string, label: string, status: 'running' | 'ok' | 'skip' | 'fail', extra: Partial<SSEEvent> = {}): SSEEvent {
  return { type: 'stage', key, label, status, ...extra } as SSEEvent
}

async function* finishWith(
  candById: Map<string, EnrichedPOI>, constraints: Constraints, persona: any,
  req: PlanRequest, identity: ReactIdentity, deps: ReactDeps, forced = false,
  anchorCenter: { lat: number; lng: number } | null = null,
): AsyncGenerator<SSEEvent> {
  const candidates = [...candById.values()]
  yield* planFromCandidates(
    candidates, constraints, persona, req,
    { deviceToken: identity.deviceToken, userId: identity.userId },
    { streamExplanation: deps.streamExplanation, savePlan: deps.savePlan, planId: deps.planId } as any,
    { amapStatus: 'ok', forced, center: anchorCenter ?? undefined },
  )
}

/** Reliable linear fallback: understand → retrieve → deterministic tail. */
async function* fallback(
  req: PlanRequest, identity: ReactIdentity, deps: ReactDeps, persona: any,
  constraints: Constraints, city: string, candById: Map<string, EnrichedPOI>,
  anchorCenter: { lat: number; lng: number } | null = null,
): AsyncGenerator<SSEEvent> {
  const loc = { city, district: constraints.district ?? null, center: anchorCenter ?? (undefined as any) }
  yield stage('retrieve', '召回真实地点', 'running')
  let retrieved: RetrieveResult
  try {
    const understood = await deps.understand(req.request, loc, persona, req.preferences)
    retrieved = await deps.retrieve(understood.keywords, {
      ...loc, district: understood.constraints.district ?? loc.district,
      anchorCenter: anchorCenter ?? undefined,
    })
  } catch {
    retrieved = { pois: [], center: { lat: 0, lng: 0 }, cacheHits: 0, cacheMisses: 0, amapStatus: 'error' }
  }
  // merge any candidates already gathered by ReAct
  dedupeInto(candById, retrieved.pois)
  const merged = [...candById.values()]

  if (merged.length < 2) {
    yield stage('retrieve', '召回真实地点', 'fail')
    if (retrieved.amapStatus === 'error' || retrieved.amapStatus === 'not_configured') {
      yield { type: 'error', code: 'upstream-unavailable', message: '高德 POI 服务暂不可用，未编造地点。', recoverable: true }
    } else {
      yield { type: 'error', code: 'insufficient-data', message: '该区域真实地点不足，无法组成路线。', recoverable: true }
    }
    return
  }
  yield stage('retrieve', '召回真实地点', 'ok', { summary: `${merged.length} 家真实店` })

  yield* planFromCandidates(
    merged, constraints, persona, req,
    { deviceToken: identity.deviceToken, userId: identity.userId },
    { streamExplanation: deps.streamExplanation, savePlan: deps.savePlan, planId: deps.planId } as any,
    { amapStatus: retrieved.amapStatus, cacheHits: retrieved.cacheHits, cacheMisses: retrieved.cacheMisses, center: anchorCenter ?? undefined },
  )
}
