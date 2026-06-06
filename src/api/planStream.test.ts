import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { streamPlan } from './planStream'
import type { SSEEvent } from '../../contract'

const fixture = readFileSync(
  join(__dirname, '..', '..', 'contract', 'fixtures', 'shanghai-quiet-cafe.sse.txt'),
  'utf8',
)

function streamFromText(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // emit in two chunks, splitting mid-frame to prove the buffer reassembles
      const mid = Math.floor(text.length / 2)
      controller.enqueue(new TextEncoder().encode(text.slice(0, mid)))
      controller.enqueue(new TextEncoder().encode(text.slice(mid)))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => vi.restoreAllMocks())

describe('streamPlan over a live ReadableStream', () => {
  it('reassembles chunked frames and yields validated events in order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamFromText(fixture)) as unknown as typeof fetch)
    const got: SSEEvent[] = []
    await streamPlan(
      { request: 'x', preferences: { personaPick: 'auto', prefs: [], budgetPref: null }, previousPlan: null },
      { source: 'live', onEvent: (e) => got.push(e) },
    )
    expect(got[0].type).toBe('stage')
    expect(got.at(-1)?.type).toBe('done')
  })

  it('surfaces an error event from the clarification fixture in fixtures mode', async () => {
    const got: SSEEvent[] = []
    await streamPlan(
      { request: '随便', preferences: { personaPick: 'auto', prefs: [], budgetPref: null }, previousPlan: null },
      { source: 'fixtures', fixture: 'needs-clarification', onEvent: (e) => got.push(e) },
    )
    expect(got.some((e) => e.type === 'error' && e.code === 'needs-clarification')).toBe(true)
  })

  it('rejects a frame that violates the contract schema', async () => {
    const bad = 'event: stage\ndata: {"type":"stage"}\n\n'
    vi.stubGlobal('fetch', vi.fn(async () => streamFromText(bad)) as unknown as typeof fetch)
    await expect(
      streamPlan(
        { request: 'x', preferences: { personaPick: 'auto', prefs: [], budgetPref: null }, previousPlan: null },
        { source: 'live', onEvent: () => {} },
      ),
    ).rejects.toThrow()
  })
})
