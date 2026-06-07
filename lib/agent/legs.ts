import type { Route, RouteStop } from '../../contract/index.js'
import { haversineM } from './geo.js'

/** Straight-line distance beyond which we don't even check walking — clearly a drive. */
const FAR_M = 2500
/** If the REAL walking time is within this, prefer walking over driving. */
const WALK_MAX_MIN = 20

export type LegMode = 'walk' | 'transit'
/** Real travel leg from Amap; returns null on failure so the caller can keep the estimate. */
export type LegFn = (
  from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: LegMode,
) => Promise<{ distM: number; minutes: number } | null>

/**
 * Replace a finalized route's estimated legs with real Amap walking/driving legs.
 * Mode is chosen by straight-line distance; each segment falls back to the existing
 * estimate (route.stops[i].legFromPrev) when the Amap call fails — never fabricated.
 * Arrival/departure times and walk/transit totals are recomputed from the real durations.
 */
export async function attachRealLegs(route: Route, leg: LegFn): Promise<Route> {
  const stops = route.stops
  if (stops.length === 0) return route

  const out: RouteStop[] = []
  let totalWalk = 0
  let totalTransit = 0
  let clock = stops[0].arrive // first arrival is unchanged

  for (let i = 0; i < stops.length; i += 1) {
    const s = stops[i]
    const stay = s.depart - s.arrive
    let legFromPrev = s.legFromPrev

    if (i > 0) {
      const prev = stops[i - 1].poi
      const cur = s.poi
      const from = { lat: prev.lat, lng: prev.lng }
      const to = { lat: cur.lat, lng: cur.lng }
      const straight = haversineM(prev.lat, prev.lng, cur.lat, cur.lng)
      // Decide mode from REAL walking time, not straight-line: try walking unless it's
      // clearly far; walk only if the actual walk is within tolerance, else drive.
      let chosen: { distM: number; minutes: number; mode: LegMode } | null = null
      if (straight <= FAR_M) {
        const walk = await leg(from, to, 'walk')
        if (walk && walk.minutes <= WALK_MAX_MIN) chosen = { ...walk, mode: 'walk' }
      }
      if (!chosen) {
        const drive = await leg(from, to, 'transit')
        if (drive) chosen = { ...drive, mode: 'transit' }
      }
      legFromPrev = chosen
        ?? s.legFromPrev
        ?? { distM: Math.round(straight), minutes: Math.max(1, Math.round(straight / 80)), mode: straight <= FAR_M ? 'walk' : 'transit' }

      const minutes = legFromPrev.minutes
      if (legFromPrev.mode === 'walk') totalWalk += minutes
      else totalTransit += minutes
      // arrive no earlier than the POI opens
      clock = Math.max(clock + minutes / 60, cur.openHour ?? clock + minutes / 60)
    } else {
      clock = Math.max(s.arrive, s.poi.openHour ?? s.arrive)
    }

    const arrive = i === 0 ? s.arrive : clock
    const depart = arrive + stay
    clock = depart
    out.push({ ...s, arrive, depart, legFromPrev })
  }

  return {
    ...route,
    stops: out,
    totalWalkMin: totalWalk,
    totalTransitMin: totalTransit,
    endTime: clock,
  }
}
