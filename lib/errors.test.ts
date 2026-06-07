import { describe, it, expect } from 'vitest'
import { PlanError, isPlanError } from './errors.js'

describe('PlanError', () => {
  it('carries a contract error code + recoverable flag', () => {
    const e = new PlanError('insufficient-data', '真实地点不足', true)
    expect(e.code).toBe('insufficient-data')
    expect(e.recoverable).toBe(true)
    expect(isPlanError(e)).toBe(true)
    expect(isPlanError(new Error('plain'))).toBe(false)
  })

  it('toEvent() produces a contract-shaped error event', () => {
    const e = new PlanError('needs-clarification', '需要城市', true)
    expect(e.toEvent()).toEqual({
      type: 'error', code: 'needs-clarification', message: '需要城市', recoverable: true,
    })
  })
})
