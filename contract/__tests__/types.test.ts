import { describe, it, expect } from 'vitest'
import { ConstraintsSchema, ScoredPOISchema, RouteSchema } from '../types.js'

describe('data schemas', () => {
  it('accepts a valid Constraints object', () => {
    const c = {
      city: '上海', district: '静安寺', startTime: 14, durationMin: 330,
      party: 2, budgetPerCapita: null, diningBudgetPerCapita: 300,
      prefs: ['quiet'], avoid: [], mustCategories: ['dining'],
      pace: 'normal', personaId: 'couple', raw: '周末下午…',
    }
    expect(() => ConstraintsSchema.parse(c)).not.toThrow()
  })

  it('rejects a POI that carries a fabricated review count (strict)', () => {
    const poi = {
      id: 'B0I6Y7URLT', name: '红子鸡凤凰楼', category: 'dining',
      city: '上海', area: '静安寺', lat: 31.24, lng: 121.44,
      rating: 4.8, perCapita: 137, tags: ['本帮菜'],
      openHour: 10.5, closeHour: 21, photos: [], tel: null,
      source: 'amap', reviews: 9999, // <-- not in schema, .strict() must reject
    }
    expect(() => ScoredPOISchema.shape.poi.parse(poi)).toThrow()
  })

  it('accepts a valid Route with stops', () => {
    const route = {
      id: 'route-0',
      stops: [{
        poi: { id: 'p1', name: '咖啡', category: 'cafe', city: '上海', area: '静安寺',
          lat: 31.2, lng: 121.4, rating: 4.5, perCapita: 78, tags: ['安静'],
          openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' },
        arrive: 14, depart: 15, legFromPrev: null, reasons: ['命中需求：安静'],
        sources: { rating: 'amap', perCapita: 'amap', sceneTags: 'derived' },
      }],
      totalCost: 78, totalWalkMin: 0, totalTransitMin: 0, endTime: 15,
      coverage: ['cafe'], checks: [], explanation: '', risks: [],
    }
    expect(() => RouteSchema.parse(route)).not.toThrow()
  })
})
