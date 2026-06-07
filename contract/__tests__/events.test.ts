import { describe, it, expect } from 'vitest'
import { PlanRequestSchema, SSEEventSchema } from '../events.js'

describe('plan request', () => {
  it('accepts a minimal request', () => {
    const req = {
      request: '静安找个安静咖啡',
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: null,
    }
    expect(() => PlanRequestSchema.parse(req)).not.toThrow()
  })
})

describe('SSE events', () => {
  it('accepts a stage event', () => {
    const e = { type: 'stage', key: 'retrieve', label: '召回', status: 'ok', ms: 120, summary: '18 家' }
    expect(() => SSEEventSchema.parse(e)).not.toThrow()
  })
  it('accepts an explanation delta', () => {
    const e = { type: 'explanation', routeId: 'route-0', delta: '收尾轻量游览' }
    expect(() => SSEEventSchema.parse(e)).not.toThrow()
  })
  it('accepts an error event', () => {
    const e = { type: 'error', code: 'insufficient-data', message: '真实地点不足', recoverable: true }
    expect(() => SSEEventSchema.parse(e)).not.toThrow()
  })
  it('rejects an unknown event type', () => {
    expect(() => SSEEventSchema.parse({ type: 'mystery' })).toThrow()
  })
})
