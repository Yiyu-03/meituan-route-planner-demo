import type { Constraints, DataSources, PlanRequest, POI, Route, ScoredPOI, SSEEvent } from '../../../contract/index'
import type { EnrichedPOI, RetrieveResult, UnderstandResult } from './types'
import { personaFor } from './persona'
import { scorePOIs } from './score'
import { buildRouteCandidates } from './build'
import { validateRoute } from './validate'
import { repairIfNeeded } from './repair'
import { rankRoutes } from './rank'

export interface LoopDeps {
  resolveLocation: (raw: string) => Promise<{ status: string; city: string | null; district?: string | null; center?: { lat: number; lng: number }; message?: string }>
  understand: (raw: string, loc: any, persona: any, preferences: any) => Promise<UnderstandResult>
  retrieve: (keywords: string[], loc: any) => Promise<RetrieveResult>
  streamExplanation: (route: Route, c: Constraints) => AsyncGenerator<string>
  savePlan: (record: any) => Promise<{ id: string }>
  planId: () => string
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

export async function* runPlanLoop(
  req: PlanRequest, identity: LoopIdentity, deps: LoopDeps,
): AsyncGenerator<SSEEvent> {
  const persona = personaFor(req.preferences.personaPick)

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

  // 4) score
  // City resolved but no district center? Use the centroid of the real retrieved
  // POIs as the proximity anchor — derived from real coordinates, never fabricated.
  const center = loc.center ?? {
    lat: retrieved.pois.reduce((s, p) => s + p.lat, 0) / retrieved.pois.length,
    lng: retrieved.pois.reduce((s, p) => s + p.lng, 0) / retrieved.pois.length,
  }
  yield stage('score', '打分', 'running')
  const pois: EnrichedPOI[] = retrieved.pois
  const scored = scorePOIs(pois, constraints, persona, center.lat, center.lng)
  yield stage('score', '打分', 'ok')
  yield { type: 'candidates', candidates: scored.map(stripScored) }

  // 5) build
  yield stage('build', '组合路线', 'running')
  const { routes: built } = buildRouteCandidates(scored, constraints, persona)
  if (built.length === 0) {
    yield stage('build', '组合路线', 'fail')
    yield { type: 'error', code: 'insufficient-data', message: '真实候选无法组成满足约束的路线。', recoverable: true }
    return
  }
  yield stage('build', '组合路线', 'ok', { summary: `${built.length} 条候选` })

  // 6) validate + repair
  yield stage('validate', '体检', 'running')
  const validated = built.map((r) => ({ ...r, checks: validateRoute(r, constraints, persona) }))
  yield stage('validate', '体检', 'ok')

  yield stage('repair', '修复', 'running')
  const repaired = validated.map((r) => repairIfNeeded(r, constraints, persona, scored).route)
  yield stage('repair', '修复', 'ok')

  // 7) rank → route event (seconds; before explanation)
  const ranked = rankRoutes(repaired, constraints, persona)
  const best = ranked[0]
  yield { type: 'route', route: stripRoute(best) }

  // 8) explanation (streamed, after route)
  yield stage('explain', '写推荐理由', 'running')
  let explanation = ''
  for await (const delta of deps.streamExplanation(best, constraints)) {
    explanation += delta
    yield { type: 'explanation', routeId: best.id, delta }
  }
  yield stage('explain', '写推荐理由', 'ok')

  // 9) persist + done
  const finalRoutes: Route[] = ranked.map((r, i) => (i === 0 ? { ...r, explanation } : r))
  const dataSources: DataSources = {
    amapPoi: { configured: true, used: retrieved.amapStatus === 'ok', status: retrieved.amapStatus },
    amapRoute: { configured: true, used: best.stops.some((s) => s.legFromPrev?.mode === 'walk'), status: 'ok' },
    deepseek: { configured: !!explanation, used: !!explanation, status: explanation ? 'ok' : 'fallback' },
    cache: { hits: retrieved.cacheHits, misses: retrieved.cacheMisses },
  }
  const planId = deps.planId()
  await deps.savePlan({
    id: planId, userId: identity.userId, deviceToken: identity.deviceToken,
    request: req.request, constraints, routes: finalRoutes, dataSources,
  })
  yield { type: 'done', planId, routes: finalRoutes.map(stripRoute), dataSources }
}
