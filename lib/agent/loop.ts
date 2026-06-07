import type { Constraints, DataSources, PlanRequest, POI, Route, ScoredPOI, SSEEvent } from '../../contract/index.js'
import type { EnrichedPOI, RetrieveResult, UnderstandResult } from './types.js'
import { personaFor } from './persona.js'
import { scorePOIs } from './score.js'
import { buildRouteCandidates, materializeRoute } from './build.js'
import { validateRoute } from './validate.js'
import { repairIfNeeded } from './repair.js'
import { rankRoutes } from './rank.js'
import { parseEditIntent, parseEditIntentLLM, applyEdit, constraintsFromPrev, keywordsForEdit, prevCenter } from './replan.js'

export interface LoopDeps {
  resolveLocation: (raw: string) => Promise<{ status: string; city: string | null; district?: string | null; center?: { lat: number; lng: number }; message?: string }>
  understand: (raw: string, loc: any, persona: any, preferences: any) => Promise<UnderstandResult>
  retrieve: (keywords: string[], loc: any) => Promise<RetrieveResult>
  streamExplanation: (route: Route, c: Constraints) => AsyncGenerator<string>
  savePlan: (record: any) => Promise<{ id: string }>
  planId: () => string
  /** Optional LLM gap-filler for replan edit-intent parsing (deterministic rules stay primary). */
  editChatJson?: (messages: any[]) => Promise<any | null>
}

export interface LoopIdentity { deviceToken: string | null; userId: number | null }

function stage(key: string, label: string, status: 'running' | 'ok' | 'skip' | 'fail', extra: Partial<SSEEvent> = {}): SSEEvent {
  return { type: 'stage', key, label, status, ...extra } as SSEEvent
}

/** Strip internal enrichment (sceneTags/avgDuration) so emitted POIs satisfy the frozen contract POISchema (.strict()). */
function toContractPOI(p: POI | EnrichedPOI): POI {
  const { sceneTags, avgDuration, ...rest } = p as EnrichedPOI
  return rest as POI
}

function stripScored(s: ScoredPOI): ScoredPOI {
  return { ...s, poi: toContractPOI(s.poi) }
}

function stripRoute(r: Route): Route {
  return { ...r, stops: r.stops.map((st) => ({ ...st, poi: toContractPOI(st.poi) })) }
}

export interface PlanFromCandidatesOpts {
  amapStatus?: 'ok' | 'empty' | 'not_configured' | 'error'
  cacheHits?: number
  cacheMisses?: number
  /** Honest note when candidates came from a forced finish (MAX_STEPS / fallback). */
  forced?: boolean
  /** Proximity anchor override (e.g. resolved district center); defaults to candidate centroid. */
  center?: { lat: number; lng: number }
}

/**
 * Shared deterministic tail: real candidates → score → build → validate → repair →
 * rank → route → explanation → persist → done. Reused by the linear loop and the
 * ReAct loop's `finish` action so the frontend renders both identically.
 */
export async function* planFromCandidates(
  candidates: EnrichedPOI[],
  constraints: Constraints,
  persona: ReturnType<typeof personaFor>,
  req: PlanRequest,
  identity: LoopIdentity,
  deps: LoopDeps,
  opts: PlanFromCandidatesOpts = {},
): AsyncGenerator<SSEEvent> {
  const amapStatus = opts.amapStatus ?? 'ok'
  if (candidates.length < 2) {
    yield { type: 'error', code: 'insufficient-data', message: '真实候选不足，无法组成路线。', recoverable: true }
    return
  }

  // proximity anchor: explicit override (resolved center) or centroid of real coords — never fabricated.
  const center = opts.center ?? {
    lat: candidates.reduce((s, p) => s + p.lat, 0) / candidates.length,
    lng: candidates.reduce((s, p) => s + p.lng, 0) / candidates.length,
  }

  yield stage('score', '打分', 'running')
  const scored = scorePOIs(candidates, constraints, persona, center.lat, center.lng)
  yield stage('score', '打分', 'ok')
  yield { type: 'candidates', candidates: scored.map(stripScored) }

  yield stage('build', '组合路线', 'running')
  const { routes: built } = buildRouteCandidates(scored, constraints, persona)
  if (built.length === 0) {
    yield stage('build', '组合路线', 'fail')
    yield { type: 'error', code: 'insufficient-data', message: '真实候选无法组成满足约束的路线。', recoverable: true }
    return
  }
  yield stage('build', '组合路线', 'ok', { summary: `${built.length} 条候选` })

  yield stage('validate', '体检', 'running')
  const validated = built.map((r) => ({ ...r, checks: validateRoute(r, constraints, persona) }))
  yield stage('validate', '体检', 'ok')

  yield stage('repair', '修复', 'running')
  const repaired = validated.map((r) => repairIfNeeded(r, constraints, persona, scored).route)
  yield stage('repair', '修复', 'ok')

  const ranked = rankRoutes(repaired, constraints, persona)
  const best = ranked[0]
  yield { type: 'route', route: stripRoute(best) }

  yield stage('explain', '写推荐理由', 'running')
  let explanation = ''
  for await (const delta of deps.streamExplanation(best, constraints)) {
    explanation += delta
    yield { type: 'explanation', routeId: best.id, delta }
  }
  yield stage('explain', '写推荐理由', 'ok')

  const finalRoutes: Route[] = ranked.map((r, i) => (i === 0 ? { ...r, explanation } : r))
  const dataSources: DataSources = {
    amapPoi: { configured: true, used: amapStatus === 'ok', status: amapStatus },
    amapRoute: { configured: true, used: best.stops.some((s) => s.legFromPrev?.mode === 'walk'), status: 'ok' },
    deepseek: { configured: !!explanation, used: !!explanation, status: explanation ? 'ok' : 'fallback' },
    cache: { hits: opts.cacheHits ?? 0, misses: opts.cacheMisses ?? 0 },
  }
  const planId = deps.planId()
  await deps.savePlan({
    id: planId, userId: identity.userId, deviceToken: identity.deviceToken,
    request: req.request, constraints, routes: finalRoutes, dataSources,
  })
  yield { type: 'done', planId, routes: finalRoutes.map(stripRoute), dataSources }
}

