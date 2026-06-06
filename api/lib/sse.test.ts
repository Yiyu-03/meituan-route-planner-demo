import { describe, it, expect } from 'vitest'
import { openSSE } from './sse.js'

function fakeRes() {
  return {
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    statusCode: 0,
    setHeader(k: string, v: string) { this.headers[k] = v },
    writeHead(code: number) { this.statusCode = code; return this },
    write(s: string) { this.chunks.push(s); return true },
    end() { this.ended = true },
    ended: false,
  }
}

describe('openSSE', () => {
  it('sets event-stream headers and frames events', () => {
    const res = fakeRes()
    const sse = openSSE(res as any)
    expect(res.headers['Content-Type']).toBe('text/event-stream')
    sse.send({ type: 'stage', key: 'understand', label: '读懂需求', status: 'ok' })
    expect(res.chunks.join('')).toContain('event: stage\n')
    sse.close()
    expect(res.ended).toBe(true)
  })

  it('rejects an event that violates the contract schema', () => {
    const res = fakeRes()
    const sse = openSSE(res as any)
    expect(() => sse.send({ type: 'mystery' } as any)).toThrow()
  })
})
