import { describe, it, expect, vi } from 'vitest'
import { attachRealLegs } from './legs.js'

function poi(id: string, lat: number, lng: number) {
  return {
    id, name: id, category: 'dining' as const, city: '北京', area: '海淀',
    lat, lng, rating: 4.5, perCapita: 80, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap' as const,
  }
}
function stop(p: ReturnType<typeof poi>, arrive: number, depart: number, leg: any = null) {
  return { poi: p, arrive, depart, legFromPrev: leg, reasons: [], sources: {} }
}
function route() {
  return {
    id: 'route-0',
    stops: [
      // close pair (~150m) then a far pair (~5km)
      stop(poi('a', 39.9900, 116.3100), 9, 10),
      stop(poi('b', 39.9912, 116.3110), 10.2, 11.2, { distM: 160, minutes: 2, mode: 'walk' }),
      stop(poi('c', 40.0300, 116.3600), 11.5, 12.5, { distM: 5000, minutes: 14, mode: 'transit' }),
    ],
    totalCost: 240, totalWalkMin: 0, totalTransitMin: 0, endTime: 12.5,
    coverage: ['dining'], checks: [], explanation: '', risks: [],
  }
}

describe('attachRealLegs', () => {
  it('uses real Amap legs and picks mode by straight-line distance', async () => {
    const leg = vi.fn(async (_f, _t, mode) =>
      mode === 'walk' ? { distM: 180, minutes: 3 } : { distM: 5200, minutes: 18 })
    const out = await attachRealLegs(route() as any, leg)
    // leg 1 close → walk, leg 2 far → transit
    expect(leg).toHaveBeenCalledTimes(2)
    expect(out.stops[1].legFromPrev).toEqual({ distM: 180, minutes: 3, mode: 'walk' })
    expect(out.stops[2].legFromPrev).toEqual({ distM: 5200, minutes: 18, mode: 'transit' })
    expect(out.totalWalkMin).toBe(3)
    expect(out.totalTransitMin).toBe(18)
  })

  it('falls back to the existing estimate leg when Amap returns null (no fabrication)', async () => {
    const leg = vi.fn(async () => null)
    const out = await attachRealLegs(route() as any, leg)
    // keeps the original estimate legs
    expect(out.stops[1].legFromPrev).toEqual({ distM: 160, minutes: 2, mode: 'walk' })
    expect(out.stops[2].legFromPrev).toEqual({ distM: 5000, minutes: 14, mode: 'transit' })
    expect(out.totalWalkMin).toBe(2)
    expect(out.totalTransitMin).toBe(14)
  })

  it('recomputes arrival/departure clock from real durations', async () => {
    const leg = vi.fn(async (_f, _t, mode) => (mode === 'walk' ? { distM: 180, minutes: 6 } : { distM: 5200, minutes: 30 }))
    const out = await attachRealLegs(route() as any, leg)
    // first stop unchanged
    expect(out.stops[0].arrive).toBe(9)
    // stay durations preserved (b: 1h, c: 1h)
    expect(out.stops[1].depart - out.stops[1].arrive).toBeCloseTo(1, 5)
    expect(out.stops[2].depart - out.stops[2].arrive).toBeCloseTo(1, 5)
    // later than the original estimate because real legs are longer
    expect(out.endTime).toBeGreaterThan(12.5)
  })
})
