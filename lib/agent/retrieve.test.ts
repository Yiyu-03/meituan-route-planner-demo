import { describe, it, expect, vi } from 'vitest'
import { retrieve } from './retrieve'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

const loc = { city: '上海', district: '静安区', center: { lat: 31.22, lng: 121.44 } }

const cafePoi = {
  id: 'B1', name: '安静咖啡', type: '餐饮服务;咖啡厅', location: '121.443,31.224',
  cityname: '上海市', adname: '静安区',
  business: { rating: '4.6', cost: '70', opentime_today: '09:00-21:00', tag: '安静', tel: '021-1' },
}
const diningPoi = {
  id: 'B2', name: '老饭店', type: '餐饮服务;中餐厅', location: '121.45,31.23',
  cityname: '上海市', adname: '静安区',
  business: { rating: '4.4', cost: '120', opentime_today: '11:00-21:00', tag: '本帮' },
}

describe('retrieve', () => {
  it('fetches on cache miss, maps real fields, dedups, counts misses', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse({ status: '1', pois: String(url).includes('%E5%92%96%E5%95%A1') ? [cafePoi] : [diningPoi] }),
    )
    const result = await retrieve(
      { keywords: ['静安区 咖啡', '静安区 餐厅'], location: loc, key: 'K' },
      { fetchImpl: fetchMock, readCache: async () => null, writeCache: async () => {} },
    )
    expect(result.pois.map((p) => p.id).sort()).toEqual(['B1', 'B2'])
    expect(result.pois.find((p) => p.id === 'B1')!.rating).toBe(4.6)
    expect(result.cacheMisses).toBe(2)
    expect(result.cacheHits).toBe(0)
    expect(result.amapStatus).toBe('ok')
  })

  it('uses cache on hit and does not call fetch', async () => {
    const fetchMock = vi.fn()
    const result = await retrieve(
      { keywords: ['静安区 咖啡'], location: loc, key: 'K' },
      { fetchImpl: fetchMock as any, readCache: async () => [cafePoi], writeCache: async () => {} },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.cacheHits).toBe(1)
    expect(result.pois[0].id).toBe('B1')
  })

  it('reports not_configured when no key', async () => {
    const result = await retrieve(
      { keywords: ['x'], location: loc, key: '' },
      { fetchImpl: vi.fn() as any, readCache: async () => null, writeCache: async () => {} },
    )
    expect(result.amapStatus).toBe('not_configured')
    expect(result.pois).toHaveLength(0)
  })
})
