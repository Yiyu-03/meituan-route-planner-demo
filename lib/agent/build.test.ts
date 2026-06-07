import { describe, it, expect } from 'vitest'
import { buildRouteCandidates, materializeRoute } from './build.js'
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
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['cafe', 'dining', 'culture'], pace: 'normal', personaId: 'couple', raw: '安静',
}

const persona = personaFor('couple')

const pois: EnrichedPOI[] = [
  poi({ id: 'cafe1', category: 'cafe', sceneTags: ['quiet'], lat: 31.221, lng: 121.441 }),
  poi({ id: 'cafe2', category: 'cafe', sceneTags: ['quiet'], lat: 31.222, lng: 121.442 }),
  poi({ id: 'dine1', category: 'dining', perCapita: 120, lat: 31.223, lng: 121.443 }),
  poi({ id: 'dine2', category: 'dining', perCapita: 160, lat: 31.224, lng: 121.444 }),
  poi({ id: 'cult1', category: 'culture', perCapita: 0, lat: 31.225, lng: 121.445, avgDuration: 90 }),
  poi({ id: 'cult2', category: 'culture', perCapita: 0, lat: 31.226, lng: 121.446, avgDuration: 90 }),
]

describe('buildRouteCandidates', () => {
  it('produces routes that are contract-shaped with >=3 stops', () => {
    const scored = scorePOIs(pois, c, persona, 31.22, 121.44)
    const { routes } = buildRouteCandidates(scored, c, persona)
    expect(routes.length).toBeGreaterThan(0)
    const r = routes[0]
    expect(r.stops.length).toBeGreaterThanOrEqual(3)
    expect(r.stops[0].poi.source).toBe('amap')
    expect(r.stops[1].legFromPrev).not.toBeNull()
    expect(typeof r.totalCost).toBe('number')
    expect(Array.isArray(r.coverage)).toBe(true)
  })
})

describe('materializeRoute', () => {
  it('treats null openHour as always-open (no fabrication)', () => {
    const scored = scorePOIs(
      [poi({ id: 'a', category: 'cafe', openHour: null, closeHour: null }),
       poi({ id: 'b', category: 'dining', openHour: null, closeHour: null, perCapita: 90 }),
       poi({ id: 'd', category: 'culture', openHour: null, closeHour: null, perCapita: 0 })],
      c, persona, 31.22, 121.44,
    )
    const route = materializeRoute(scored, c, persona, 0)
    expect(route.stops.every((s) => Number.isFinite(s.arrive) && Number.isFinite(s.depart))).toBe(true)
  })
})
