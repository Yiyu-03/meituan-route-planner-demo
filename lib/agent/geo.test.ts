import { describe, it, expect } from 'vitest'
import { haversineM, travelEstimate } from './geo'

describe('geo', () => {
  it('haversine returns ~0 for identical points', () => {
    expect(haversineM(31.2, 121.4, 31.2, 121.4)).toBeCloseTo(0, 5)
  })

  it('haversine measures a known ~1.5km gap', () => {
    const d = haversineM(31.2240, 121.4430, 31.2300, 121.4560)
    expect(d).toBeGreaterThan(1000)
    expect(d).toBeLessThan(2000)
  })

  it('short distance picks walk, long distance picks transit', () => {
    expect(travelEstimate(400, 20).mode).toBe('walk')
    expect(travelEstimate(6000, 20).mode).toBe('transit')
  })
})
