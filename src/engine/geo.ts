import type { POI, LegMode } from '../types';

/** Haversine 球面距离,返回米 */
export function haversineM(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distBetween(a: POI, b: POI): number {
  return haversineM(a.lat, a.lng, b.lat, b.lng);
}

/**
 * 估算两点间出行时间(分钟)与方式。
 * < 1.0km 步行;否则按地铁/打车折算(含固定接驳开销)。
 * walkTolerance 决定多远以内仍优先步行。
 */
export function travelEstimate(
  distM: number,
  walkToleranceMin: number,
): { minutes: number; mode: LegMode } {
  const walkSpeed = 80;            // 米/分钟 ≈ 4.8km/h
  const walkMin = Math.round(distM / walkSpeed);
  if (walkMin <= walkToleranceMin) {
    return { minutes: walkMin, mode: 'walk' };
  }
  // 地铁/打车:固定 8 分钟接驳 + 350 米/分钟均速
  const transitMin = Math.round(8 + distM / 350);
  return { minutes: transitMin, mode: 'transit' };
}

export function fmtDist(distM: number): string {
  if (distM < 1000) return `${Math.round(distM)} m`;
  return `${(distM / 1000).toFixed(1)} km`;
}
