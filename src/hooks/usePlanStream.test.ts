import { describe, it, expect } from 'vitest'
import { planReducer, initialPlanState } from './usePlanStream'
import type { SSEEvent } from '../../contract'

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
})
