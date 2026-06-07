import type { Category, Constraints, Route, RouteStop, ScoredPOI } from '../../contract/index.js'
import type { Persona } from './types.js'
import { distBetween, haversineM, travelEstimate } from './geo.js'

const BEAM = 6
const TOPK_PER_SLOT = 7
const OUTPUT = 6

// Anchor clustering: filter candidates to within R metres of the anchor before composing.
// Adaptive — widen only when the tighter radius can't supply enough distinct categories.
const ANCHOR_RADII_M = [3000, 5000, 8000]
const MIN_CATS_IN_RADIUS = 2
const MIN_CANDIDATES_IN_RADIUS = 4

export interface BuildOpts {
  /** Geographic anchor; candidates beyond ANCHOR_RADII get filtered out (adaptive widen). */
  anchorCenter?: { lat: number; lng: number }
}

/** Densest-cluster fallback: the candidate whose R-neighbourhood is most crowded → its coords. */
export function densestClusterCenter(
  pois: Array<{ lat: number; lng: number }>, radiusM = 3000,
): { lat: number; lng: number } | null {
  if (!pois.length) return null
  let best = pois[0]
  let bestCount = -1
  for (const p of pois) {
    let count = 0
    for (const q of pois) {
      if (haversineM(p.lat, p.lng, q.lat, q.lng) <= radiusM) count += 1
    }
    if (count > bestCount) { bestCount = count; best = p }
  }
  return { lat: best.lat, lng: best.lng }
}

/** Adaptive radius filter: smallest R that yields enough distinct categories/candidates. */
function clusterToAnchor(scored: ScoredPOI[], center: { lat: number; lng: number }): ScoredPOI[] {
  let chosen: ScoredPOI[] = scored
  for (const r of ANCHOR_RADII_M) {
    const inside = scored.filter((s) => haversineM(center.lat, center.lng, s.poi.lat, s.poi.lng) <= r)
    const cats = new Set(inside.map((s) => s.poi.category)).size
    chosen = inside
    if (cats >= MIN_CATS_IN_RADIUS && inside.length >= MIN_CANDIDATES_IN_RADIUS) return inside
  }
  // Even the widest radius is sparse → use whatever the widest captured, else fall back to all.
  return chosen.length ? chosen : scored
}

const OPEN_FALLBACK = 0      // null openHour ⇒ treat as open from 00:00
const CLOSE_FALLBACK = 24    // null closeHour ⇒ treat as open until 24:00

function openOf(p: ScoredPOI['poi']): number { return p.openHour ?? OPEN_FALLBACK }
function closeOf(p: ScoredPOI['poi']): number { return p.closeHour ?? CLOSE_FALLBACK }
function durOf(p: ScoredPOI): number { return (p.poi as any).avgDuration ?? 60 }

export function planSlots(c: Constraints, persona: Persona): Category[] {
  const durH = c.durationMin / 60
  let n = durH <= 2.5 ? 3 : durH <= 4 ? 4 : 5
  if (c.pace === 'relaxed') n = Math.max(durH <= 3 ? 2 : 3, n - 1)
  if (c.pace === 'packed') n = Math.min(5, n + 1)

  const slots: Category[] = [...c.mustCategories]
  const fillers: Category[] = ['culture', 'dining', 'cafe', 'shopping', 'entertainment']
  for (const f of fillers) {
    if (slots.length >= n) break
    if (!slots.includes(f)) slots.push(f)
  }
  return slots.slice(0, n)
}

function topKForSlots(slots: Category[], scored: ScoredPOI[]): Map<number, ScoredPOI[]> {
  const byCat = new Map<Category, ScoredPOI[]>()
  for (const s of scored) {
    const arr = byCat.get(s.poi.category) ?? []
    arr.push(s)
    byCat.set(s.poi.category, arr)
  }
  const result = new Map<number, ScoredPOI[]>()
  slots.forEach((cat, idx) => {
    let pool = byCat.get(cat) ?? []
    // If this slot's category has no real candidates (e.g. a single-category outing
    // like a 古迹 citywalk where everything is `culture`), fall back to the overall
    // best-scored candidates so the slot can still be filled. Beam-search dedup keeps
    // stops distinct, so we get e.g. 3 distinct 古迹 instead of failing to compose.
    if (pool.length === 0) pool = scored
    result.set(idx, pool.slice(0, TOPK_PER_SLOT))
  })
  return result
}

interface PartialRoute {
  picks: ScoredPOI[]
  usedIds: Set<string>
  scoreSum: number
  penalty: number
}

function estimateEta(picks: ScoredPOI[], c: Constraints, persona: Persona): number {
  let clock = c.startTime
  for (let i = 0; i < picks.length; i++) {
    if (i > 0) {
      const d = distBetween(picks[i - 1].poi, picks[i].poi)
      clock += travelEstimate(d, persona.walkTolerance).minutes / 60
    }
    clock = Math.max(clock, openOf(picks[i].poi)) + durOf(picks[i]) / 60
  }
  return clock + 0.2
}

function effectiveLatestEnd(c: Constraints, persona: Persona): number {
  return Math.min(persona.latestEnd, c.startTime + c.durationMin / 60 + 0.25)
}

