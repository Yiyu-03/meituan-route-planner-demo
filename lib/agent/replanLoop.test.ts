import { describe, it, expect } from 'vitest'
import { runPlanLoop } from './loop'
import { SSEEventSchema } from '../../contract/index'
import type { EnrichedPOI } from './types'
import type { Route, RouteStop, POI } from '../../contract/index'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap', sceneTags: ['quiet'], avgDuration: 50, ...over,
  }
}

function cpoi(over: Partial<POI>): POI {
  const { ...rest } = poi(over) as any
  delete rest.sceneTags
  delete rest.avgDuration
  return rest as POI
}

function stop(p: Partial<POI>, over: Partial<RouteStop> = {}): RouteStop {
  return { poi: cpoi(p), arrive: 14, depart: 15, legFromPrev: null, reasons: [], sources: {}, ...over }
}

// 3-stop previous plan: cafe, dining(expensive), culture
const previousPlan: Route = {
  id: 'route-0',
  stops: [
    stop({ id: 'cafe1', category: 'cafe', name: '原咖啡', perCapita: 60, rating: 4.4, lat: 31.220, lng: 121.440 }),
    stop({ id: 'dine1', category: 'dining', name: '贵餐厅', perCapita: 220, rating: 4.3, lat: 31.223, lng: 121.443 }),
    stop({ id: 'cult1', category: 'culture', name: '美术馆', perCapita: 0, rating: 4.6, lat: 31.225, lng: 121.445 }),
  ],
  totalCost: 280, totalWalkMin: 12, totalTransitMin: 0, endTime: 18,
  coverage: ['cafe', 'dining', 'culture'], checks: [], explanation: '', risks: [],
}

const baseDeps = {
  resolveLocation: async () => ({ status: 'resolved', city: '上海', district: '静安区', center: { lat: 31.22, lng: 121.44 } }),
  understand: async () => ({
    constraints: {
      city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
      budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: [], avoid: [],
      mustCategories: ['cafe', 'dining', 'culture'], pace: 'normal', personaId: 'couple', raw: '',
    },
    keywords: ['静安区 咖啡'], llmUsed: false,
  }),
  retrieve: async () => ({ pois: [], center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const }),
  streamExplanation: async function* () { yield '改后的推荐理由。' },
  savePlan: async () => ({ id: 'plan-2' }),
  planId: () => 'plan-2',
}

function req(request: string, previousPlan: Route | null) {
  return {
    request,
    preferences: { personaPick: 'couple' as const, prefs: [], budgetPref: null },
    previousPlan,
  }
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = []
  for await (const e of gen) out.push(e)
  return out
}

function lastRoute(events: any[]): Route {
  const done = events.find((e) => e.type === 'done')
  return done.routes[0]
}

