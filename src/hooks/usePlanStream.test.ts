import { describe, it, expect } from 'vitest'
import { planReducer, initialPlanState } from './usePlanStream'
import type { SSEEvent, Route, Constraints, DataSources } from '../../contract'

const stage: SSEEvent = { type: 'stage', key: 'retrieve', label: '召回', status: 'ok', ms: 120 }
const route: SSEEvent = {
  type: 'route',
  route: {
    id: 'route-0', stops: [], totalCost: 78, totalWalkMin: 0, totalTransitMin: 0,
    endTime: 15, coverage: ['cafe'], checks: [], explanation: '', risks: [],
  },
}
const expl1: SSEEvent = { type: 'explanation', routeId: 'route-0', delta: '先到' }
const expl2: SSEEvent = { type: 'explanation', routeId: 'route-0', delta: '咖啡馆' }
const err: SSEEvent = { type: 'error', code: 'insufficient-data', message: '真实地点不足', recoverable: true }

describe('planReducer', () => {
  it('records stage progress', () => {
    const s = planReducer(initialPlanState(), stage)
    expect(s.stages.find((x) => x.key === 'retrieve')?.status).toBe('ok')
  })
  it('stores the route when it arrives', () => {
    const s = planReducer(initialPlanState(), route)
    expect(s.route?.id).toBe('route-0')
  })
  it('accumulates explanation deltas per routeId', () => {
    let s = planReducer(initialPlanState(), expl1)
    s = planReducer(s, expl2)
    expect(s.explanations['route-0']).toBe('先到咖啡馆')
  })
  it('captures a terminal error', () => {
    const s = planReducer(initialPlanState(), err)
    expect(s.error?.code).toBe('insufficient-data')
  })
  it('loads an existing plan record as current state', () => {
    const loadedRoute: Route = {
      id: 'hist-route', stops: [], totalCost: 200, totalWalkMin: 12, totalTransitMin: 0,
      endTime: 18, coverage: ['cafe'], checks: [],
      explanation: '历史方案说明', risks: [],
    }
    const constraints: Constraints = {
      city: '上海', district: '静安', startTime: 14, durationMin: 240, party: 2,
      budgetPerCapita: 300, diningBudgetPerCapita: null, prefs: [], avoid: [],
      mustCategories: [], pace: 'normal', personaId: 'couple',
      raw: '静安咖啡',
    }
    const dataSources: DataSources = {
      amapPoi: { configured: true, used: true, status: 'ok' },
      amapRoute: { configured: true, used: true, status: 'ok' },
      deepseek: { configured: true, used: true, status: 'ok' },
      cache: { hits: 0, misses: 0 },
    }
    const s = planReducer(initialPlanState(), {
      type: 'load',
      planId: 'p-hist',
      route: loadedRoute,
      constraints,
      dataSources,
    })
    expect(s.route?.id).toBe('hist-route')
    expect(s.constraints?.city).toBe('上海')
    expect(s.planId).toBe('p-hist')
    expect(s.dataSources).toBe(dataSources)
    expect(s.explanations['hist-route']).toBe('历史方案说明')
    expect(s.streaming).toBe(false)
  })
  it('resets back to the initial input state', () => {
    const seeded = planReducer(initialPlanState(), route)
    const s = planReducer(seeded, { type: 'reset' })
    expect(s.route).toBeNull()
    expect(s.constraints).toBeNull()
    expect(s.error).toBeNull()
  })
})
