import { describe, it, expect } from 'vitest'
import { validateRoute } from './validate'
import { personaFor } from './persona'
import type { Constraints, Route } from '../../../contract/index'

const persona = personaFor('couple')
const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: [], avoid: [],
  mustCategories: ['cafe', 'dining'], pace: 'normal', personaId: 'couple', raw: '人均200',
}

function route(over: Partial<Route> = {}): Route {
  const stop = {
    poi: { id: 'p1', name: '咖啡', category: 'cafe' as const, city: '上海', area: '静安区',
      lat: 31.2, lng: 121.4, rating: 4.5, perCapita: 78, tags: [], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' as const },
    arrive: 14, depart: 15, legFromPrev: null, reasons: [], sources: {},
  }
  return {
    id: 'r', stops: [stop], totalCost: 78, totalWalkMin: 0, totalTransitMin: 0, endTime: 15,
    coverage: ['cafe'], checks: [], explanation: '', risks: [], ...over,
  }
}

describe('validateRoute', () => {
  it('never emits a queue check', () => {
    const checks = validateRoute(route(), c, persona)
    expect(checks.find((k) => k.key === 'queue')).toBeUndefined()
  })

  it('flags budget overrun as warn/fail', () => {
    const checks = validateRoute(route({ totalCost: 260 }), c, persona)
    const budget = checks.find((k) => k.key === 'budget')!
    expect(['warn', 'fail']).toContain(budget.status)
  })

  it('does not fail open check when openHour is null', () => {
    const r = route()
    r.stops[0].poi = { ...r.stops[0].poi, openHour: null, closeHour: null }
    const open = validateRoute(r, c, persona).find((k) => k.key === 'open')!
    expect(open.status).toBe('pass')
  })
})
