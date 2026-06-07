import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveAnchor, __clearAnchorCache } from './locationResolver.js'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

const OLD_KEY = process.env.AMAP_API_KEY

beforeEach(() => {
  process.env.AMAP_API_KEY = 'K'
  __clearAnchorCache()
})
afterEach(() => {
  if (OLD_KEY === undefined) delete process.env.AMAP_API_KEY
  else process.env.AMAP_API_KEY = OLD_KEY
})

describe('resolveAnchor', () => {
  it('resolves via geocode first', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: '1', geocodes: [{ location: '121.445,31.228' }] }),
    )
    const center = await resolveAnchor('新世界城', '上海', { fetchImpl: fetchMock })
    expect(center).toEqual({ lng: 121.445, lat: 31.228 })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/geocode/geo')
  })

  it('falls back to place/text when geocode is empty', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/geocode/geo')) return jsonResponse({ status: '1', geocodes: [] })
      return jsonResponse({ status: '1', pois: [{ name: '静安寺', location: '121.44,31.22' }] })
    })
    const center = await resolveAnchor('静安', '上海', { fetchImpl: fetchMock })
    expect(center).toEqual({ lng: 121.44, lat: 31.22 })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/place/text'))).toBe(true)
  })

  it('returns null when both geocode and place/text find nothing', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/geocode/geo')
        ? jsonResponse({ status: '1', geocodes: [] })
        : jsonResponse({ status: '1', pois: [] }),
    )
    const center = await resolveAnchor('不存在的地方xyz', '上海', { fetchImpl: fetchMock })
    expect(center).toBeNull()
  })

  it('caches the resolved center (no second fetch)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '1', geocodes: [{ location: '121.4,31.2' }] }))
    await resolveAnchor('新世界城', '上海', { fetchImpl: fetchMock })
    const calls = fetchMock.mock.calls.length
    const again = await resolveAnchor('新世界城', '上海', { fetchImpl: fetchMock })
    expect(again).toEqual({ lng: 121.4, lat: 31.2 })
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('returns null without a key (never fabricates)', async () => {
    delete process.env.AMAP_API_KEY
    const center = await resolveAnchor('静安', '上海', { fetchImpl: vi.fn() as any })
    expect(center).toBeNull()
  })
})
