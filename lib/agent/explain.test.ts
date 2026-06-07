import { describe, it, expect } from 'vitest'
import { deterministicExplanation, streamExplanation } from './explain'
import type { Constraints, Route } from '../../contract/index'

const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['cafe', 'dining'], pace: 'normal', personaId: 'couple', raw: '安静咖啡',
}

const route: Route = {
  id: 'route-0',
  stops: [
    { poi: { id: 'a', name: '安静咖啡馆', category: 'cafe', city: '上海', area: '静安区', lat: 31.2, lng: 121.4, rating: 4.6, perCapita: 78, tags: [], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' }, arrive: 14, depart: 15, legFromPrev: null, reasons: ['命中你的需求：安静'], sources: {} },
    { poi: { id: 'b', name: '老饭店', category: 'dining', city: '上海', area: '静安区', lat: 31.21, lng: 121.41, rating: 4.4, perCapita: 130, tags: [], openHour: 11, closeHour: 21, photos: [], tel: null, source: 'amap' }, arrive: 15.5, depart: 16.8, legFromPrev: { distM: 600, minutes: 8, mode: 'walk' }, reasons: [], sources: {} },
  ],
  totalCost: 208, totalWalkMin: 8, totalTransitMin: 0, endTime: 16.8,
  coverage: ['cafe', 'dining'], checks: [], explanation: '', risks: [],
}

describe('deterministicExplanation', () => {
  it('mentions every stop name in order', () => {
    const text = deterministicExplanation(route, c)
    expect(text.indexOf('安静咖啡馆')).toBeLessThan(text.indexOf('老饭店'))
    expect(text.length).toBeGreaterThan(10)
  })
})

describe('streamExplanation', () => {
  it('falls back to deterministic text when llm yields nothing', async () => {
    const deltas: string[] = []
    for await (const d of streamExplanation(route, c, { apiKey: '', stream: async function* () {} })) {
      deltas.push(d)
    }
    expect(deltas.join('')).toBe(deterministicExplanation(route, c))
  })

  it('passes through llm deltas when present', async () => {
    const deltas: string[] = []
    async function* fake() { yield '先到'; yield '咖啡馆。' }
    for await (const d of streamExplanation(route, c, { apiKey: 'K', stream: fake })) deltas.push(d)
    expect(deltas).toEqual(['先到', '咖啡馆。'])
  })
})
