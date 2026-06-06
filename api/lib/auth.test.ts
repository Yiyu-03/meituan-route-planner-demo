import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, newToken, parseBearer } from './auth.js'

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret!')
    expect(await verifyPassword('s3cret!', hash)).toBe(true)
    expect(await verifyPassword('nope', hash)).toBe(false)
  })
})

describe('tokens', () => {
  it('newToken returns a long unique hex string', () => {
    const a = newToken()
    const b = newToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })
  it('parseBearer extracts the token', () => {
    expect(parseBearer('Bearer abc.def')).toBe('abc.def')
    expect(parseBearer('')).toBeNull()
    expect(parseBearer('Basic x')).toBeNull()
  })
})
