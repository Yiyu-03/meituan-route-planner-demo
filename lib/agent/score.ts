import type { Constraints, ScoredPOI, FieldSource } from '../../contract/index.js'
import type { EnrichedPOI, Persona, SceneTag } from './types.js'
import { haversineM } from './geo.js'

/** Weights after deleting popularity(10)+ugcBonus(3): +7→quality, +6→prefMatch. Sums to 100. */
export const SCORE_WEIGHTS = {
  quality: 25,
  sceneFit: 22,
  prefMatch: 28,
  budgetFit: 12,
  proximity: 8,
  companionFit: 5,
} as const

function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x))
}

/** rating may be null → neutral 0.5, never invented. */
function qualityScore(p: EnrichedPOI): number {
  if (p.rating == null) return 0.5
  return clamp((p.rating - 3.6) / (5 - 3.6))
}

function sceneFitScore(p: EnrichedPOI, persona: Persona): { v: number; hits: SceneTag[] } {
  let sum = 0
  const hits: SceneTag[] = []
  for (const tag of p.sceneTags) {
    const w = persona.sceneWeights[tag] ?? 0
    sum += w
    if (w >= 0.5) hits.push(tag)
  }
  return { v: clamp((sum + 1.2) / 3.2), hits }
}

function prefMatchScore(p: EnrichedPOI, c: Constraints): { v: number; hits: string[] } {
  if (c.prefs.length === 0) return { v: 0.5, hits: [] }
  const hits = c.prefs.filter((t) => (p.sceneTags as string[]).includes(t))
  let v = hits.length / c.prefs.length
  const avoidHit = c.avoid.filter((t) => (p.sceneTags as string[]).includes(t))
  v -= avoidHit.length * 0.25
  return { v: clamp(v), hits }
}

/** perCapita may be null → neutral. */
function budgetFitScore(p: EnrichedPOI, c: Constraints, persona: Persona): { v: number; over: boolean } {
  if (p.perCapita == null) return { v: 0.5, over: false }
  const budget = c.budgetPerCapita ?? (p.category === 'dining' ? c.diningBudgetPerCapita : null)
  if (budget == null) return { v: clamp(1 - p.perCapita / 600), over: false }
  const ratio = p.perCapita / budget
  if (ratio <= 1) return { v: clamp(0.6 + 0.4 * (1 - Math.abs(0.7 - ratio))), over: false }
  const penalty = (ratio - 1) * (1 + persona.budgetSensitivity * 2)
  return { v: clamp(1 - penalty), over: true }
}

function proximityScore(p: EnrichedPOI, centerLat: number, centerLng: number): number {
  return clamp(1 - haversineM(centerLat, centerLng, p.lat, p.lng) / 6000)
}

function companionFitScore(p: EnrichedPOI, c: Constraints): number {
  const party = c.party
  if (party >= 4) {
    let v = 0.5
    if (p.sceneTags.includes('lively')) v += 0.25
    if (p.sceneTags.includes('budget')) v += 0.1
    if (p.sceneTags.includes('quiet')) v -= 0.2
    return clamp(v)
  }
  if (party <= 1) {
    let v = 0.5
    if (p.sceneTags.includes('quiet')) v += 0.2
    if (p.sceneTags.includes('cultural')) v += 0.15
    if (p.sceneTags.includes('lively')) v -= 0.15
    return clamp(v)
  }
  let v = 0.55
  if (p.sceneTags.includes('romantic')) v += 0.15
  if (p.sceneTags.includes('photo')) v += 0.05
  return clamp(v)
}

const SCENE_LABEL: Record<string, string> = {
  romantic: '浪漫', quiet: '安静', photo: '拍照', family: '亲子', lively: '热闹',
  cultural: '文化', trendy: '潮流', local: '本地', upscale: '精致', budget: '实惠',
  nature: '自然', nightlife: '夜生活', foodie: '美食',
}

function buildReasons(
  p: EnrichedPOI, c: Constraints, persona: Persona, prefHits: string[], over: boolean,
): string[] {
  const r: string[] = []
  if (prefHits.length) r.push(`命中你的需求：${prefHits.map((t) => SCENE_LABEL[t] ?? t).join('、')}`)
  if (p.perCapita != null && c.diningBudgetPerCapita != null && p.category === 'dining') {
    r.push(over ? `正餐人均 ¥${p.perCapita}，略超吃饭预算` : `正餐人均 ¥${p.perCapita}，在 ¥${c.diningBudgetPerCapita} 预算内`)
  } else if (p.perCapita != null && c.budgetPerCapita != null) {
    r.push(over ? `人均 ¥${p.perCapita}，略超预算需留意` : `人均 ¥${p.perCapita}，在 ¥${c.budgetPerCapita} 预算内`)
  }
  if (p.rating != null && p.rating >= 4.5) r.push(`评分 ${p.rating}，口碑突出`)
  if (r.length === 0) {
    r.push(p.rating != null ? `综合评分 ${p.rating}` : `贴合「${persona.label}」这次的安排`)
  }
  return r.slice(0, 4)
}

export function scorePOI(
  p: EnrichedPOI, c: Constraints, persona: Persona, centerLat: number, centerLng: number,
): ScoredPOI {
  const quality = qualityScore(p)
  const { v: sceneFit } = sceneFitScore(p, persona)
  const { v: prefMatch, hits: prefHits } = prefMatchScore(p, c)
  const { v: budgetFit, over } = budgetFitScore(p, c, persona)
  const proximity = proximityScore(p, centerLat, centerLng)
  const companionFit = companionFitScore(p, c)
  const catBoost = 1 + (persona.categoryPriority[p.category] ?? 0) * 0.12

  const total =
    quality * SCORE_WEIGHTS.quality +
    sceneFit * SCORE_WEIGHTS.sceneFit * catBoost +
    prefMatch * SCORE_WEIGHTS.prefMatch +
    budgetFit * SCORE_WEIGHTS.budgetFit +
    proximity * SCORE_WEIGHTS.proximity +
    companionFit * SCORE_WEIGHTS.companionFit

  const sources: Record<string, FieldSource> = {
    rating: 'amap', perCapita: 'amap', sceneTags: 'derived', proximity: 'amap',
  }
  return {
    poi: p,
    score: Math.max(0, Math.min(100, +total.toFixed(1))),
    reasons: buildReasons(p, c, persona, prefHits, over),
    sources,
  }
}

export function scorePOIs(
  pois: EnrichedPOI[], c: Constraints, persona: Persona, centerLat: number, centerLng: number,
): ScoredPOI[] {
  return pois
    .map((p) => scorePOI(p, c, persona, centerLat, centerLng))
    .sort((a, b) => b.score - a.score)
}