export function buildRouteCandidates(
  scored: ScoredPOI[], c: Constraints, persona: Persona, opts: BuildOpts = {},
): { slots: Category[]; routes: Route[] } {
  // Geo-cluster around the anchor (if any) so stops stay walkable, not scattered across the city.
  const clustered = opts.anchorCenter ? clusterToAnchor(scored, opts.anchorCenter) : scored
  const slots = planSlots(c, persona)
  const slotPools = topKForSlots(slots, clustered)
  const latestEnd = effectiveLatestEnd(c, persona)
  let beams: PartialRoute[] = [{ picks: [], usedIds: new Set(), scoreSum: 0, penalty: 0 }]

  for (let i = 0; i < slots.length; i++) {
    const pool = slotPools.get(i) ?? []
    const next: PartialRoute[] = []
    for (const beam of beams) {
      if (pool.length === 0) { next.push(beam); continue }
      const eta = estimateEta(beam.picks, c, persona)
      const feasible = pool.filter((cand) => {
        const arrive = Math.max(eta, openOf(cand.poi))
        if (arrive >= closeOf(cand.poi) - 0.01) return false
        if (arrive + durOf(cand) / 60 > latestEnd + 0.5) return false
        return true
      })
      const usePool = feasible.length ? feasible : pool
      let extended = 0
      for (const cand of usePool) {
        if (beam.usedIds.has(cand.poi.id)) continue
        let legPenalty = 0
        const prev = beam.picks[beam.picks.length - 1]
        if (prev) {
          const d = distBetween(prev.poi, cand.poi)
          // Stronger proximity bias: penalise long legs harder so tightly-clustered routes win.
          legPenalty = travelEstimate(d, persona.walkTolerance).minutes * 0.6
        }
        const waitPenalty = Math.max(0, openOf(cand.poi) - eta) * 6
        next.push({
          picks: [...beam.picks, cand],
          usedIds: new Set(beam.usedIds).add(cand.poi.id),
          scoreSum: beam.scoreSum + cand.score,
          penalty: beam.penalty + legPenalty + waitPenalty,
        })
        extended += 1
      }
      // Couldn't extend (every fallback candidate already used / infeasible) → keep the beam.
      if (extended === 0) next.push(beam)
    }
    next.sort((a, b) => (b.scoreSum - b.penalty) - (a.scoreSum - a.penalty))
    const seen = new Set<string>()
    beams = []
    for (const b of next) {
      const k = b.picks.map((p) => p.poi.id).sort().join('|')
      if (seen.has(k)) continue
      seen.add(k)
      beams.push(b)
      if (beams.length >= BEAM) break
    }
  }

  // Don't demand 3 stops when the user only asked for 2 things (e.g. 羊肉串+博物馆):
  // cap the minimum by how many distinct categories actually have real candidates.
  const availableCats = new Set(clustered.map((s) => s.poi.category)).size
  const target = c.pace === 'relaxed' && slots.length <= 2 ? 2 : 3
  const minStops = Math.max(2, Math.min(target, availableCats))
  const routes = beams
    .filter((b) => b.picks.length >= minStops)
    .slice(0, OUTPUT)
    .map((b, idx) => materializeRoute(b.picks, c, persona, idx))
  return { slots, routes }
}

function orderStops(picks: ScoredPOI[], c: Constraints): ScoredPOI[] {
  const night = picks.filter((p) => p.poi.category === 'nightscape')
  const meals = picks.filter((p) => p.poi.category === 'dining')
  const rest = picks.filter((p) => p.poi.category !== 'nightscape' && p.poi.category !== 'dining')

  const nnOrder: ScoredPOI[] = []
  const remaining = [...rest]
  if (remaining.length) {
    let curr = remaining.shift()!
    nnOrder.push(curr)
    while (remaining.length) {
      let bestIdx = 0
      let bestD = Infinity
      remaining.forEach((cand, idx) => {
        const d = distBetween(curr.poi, cand.poi)
        if (d < bestD) { bestD = d; bestIdx = idx }
      })
      curr = remaining.splice(bestIdx, 1)[0]
      nnOrder.push(curr)
    }
  }
  if (c.startTime >= 18) return [...meals, ...nnOrder, ...night]
  const mid = Math.floor(nnOrder.length / 2)
  return [...nnOrder.slice(0, mid), ...meals, ...nnOrder.slice(mid), ...night]
}

export function materializeRoute(
  picks: ScoredPOI[], c: Constraints, persona: Persona, seq: number,
): Route {
  const ordered = orderStops(picks, c)
  const stops: RouteStop[] = []
  let clock = c.startTime
  let totalWalk = 0
  let totalTransit = 0
  let cost = 0

  ordered.forEach((sp, i) => {
    let leg: RouteStop['legFromPrev'] = null
    if (i > 0) {
      const d = distBetween(ordered[i - 1].poi, sp.poi)
      const t = travelEstimate(d, persona.walkTolerance)
      leg = { distM: Math.round(d), minutes: t.minutes, mode: t.mode }
      clock += t.minutes / 60
      if (t.mode === 'walk') totalWalk += t.minutes; else totalTransit += t.minutes
    }
    const arrive = Math.max(clock, sp.poi.openHour ?? OPEN_FALLBACK)
    const depart = arrive + durOf(sp) / 60
    clock = depart
    cost += sp.poi.perCapita ?? 0
    stops.push({
      poi: sp.poi,
      arrive,
      depart,
      legFromPrev: leg,
      reasons: sp.reasons,
      sources: sp.sources,
    })
  })

  const coverage = [...new Set(stops.map((s) => s.poi.category))]
  return {
    id: `route-${seq}`,
    stops,
    totalCost: Math.round(cost),
    totalWalkMin: totalWalk,
    totalTransitMin: totalTransit,
    endTime: clock,
    coverage,
    checks: [],
    explanation: '',
    risks: [],
  }
}
