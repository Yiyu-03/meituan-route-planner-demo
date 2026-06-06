import { describe, it, expect, vi, afterEach } from 'vitest'
import { listHistory, getHistory } from './history'

afterEach(() => vi.restoreAllMocks())

describe('history client', () => {
  it('lists plans for the current identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ([{ planId: 'p1', request: '静安咖啡', createdAt: '2026-06-01T00:00:00Z' }]),
    })) as unknown as typeof fetch)
    const items = await listHistory()
    expect(items).toHaveLength(1)
    expect(items[0].planId).toBe('p1')
  })
  it('fetches one plan by id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ planId: 'p1', routes: [], request: 'x' }),
    })) as unknown as typeof fetch)
    const plan = await getHistory('p1')
    expect(plan.planId).toBe('p1')
  })
  it('throws on a failed list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch)
    await expect(listHistory()).rejects.toThrow()
  })
})
