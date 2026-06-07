import { describe, it, expect, vi } from 'vitest'
import { runReactLoop } from './react.js'
import { SSEEventSchema } from '../../contract/index.js'
import type { EnrichedPOI } from './types.js'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'dining', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 90, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap', sceneTags: [], avgDuration: 75, ...over,
  }
}

const familyPois: EnrichedPOI[] = [
  poi({ id: 'rest1', name: '亲子餐厅A', category: 'dining', sceneTags: ['family'] }),
  poi({ id: 'cafe1', name: '咖啡B', category: 'cafe', lat: 31.223, lng: 121.443, avgDuration: 50 }),
  poi({ id: 'cult1', name: '美术馆C', category: 'culture', lat: 31.225, lng: 121.445, perCapita: 0, avgDuration: 90 }),
]

const request = {
  request: '带孩子在静安找个亲子餐厅，再逛逛',
  preferences: { personaPick: 'family' as const, prefs: [], budgetPref: null },
  previousPlan: null,
}

const identity = { deviceToken: 'd', userId: null }

const seed = {
  loc: { status: 'resolved', city: '上海', district: '静安区', center: { lat: 31.22, lng: 121.44 } },
  constraints: {
    city: '上海', district: '静安区', startTime: 11, durationMin: 300, party: 3,
    budgetPerCapita: null, diningBudgetPerCapita: 200, prefs: ['family'], avoid: [],
    mustCategories: ['dining', 'cafe', 'culture'], pace: 'normal', personaId: 'family', raw: '亲子',
  },
}