export async function* runPlanLoop(
  req: PlanRequest, identity: LoopIdentity, deps: LoopDeps,
): AsyncGenerator<SSEEvent> {
  const persona = personaFor(req.preferences.personaPick)

  // ── replan branch: minimal edit over an existing plan ──────────────────
  if (req.previousPlan != null && req.previousPlan.stops.length >= 2) {
    yield* runReplanLoop(req, req.previousPlan, identity, deps, persona)
    return
  }

  // 1) resolveLocation
  yield stage('resolve', '定位城市', 'running')
  const loc = await deps.resolveLocation(req.request)
  if (loc.status !== 'resolved' || !loc.city) {
    yield stage('resolve', '定位城市', 'fail')
    yield { type: 'error', code: 'needs-clarification', message: loc.message || '需要补充具体城市或区域，未默认回退。', recoverable: true }
    return
  }
  yield stage('resolve', '定位城市', 'ok', { summary: loc.city })

  // 2) understand
  yield stage('understand', '读懂需求', 'running')
  const understood = await deps.understand(req.request, loc, persona, req.preferences)
  const constraints = understood.constraints
  yield stage('understand', '读懂需求', 'ok', { summary: understood.llmUsed ? 'LLM 解析' : '规则解析' })
  yield { type: 'constraints', constraints }

  // 3) retrieve
  yield stage('retrieve', '召回真实地点', 'running')
  const retrieved = await deps.retrieve(understood.keywords, { ...loc, district: loc.district ?? constraints.district })
  if (retrieved.pois.length < 2) {
    yield stage('retrieve', '召回真实地点', 'fail')
    if (retrieved.amapStatus === 'error' || retrieved.amapStatus === 'not_configured') {
      yield { type: 'error', code: 'upstream-unavailable', message: '高德 POI 服务暂不可用，未编造地点。', recoverable: true }
    } else {
      yield { type: 'error', code: 'insufficient-data', message: '该区域真实地点不足，无法组成路线。', recoverable: true }
    }
    return
  }
  yield stage('retrieve', '召回真实地点', 'ok', { summary: `${retrieved.pois.length} 家真实店` })

  // 4-9) shared deterministic tail (score→build→validate→repair→rank→route→explain→done)
  yield* planFromCandidates(retrieved.pois, constraints, persona, req, identity, deps, {
    amapStatus: retrieved.amapStatus,
    cacheHits: retrieved.cacheHits,
    cacheMisses: retrieved.cacheMisses,
    center: loc.center ?? undefined,
  })
}

/**
 * Replan: keep the previous plan's stops, retrieve fresh same-category real POIs
 * for the targeted node, apply the minimal edit, then run the identical
 * validate→repair→rank→explain→done pipeline so the frontend renders it the same.
 */
