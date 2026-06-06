import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { getToken, setSession, clearSession, currentIdentity, login, guest, authHeader } from './auth'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('session token storage', () => {
  it('starts with no token', () => {
    expect(getToken()).toBeNull()
    expect(currentIdentity()).toBeNull()
  })
  it('persists then clears a session', () => {
    setSession({ token: 't1', kind: 'user', name: 'ada' })
    expect(getToken()).toBe('t1')
    expect(currentIdentity()).toEqual({ token: 't1', kind: 'user', name: 'ada' })
    expect(authHeader()).toEqual({ Authorization: 'Bearer t1' })
    clearSession()
    expect(getToken()).toBeNull()
  })
})

describe('login', () => {
  it('posts credentials and stores the returned token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'sess-9', kind: 'user', name: 'ada' }),
    })) as unknown as typeof fetch)
    const id = await login('ada', 'pw')
    expect(id).toEqual({ token: 'sess-9', kind: 'user', name: 'ada' })
    expect(getToken()).toBe('sess-9')
  })
  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ message: '用户名或密码错误' }),
    })) as unknown as typeof fetch)
    await expect(login('ada', 'bad')).rejects.toThrow('用户名或密码错误')
  })
})

describe('guest', () => {
  it('obtains and stores an anonymous device token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ token: 'dev-1', kind: 'guest', name: '访客' }),
    })) as unknown as typeof fetch)
    const id = await guest()
    expect(id.kind).toBe('guest')
    expect(getToken()).toBe('dev-1')
  })
})