function baseDeps(over: any = {}) {
  return {
    resolveLocation: async () => seed.loc,
    understand: async () => ({ constraints: seed.constraints, keywords: ['静安区 亲子餐厅'], llmUsed: true }),
    retrieve: async () => ({ pois: familyPois, center: seed.loc.center, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const }),
    searchPOI: async (_kw: string, _district?: string) => familyPois,
    streamExplanation: async function* () { yield '理由。' },
    savePlan: async () => ({ id: 'plan-1' }),
    saveConversation: vi.fn(async () => ({ id: 'conv-1' })),
    planId: () => 'plan-1',
    conversationId: () => 'conv-1',
    chatJson: async () => null,
    ...over,
  }
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('runReactLoop', () => {
  it('accumulates candidates over searchPOI steps then finish → route/done; emits thought/action/observation', async () => {
    const script = [
      { thought: '先找亲子餐厅', action: { tool: 'searchPOI', args: { keyword: '亲子餐厅', district: '静安区' } } },
      { thought: '再找个咖啡', action: { tool: 'searchPOI', args: { keyword: '咖啡' } } },
      { thought: '够了，出方案', action: { tool: 'finish', args: {} } },
    ]
    let i = 0
    const chatJson = vi.fn(async () => script[i++])
    const events = await collect(runReactLoop(request, identity, baseDeps({ chatJson }) as any))

    for (const e of events) expect(() => SSEEventSchema.parse(e)).not.toThrow()
    const types = events.map((e) => e.type)
    expect(types).toContain('thought')
    expect(types).toContain('action')
    expect(types).toContain('observation')
    expect(types).toContain('candidates')
    expect(types.indexOf('route')).toBeLessThan(types.indexOf('explanation'))
    expect(types.at(-1)).toBe('done')
    // two searchPOI actions + one finish
    expect(events.filter((e) => e.type === 'action' && e.tool === 'searchPOI')).toHaveLength(2)
    expect(chatJson).toHaveBeenCalledTimes(3)
  })

  it('batches a keywords[] array into ONE parallel search step (fewer LLM round-trips)', async () => {
    const script = [
      { thought: '三类一次搜齐', action: { tool: 'searchPOI', args: { keywords: ['亲子餐厅', '咖啡', '美术馆'], district: '静安区' } } },
      { thought: '够了', action: { tool: 'finish', args: {} } },
    ]
    let i = 0
    const chatJson = vi.fn(async () => script[i++])
    const calls: string[] = []
    const catByKw: Record<string, EnrichedPOI['category']> = { 亲子餐厅: 'dining', 咖啡: 'cafe', 美术馆: 'culture' }
    const searchPOI = vi.fn(async (kw: string) => {
      calls.push(kw)
      return [poi({ id: kw, name: kw, category: catByKw[kw] ?? 'dining' })]
    })
    const events = await collect(runReactLoop(request, identity, baseDeps({ chatJson, searchPOI }) as any))

    // all three keywords searched within a SINGLE search step (one action + one observation)
    expect(calls.sort()).toEqual(['亲子餐厅', '咖啡', '美术馆'].sort())
    expect(events.filter((e) => e.type === 'action' && e.tool === 'searchPOI')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'observation')).toHaveLength(1)
    // only 2 LLM round-trips (1 batched search + 1 finish), not 4
    expect(chatJson).toHaveBeenCalledTimes(2)
    expect(events.at(-1).type).toBe('done')
  })

  it('askUser saves conversation, emits question, and ends the stream', async () => {
    const chatJson = vi.fn(async () => ({
      thought: '预算不清楚', action: { tool: 'askUser', args: { question: '预算大概多少？', options: ['人均100', '人均200'] } },
    }))
    const saveConversation = vi.fn(async () => ({ id: 'conv-1' }))
    const events = await collect(runReactLoop(request, identity, baseDeps({ chatJson, saveConversation }) as any))

    expect(saveConversation).toHaveBeenCalledTimes(1)
    const savedState = saveConversation.mock.calls[0][2]
    expect(savedState).toHaveProperty('messages')
    expect(savedState).toHaveProperty('candidates')
    expect(savedState).toHaveProperty('constraints')
    const q = events.find((e) => e.type === 'question')
    expect(q).toBeTruthy()
    expect(q.conversationId).toBe('conv-1')
    expect(q.options).toEqual(['人均100', '人均200'])
    // stream ends at question — no done/route after it
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('MAX_STEPS without finish → forced finish with accumulated candidates', async () => {
    // always searchPOI, never finish
    const chatJson = vi.fn(async () => ({ thought: '继续找', action: { tool: 'searchPOI', args: { keyword: '餐厅' } } }))
    const events = await collect(runReactLoop(request, identity, baseDeps({ chatJson }) as any))
    const types = events.map((e) => e.type)
    expect(types.at(-1)).toBe('done')
    // capped at MAX_STEPS calls
    expect(chatJson.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('LLM failure (null) falls back to understand→retrieve→deterministic tail', async () => {
    const chatJson = vi.fn(async () => null) // ReAct planning always fails
    const understand = vi.fn(async () => ({ constraints: seed.constraints, keywords: ['静安区 餐厅'], llmUsed: false }))
    const retrieve = vi.fn(async () => ({ pois: familyPois, center: seed.loc.center, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const }))
    const events = await collect(runReactLoop(request, identity, baseDeps({ chatJson, understand, retrieve }) as any))
    expect(understand).toHaveBeenCalled()
    expect(retrieve).toHaveBeenCalled()
    expect(events.map((e) => e.type).at(-1)).toBe('done')
  })

  it('resumes from a paused conversation (priorState) appending the answer', async () => {
    // priorState carries one already-found candidate + messages; answer drives a finish.
    const chatJson = vi.fn(async () => ({ thought: '收到预算，出方案', action: { tool: 'finish', args: {} } }))
    const priorState = {
      messages: [{ role: 'assistant', content: '{"thought":"问预算","action":{"tool":"askUser"}}' }],
      candidates: familyPois,
      constraints: seed.constraints,
      city: '上海',
    }
    const req2 = { ...request, conversationId: 'conv-1', answer: '人均200' }
    const events = await collect(runReactLoop(req2, identity, baseDeps({ chatJson, priorState }) as any))
    const types = events.map((e) => e.type)
    expect(types.at(-1)).toBe('done')
    // it should NOT re-resolve/understand — it continues from prior candidates
    expect(types).toContain('route')
  })
})
