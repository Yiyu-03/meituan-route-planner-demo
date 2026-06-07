import type { POI } from '../../contract/index.js'

/** Haversine great-circle distance in metres. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function distBetween(a: POI, b: POI): number {
  return haversineM(a.lat, a.lng, b.lat, b.lng)
}

/** Estimate travel minutes + mode. < walkTolerance ⇒ walk; else transit with fixed transfer overhead. */
export function travelEstimate(
  distM: number, walkToleranceMin: number,
): { minutes: number; mode: 'walk' | 'transit' } {
  const walkSpeed = 80 // metres/min ≈ 4.8 km/h
  const walkMin = Math.round(distM / walkSpeed)
  if (walkMin <= walkToleranceMin) return { minutes: walkMin, mode: 'walk' }
  const transitMin = Math.round(8 + distM / 350)
  return { minutes: transitMin, mode: 'transit' }
}
