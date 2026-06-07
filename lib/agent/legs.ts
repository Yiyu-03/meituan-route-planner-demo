import type { Route, RouteStop } from '../../contract/index.js'
import { haversineM } from './geo.js'

/** Beyond this straight-line distance, a leg is driven/transit rather than walked. */
const WALK_MAX_M = 1300

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
      const straight = haversineM(prev.lat, prev.lng, cur.lat, cur.lng)
      const mode: LegMode = straight <= WALK_MAX_M ? 'walk' : 'transit'
      const real = await leg({ lat: prev.lat, lng: prev.lng }, { lat: cur.lat, lng: cur.lng }, mode)
      legFromPrev = real
        ? { distM: real.distM, minutes: real.minutes, mode }
        : (s.legFromPrev ?? { distM: Math.round(straight), minutes: Math.max(1, Math.round(straight / 80)), mode })

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
