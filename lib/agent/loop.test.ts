import { describe, it, expect } from 'vitest'
import { runPlanLoop } from './loop'
import { SSEEventSchema } from '../../contract/index'
import type { EnrichedPOI } from './types'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap', sceneTags: ['quiet'], avgDuration: 50, ...over,
  }
}

const realPois: EnrichedPOI[] = [
  poi({ id: 'cafe1', category: 'cafe', sceneTags: ['quiet'] }),
  poi({ id: 'dine1', category: 'dining', perCapita: 120, lat: 31.223, lng: 121.443 }),
  poi({ id: 'cult1', category: 'culture', perCapita: 0, lat: 31.225, lng: 121.445, avgDuration: 90 }),
]

const baseDeps = {
  resolveLocation: async () => ({ status: 'resolved', city: '上海', district: '静安区', center: { lat: 31.22, lng: 121.44 } }),
  understand: async () => ({
    constraints: {
      city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
      budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
      mustCategories: ['cafe', 'dining', 'culture'], pace: 'normal', personaId: 'couple', raw: '安静咖啡',
    },
    keywords: ['静安区 咖啡'], llmUsed: false,
  }),
  retrieve: async () => ({ pois: realPois, center: { lat: 31.22, lng: 121.44 }, cacheHits: 1, cacheMisses: 1, amapStatus: 'ok' as const }),
  streamExplanation: async function* () { yield '推荐理由。' },
  savePlan: async () => ({ id: 'plan-1' }),
  planId: () => 'plan-1',
}

const request = {
  request: '周末下午静安找个安静咖啡，再吃顿本帮菜',
  preferences: { personaPick: 'couple' as const, prefs: ['quiet'], budgetPref: null },
  previousPlan: null,
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('runPlanLoop', () => {
  it('emits a contract-valid event sequence ending in done, route before explanation', async () => {
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, baseDeps as any))
    for (const e of events) expect(() => SSEEventSchema.parse(e)).not.toThrow()
    const types = events.map((e) => e.type)
    expect(types).toContain('constraints')
    expect(types).toContain('candidates')
    expect(types.indexOf('route')).toBeLessThan(types.indexOf('explanation'))
    expect(types.at(-1)).toBe('done')
  })

  it('emits needs-clarification when no city resolves (no fake fallback)', async () => {
    const deps = { ...baseDeps, resolveLocation: async () => ({ status: 'needs-clarification', city: null, message: '需要城市' }) }
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, deps as any))
    const err = events.find((e) => e.type === 'error')
    expect(err.code).toBe('needs-clarification')
    expect(events.some((e) => e.type === 'route')).toBe(false)
  })

  it('emits insufficient-data when fewer than 2 real POIs', async () => {
    const deps = { ...baseDeps, retrieve: async () => ({ pois: [realPois[0]], center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const }) }
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, deps as any))
    expect(events.find((e) => e.type === 'error').code).toBe('insufficient-data')
  })

  it('emits upstream-unavailable when amap errors with no data', async () => {
    const deps = { ...baseDeps, retrieve: async () => ({ pois: [], center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'error' as const }) }
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, deps as any))
    expect(events.find((e) => e.type === 'error').code).toBe('upstream-unavailable')
  })
})
