import { describe, it, expect, vi } from 'vitest'
import { chatJson, chatStream } from './client'

function sseStream(chunks: string[]) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

describe('chatJson', () => {
  it('parses a JSON object from the model content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"city":"上海","keywords":["静安 咖啡"]}' } }] }),
    } as Response))
    const out = await chatJson({ apiKey: 'K', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl: fetchMock })
    expect(out).toEqual({ city: '上海', keywords: ['静安 咖啡'] })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.model).toBe('deepseek-v4-flash')
  })

  it('returns null when not configured', async () => {
    const out = await chatJson({ apiKey: '', messages: [] }, { fetchImpl: vi.fn() as any })
    expect(out).toBeNull()
  })
})

describe('chatStream', () => {
  it('yields content deltas and skips reasoning_content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: sseStream([
        'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"先到"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"咖啡馆"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    } as unknown as Response))
    const deltas: string[] = []
    for await (const d of chatStream({ apiKey: 'K', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl: fetchMock })) {
      deltas.push(d)
    }
    expect(deltas).toEqual(['先到', '咖啡馆'])
  })
})