async function* runReplanLoop(
  req: PlanRequest, previousPlan: Route, identity: LoopIdentity, deps: LoopDeps, persona: ReturnType<typeof personaFor>,
): AsyncGenerator<SSEEvent> {
  const op = deps.editChatJson
    ? await parseEditIntentLLM(req.request, previousPlan, { chatJson: deps.editChatJson })
    : parseEditIntent(req.request, previousPlan)
  const constraints = constraintsFromPrev(previousPlan, persona, op)

  // 1) understand the edit (deterministic op; LLM-free stage for parity)
  yield stage('understand', '读懂修改需求', 'running')
  yield stage('understand', '读懂修改需求', 'ok', { summary: `在改方案 · ${op.op}` })
  yield { type: 'constraints', constraints }

  // 2) retrieve fresh real candidates for the targeted category(ies)
  const center = prevCenter(previousPlan)
  const loc = { city: constraints.city, district: constraints.district, center }
  yield stage('retrieve', '召回替换候选', 'running')
  let pool: EnrichedPOI[] = []
  let amapStatus: 'ok' | 'empty' | 'not_configured' | 'error' = 'ok'
  let cacheHits = 0
  let cacheMisses = 0
  const needsRetrieve = op.op !== 'remove'
  if (needsRetrieve) {
    const retrieved = await deps.retrieve(keywordsForEdit(op, previousPlan), loc)
    pool = retrieved.pois
    amapStatus = retrieved.amapStatus
    cacheHits = retrieved.cacheHits
    cacheMisses = retrieved.cacheMisses
    if (pool.length === 0 && (amapStatus === 'error' || amapStatus === 'not_configured')) {
      yield stage('retrieve', '召回替换候选', 'fail')
      yield { type: 'error', code: 'upstream-unavailable', message: '高德 POI 服务暂不可用，未编造替换地点。', recoverable: true }
      return
    }
    yield stage('retrieve', '召回替换候选', 'ok', { summary: `${pool.length} 家真实候选` })
  } else {
    yield stage('retrieve', '召回替换候选', 'skip')
  }

  // 3) score the fresh pool so replacement selection + repair use real scores
  yield stage('score', '打分', 'running')
  const scoredPool = scorePOIs(pool, constraints, persona, center.lat, center.lng)
  yield stage('score', '打分', 'ok')

  // 4) apply the minimal edit (kept stops untouched)
  yield stage('build', '改方案', 'running')
  const { picks, changed, note } = applyEdit(op, previousPlan, scoredPool, constraints)
  if (picks.length < 2) {
    yield stage('build', '改方案', 'fail')
    yield { type: 'error', code: 'insufficient-data', message: '修改后行程过短，无法成行。', recoverable: true }
    return
  }
  yield stage('build', '改方案', changed ? 'ok' : 'skip', { summary: note })

  // 5) materialize → validate → repair (reuse the same core)
  let route = materializeRoute(picks, constraints, persona, 0)
  yield stage('validate', '体检', 'running')
  route = { ...route, checks: validateRoute(route, constraints, persona) }
  yield stage('validate', '体检', 'ok')

  yield stage('repair', '修复', 'running')
  // repair pool = kept-stop picks + fresh candidates, so it can downgrade/swap safely
  const repairPool = [...picks.map((p) => ({ ...p })), ...scoredPool]
  route = repairIfNeeded(route, constraints, persona, repairPool).route
  yield stage('repair', '修复', 'ok')

  // 6) rank (single route) → route event before explanation
  const ranked = rankRoutes([route], constraints, persona)
  const best = ranked[0]
  yield { type: 'route', route: stripRoute(best) }

  // 7) explanation
  yield stage('explain', '写推荐理由', 'running')
  let explanation = ''
  for await (const delta of deps.streamExplanation(best, constraints)) {
    explanation += delta
    yield { type: 'explanation', routeId: best.id, delta }
  }
  yield stage('explain', '写推荐理由', 'ok')

  // 8) persist + done
  const finalRoutes: Route[] = ranked.map((r, i) => (i === 0 ? { ...r, explanation } : r))
  const dataSources: DataSources = {
    amapPoi: { configured: true, used: amapStatus === 'ok' && needsRetrieve, status: amapStatus },
    amapRoute: { configured: true, used: best.stops.some((s) => s.legFromPrev?.mode === 'walk'), status: 'ok' },
    deepseek: { configured: !!explanation, used: !!explanation, status: explanation ? 'ok' : 'fallback' },
    cache: { hits: cacheHits, misses: cacheMisses },
  }
  const planId = deps.planId()
  await deps.savePlan({
    id: planId, userId: identity.userId, deviceToken: identity.deviceToken,
    request: req.request, constraints, routes: finalRoutes, dataSources,
  })
  yield { type: 'done', planId, routes: finalRoutes.map(stripRoute), dataSources }
}
