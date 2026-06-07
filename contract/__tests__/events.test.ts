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
  it('accepts ReAct thought/action/observation events', () => {
    expect(() => SSEEventSchema.parse({ type: 'thought', text: '先找亲子餐厅' })).not.toThrow()
    expect(() => SSEEventSchema.parse({ type: 'action', tool: 'searchPOI', args: '海淀 亲子餐厅' })).not.toThrow()
    expect(() => SSEEventSchema.parse({ type: 'observation', summary: '找到5家', count: 5 })).not.toThrow()
  })
  it('accepts a question event with options', () => {
    const e = { type: 'question', conversationId: 'c1', question: '要哪种公园?', options: ['带娃', '安静'] }
    expect(() => SSEEventSchema.parse(e)).not.toThrow()
  })
  it('accepts a plan request resuming a conversation', () => {
    const req = {
      request: '继续', preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: null, conversationId: 'c1', answer: '带娃游乐设施',
    }
    expect(() => PlanRequestSchema.parse(req)).not.toThrow()
  })
})
