import { describe, it, expect } from 'vitest'
import { encodeSSE, parseSSE } from '../framing.js'
import type { SSEEvent } from '../events.js'

describe('SSE framing', () => {
  it('round-trips events through the wire format', () => {
    const events: SSEEvent[] = [
      { type: 'stage', key: 'understand', label: '读懂需求', status: 'ok' },
      { type: 'error', code: 'insufficient-data', message: 'x', recoverable: true },
    ]
    const wire = events.map(encodeSSE).join('')
    expect(wire).toContain('event: stage\n')
    expect(wire).toContain('data: ')
    const parsed = parseSSE(wire)
    expect(parsed).toEqual(events)
  })

  it('ignores comments and blank lines', () => {
    const wire = ': keep-alive\n\nevent: stage\ndata: {"type":"stage","key":"k","label":"l","status":"ok"}\n\n'
    const parsed = parseSSE(wire)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].type).toBe('stage')
  })
})
