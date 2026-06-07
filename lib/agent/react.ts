import type { Constraints, PlanRequest, SSEEvent } from '../../contract/index.js'
import type { EnrichedPOI, RetrieveResult, UnderstandResult } from './types.js'
import { personaFor } from './persona.js'
import { planFromCandidates } from './loop.js'

export const MAX_STEPS = 6

/** Persisted/resumable ReAct state (matches conversations.state jsonb shape). */
export interface ReactState {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  candidates: EnrichedPOI[]
  constraints: Constraints
  city: string
}

export interface ReactDeps {
  resolveLocation: (raw: string) => Promise<{ status: string; city: string | null; district?: string | null; center?: { lat: number; lng: number }; message?: string }>
  understand: (raw: string, loc: any, persona: any, preferences: any) => Promise<UnderstandResult>
  retrieve: (keywords: string[], loc: any) => Promise<RetrieveResult>
  /** Single-keyword real POI search (amap place/text via cache). Returns [] on miss/error. */
  searchPOI: (keyword: string, district?: string) => Promise<EnrichedPOI[]>
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
- searchPOI: 在已定位城市搜真实地点。args:{"keyword":"高德搜索词,可含区县","district":"可选区县"}。观察会回灌命中数与评分区间。
- askUser: 信息不足时反问用户(只在确有必要时)。args:{"question":"问题","options":["可选项..."]}。问完即暂停等待。
- finish: 已有足够真实候选,产出方案。args:{}。
约束: 候选只能来自 searchPOI 的真实结果,不要编造地点。最多 ${MAX_STEPS} 步,尽快 finish。`

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
  const candById = new Map<string, EnrichedPOI>()

  if (deps.priorState) {
    messages = [...deps.priorState.messages]
    constraints = deps.priorState.constraints
    city = deps.priorState.city
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
      const kw = String(action.args?.keyword ?? '').trim()
      const district = action.args?.district ? String(action.args.district) : (constraints.district ?? undefined)
      let found: EnrichedPOI[] = []
      if (kw) {
        try { found = await deps.searchPOI(kw, district) } catch { found = [] }
      }
      const added = dedupeInto(candById, found)
      const summary = found.length
        ? `命中 ${found.length} 家(新增 ${added}),${ratingRange(found)},累计 ${candById.size}`
        : `无命中,累计 ${candById.size}`
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
      const state: ReactState = { messages, candidates: [...candById.values()], constraints, city }
      try { await deps.saveConversation(id, owner, state) } catch { /* best-effort; still ask */ }
      yield { type: 'question', conversationId: id, question, ...(options ? { options } : {}) }
      return
    }

    // tool === 'finish'
    yield* finishWith(candById, constraints, persona, req, identity, deps)
    return
  }

  // ── 3) MAX_STEPS exhausted without finish → honest forced finish ──────────
  if (candById.size >= 2) {
    yield { type: 'thought', text: `已达最大步数,用当前 ${candById.size} 家真实候选直接出方案。` }
    yield* finishWith(candById, constraints, persona, req, identity, deps, true)
    return
  }
  // not enough real candidates even after exhausting steps → fall back
  yield* fallback(req, identity, deps, persona, constraints, city, candById)
}

function stage(key: string, label: string, status: 'running' | 'ok' | 'skip' | 'fail', extra: Partial<SSEEvent> = {}): SSEEvent {
  return { type: 'stage', key, label, status, ...extra } as SSEEvent
}

async function* finishWith(
  candById: Map<string, EnrichedPOI>, constraints: Constraints, persona: any,
  req: PlanRequest, identity: ReactIdentity, deps: ReactDeps, forced = false,
): AsyncGenerator<SSEEvent> {
  const candidates = [...candById.values()]
  yield* planFromCandidates(
    candidates, constraints, persona, req,
    { deviceToken: identity.deviceToken, userId: identity.userId },
    { streamExplanation: deps.streamExplanation, savePlan: deps.savePlan, planId: deps.planId } as any,
    { amapStatus: 'ok', forced },
  )
}

/** Reliable linear fallback: understand → retrieve → deterministic tail. */
async function* fallback(
  req: PlanRequest, identity: ReactIdentity, deps: ReactDeps, persona: any,
  constraints: Constraints, city: string, candById: Map<string, EnrichedPOI>,
): AsyncGenerator<SSEEvent> {
  const loc = { city, district: constraints.district ?? null, center: undefined as any }
  yield stage('retrieve', '召回真实地点', 'running')
  let retrieved: RetrieveResult
  try {
    const understood = await deps.understand(req.request, loc, persona, req.preferences)
    retrieved = await deps.retrieve(understood.keywords, { ...loc, district: understood.constraints.district ?? loc.district })
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
    { amapStatus: retrieved.amapStatus, cacheHits: retrieved.cacheHits, cacheMisses: retrieved.cacheMisses },
  )
}
