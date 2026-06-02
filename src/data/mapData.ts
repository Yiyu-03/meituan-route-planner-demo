import type { MapLeg, POI } from '../types';
import { distBetween } from '../engine/geo';

export function buildMapLeg(from: POI, to: POI, walkTolerance: number): MapLeg {
  const distanceM = Math.round(distBetween(from, to));
  const walkingMinutes = Math.max(3, Math.round(distanceM / 80));
  const transitMinutes = Math.max(8, Math.round(distanceM / 220 + 6));
  const chosenMode = walkingMinutes <= walkTolerance ? 'walk' : 'transit';
  const etaSource = (from.id.charCodeAt(0) + to.id.charCodeAt(0)) % 2 === 0
    ? 'mock_map'
    : 'mock_meituan';

  return {
    fromPoiId: from.id,
    toPoiId: to.id,
    distanceM,
    walkingMinutes,
    transitMinutes,
    chosenMode,
    etaSource,
    etaConfidence: distanceM < 1600 ? 0.92 : 0.84,
  };
}