describe('runPlanLoop · replan branch', () => {
  it('emits the same contract-valid sequence (route before explanation, ends in done)', async () => {
    // cheaper dining candidate available
    const deps = {
      ...baseDeps,
      retrieve: async () => ({
        pois: [poi({ id: 'dine2', category: 'dining', name: '便宜餐厅', perCapita: 120, rating: 4.5, lat: 31.223, lng: 121.443 })],
        center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const,
      }),
    }
    const events = await collect(runPlanLoop(req('第二家换便宜点的', previousPlan), { deviceToken: 'd', userId: null }, deps as any))
    for (const e of events) expect(() => SSEEventSchema.parse(e)).not.toThrow()
    const types = events.map((e) => e.type)
    expect(types).toContain('route')
    expect(types.indexOf('route')).toBeLessThan(types.indexOf('explanation'))
    expect(types.at(-1)).toBe('done')
  })

  it('cheaper @ index 1: only stop 1 changes, others keep id, totalCost drops', async () => {
    const deps = {
      ...baseDeps,
      retrieve: async () => ({
        pois: [poi({ id: 'dine2', category: 'dining', name: '便宜餐厅', perCapita: 120, rating: 4.5, lat: 31.223, lng: 121.443 })],
        center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const,
      }),
    }
    const events = await collect(runPlanLoop(req('第二家换便宜点的', previousPlan), { deviceToken: 'd', userId: null }, deps as any))
    const route = lastRoute(events)
    expect(route.stops.length).toBe(3)
    const ids = route.stops.map((s) => s.poi.id)
    expect(ids[0]).toBe('cafe1')
    expect(ids[2]).toBe('cult1')
    expect(ids[1]).toBe('dine2')
    expect(route.totalCost).toBeLessThan(previousPlan.totalCost)
  })

  it('remove cafe: that category stop is dropped, count -1', async () => {
    const events = await collect(runPlanLoop(req('把咖啡那站去掉', previousPlan), { deviceToken: 'd', userId: null }, baseDeps as any))
    const route = lastRoute(events)
    expect(route.stops.length).toBe(2)
    expect(route.stops.some((s) => s.poi.category === 'cafe')).toBe(false)
    expect(route.stops.map((s) => s.poi.id)).toEqual(['dine1', 'cult1'])
  })

  it('rebudget to 200: constraints budget = 200 and repaired route within budget', async () => {
    // provide a cheaper dining candidate so repair can bring cost under 200
    const deps = {
      ...baseDeps,
      retrieve: async () => ({
        pois: [poi({ id: 'dine3', category: 'dining', name: '小馆', perCapita: 90, rating: 4.4, lat: 31.223, lng: 121.443 })],
        center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const,
      }),
    }
    const events = await collect(runPlanLoop(req('整体预算降到200', previousPlan), { deviceToken: 'd', userId: null }, deps as any))
    const cons = events.find((e) => e.type === 'constraints')
    expect(cons.constraints.budgetPerCapita).toBe(200)
    const route = lastRoute(events)
    expect(route.totalCost).toBeLessThanOrEqual(200)
  })

  it('higher_rated dining: dining stop rating increases', async () => {
    const deps = {
      ...baseDeps,
      retrieve: async () => ({
        pois: [poi({ id: 'dine4', category: 'dining', name: '高分餐厅', perCapita: 210, rating: 4.9, lat: 31.223, lng: 121.443 })],
        center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const,
      }),
    }
    const events = await collect(runPlanLoop(req('换一家评分更高的餐厅', previousPlan), { deviceToken: 'd', userId: null }, deps as any))
    const route = lastRoute(events)
    const dining = route.stops.find((s) => s.poi.category === 'dining')!
    expect(dining.poi.id).toBe('dine4')
    expect(dining.poi.rating!).toBeGreaterThan(4.3)
  })

  it('uses injected editChatJson to resolve an ambiguous edit', async () => {
    // ambiguous instruction; LLM resolves it to higher_rated on dining
    const deps = {
      ...baseDeps,
      editChatJson: async () => ({ op: 'higher_rated', targetIndex: 1, targetCategory: 'dining', newBudget: null }),
      retrieve: async () => ({
        pois: [poi({ id: 'dine9', category: 'dining', name: '顶级餐厅', perCapita: 215, rating: 4.95, lat: 31.223, lng: 121.443 })],
        center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const,
      }),
    }
    const events = await collect(runPlanLoop(req('调一下吧', previousPlan), { deviceToken: 'd', userId: null }, deps as any))
    const route = lastRoute(events)
    const dining = route.stops.find((s) => s.poi.category === 'dining')!
    expect(dining.poi.id).toBe('dine9')
  })

  it('no replacement found: keeps original node honestly (no fabrication)', async () => {
    // retrieve returns nothing usable → original dining stays
    const events = await collect(runPlanLoop(req('换一家评分更高的餐厅', previousPlan), { deviceToken: 'd', userId: null }, baseDeps as any))
    const route = lastRoute(events)
    const dining = route.stops.find((s) => s.poi.category === 'dining')!
    expect(dining.poi.id).toBe('dine1')
    expect(route.stops.length).toBe(3)
  })
})
