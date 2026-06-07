import { describe, it, expect } from 'vitest'
import { repairIfNeeded } from './repair.js'
import { materializeRoute } from './build.js'
import { validateRoute } from './validate.js'
import { scorePOIs } from './score.js'
import { personaFor } from './persona.js'
import type { EnrichedPOI } from './types.js'
import type { Constraints } from '../../contract/index.js'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap', sceneTags: [], avgDuration: 50, ...over,
  }
}

const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: [], avoid: [],
  mustCategories: ['cafe'], pace: 'normal', personaId: 'couple', raw: '人均200',
}
const persona = personaFor('couple')

describe('repairIfNeeded', () => {
  it('swaps an over-budget stop for a cheaper same-category candidate', () => {
    const pool: EnrichedPOI[] = [
      poi({ id: 'expensive', category: 'cafe', perCapita: 180 }),
      poi({ id: 'cheap', category: 'cafe', perCapita: 40, lat: 31.221, lng: 121.441 }),
      poi({ id: 'dine', category: 'dining', perCapita: 120, lat: 31.222, lng: 121.442 }),
      poi({ id: 'cult', category: 'culture', perCapita: 0, lat: 31.223, lng: 121.443, avgDuration: 90 }),
    ]
    const scored = scorePOIs(pool, c, persona, 31.22, 121.44)
    const picks = [scored.find((s) => s.poi.id === 'expensive')!, scored.find((s) => s.poi.id === 'dine')!, scored.find((s) => s.poi.id === 'cult')!]
    let route = materializeRoute(picks, c, persona, 0)
    route = { ...route, checks: validateRoute(route, c, persona) }
    const { route: fixed, logs } = repairIfNeeded(route, c, persona, scored)
    expect(fixed.totalCost).toBeLessThanOrEqual(route.totalCost)
    expect(logs.length).toBeGreaterThan(0)
  })
})
