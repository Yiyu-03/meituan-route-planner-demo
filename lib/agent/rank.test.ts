import { describe, it, expect } from 'vitest'
import { rankRoutes } from './rank.js'
import { personaFor } from './persona.js'
import type { Constraints, Route } from '../../contract/index.js'

const persona = personaFor('couple')
const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: [], avoid: [],
  mustCategories: ['cafe'], pace: 'normal', personaId: 'couple', raw: '人均200',
}

function route(id: string, totalCost: number, checks: Route['checks']): Route {
  return {
    id, stops: [], totalCost, totalWalkMin: 10, totalTransitMin: 0, endTime: 18,
    coverage: ['cafe'], checks, explanation: '', risks: [],
  }
}

describe('rankRoutes', () => {
  it('ranks the in-budget, all-pass route first and renames it route-0', () => {
    const good = route('a', 180, [{ key: 'budget', label: '预算', status: 'pass', detail: '' }])
    const bad = route('b', 320, [{ key: 'budget', label: '预算', status: 'fail', detail: '' }])
    const ranked = rankRoutes([bad, good], c, persona)
    expect(ranked[0].totalCost).toBe(180)
    expect(ranked[0].id).toBe('route-0')
    expect(ranked[1].id).toBe('route-1')
  })
})
