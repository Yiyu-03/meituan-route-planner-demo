import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { planReducer, initialPlanState, usePlanStream } from './usePlanStream'
import * as planStreamApi from '../api/planStream'
import type { SSEEvent, Route, Constraints, DataSources, PlanRequest } from '../../contract'

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

  it('accumulates thought/action/observation into an ordered thinking list', () => {
    let s = planReducer(initialPlanState(), { type: 'thought', text: '先找亲子餐厅' })
    s = planReducer(s, { type: 'action', tool: 'searchPOI', args: '海淀 亲子餐厅' })
    s = planReducer(s, { type: 'observation', summary: '找到 5 家', count: 5 })
    expect(s.thinking).toHaveLength(3)
    expect(s.thinking[0]).toMatchObject({ kind: 'thought', text: '先找亲子餐厅' })
    expect(s.thinking[1]).toMatchObject({ kind: 'action', tool: 'searchPOI', args: '海淀 亲子餐厅' })
    expect(s.thinking[2]).toMatchObject({ kind: 'observation', summary: '找到 5 家', count: 5 })
  })

  it('enters a waiting state on a question event (stream stops, not finished)', () => {
    const s = planReducer(initialPlanState(), {
      type: 'question', conversationId: 'conv-1', question: '想要哪种公园?', options: ['遛娃', '安静'],
    })
    expect(s.streaming).toBe(false)
    expect(s.question).toEqual({ conversationId: 'conv-1', question: '想要哪种公园?', options: ['遛娃', '安静'] })
    expect(s.route).toBeNull()
  })

  it('clears a pending question when a new stream starts', () => {
    let s = planReducer(initialPlanState(), {
      type: 'question', conversationId: 'conv-1', question: '?', options: [],
    })
    s = planReducer(s, { type: 'start' })
    expect(s.question).toBeNull()
    expect(s.streaming).toBe(true)
  })
})

const baseRequest: PlanRequest = {
  request: '带孩子在北京海淀',
  preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
  previousPlan: null,
}

afterEach(() => vi.restoreAllMocks())

describe('usePlanStream answer()', () => {
  it('resumes with conversationId + answer via streamPlan', async () => {
    const spy = vi.spyOn(planStreamApi, 'streamPlan').mockImplementation(async (_req, opts) => {
      opts.onEvent({
        type: 'question', conversationId: 'conv-9', question: '哪种?', options: ['A', 'B'],
      })
    })
    const { result } = renderHook(() => usePlanStream())

    await act(async () => { await result.current.run(baseRequest) })
    await waitFor(() => expect(result.current.state.question?.conversationId).toBe('conv-9'))

    spy.mockResolvedValueOnce(undefined)
    await act(async () => { await result.current.answer('A') })

    const lastCall = spy.mock.calls.at(-1)!
    expect(lastCall[0].conversationId).toBe('conv-9')
    expect(lastCall[0].answer).toBe('A')
    // pending question cleared on resume
    expect(result.current.state.question).toBeNull()
  })

  it('answer() is a no-op when there is no pending question', async () => {
    const spy = vi.spyOn(planStreamApi, 'streamPlan').mockResolvedValue(undefined)
    const { result } = renderHook(() => usePlanStream())
    await act(async () => { await result.current.answer('hi') })
    expect(spy).not.toHaveBeenCalled()
  })
})
