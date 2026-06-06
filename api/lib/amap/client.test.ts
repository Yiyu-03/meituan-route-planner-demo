import { describe, it, expect, vi } from 'vitest'
import { searchPlaceText, walkingLeg } from './client'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

describe('searchPlaceText', () => {
  it('requests show_fields=business,photos and returns raw pois', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '1', pois: [{ name: '咖啡', location: '121.4,31.2' }] }))
    const { status, pois } = await searchPlaceText(
      { keyword: '静安 咖啡', city: '上海', key: 'K' }, { fetchImpl: fetchMock },
    )
    expect(status).toBe('ok')
    expect(pois).toHaveLength(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v5/place/text')
    expect(url).toContain('show_fields=business%2Cphotos')
  })

  it('reports empty status when amap returns no pois', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '1', pois: [] }))
    const { status } = await searchPlaceText({ keyword: 'x', city: '上海', key: 'K' }, { fetchImpl: fetchMock })
    expect(status).toBe('empty')
  })

  it('reports error status on upstream failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '0', info: 'INVALID_PARAMS' }))
    const { status } = await searchPlaceText({ keyword: 'x', city: '上海', key: 'K' }, { fetchImpl: fetchMock })
    expect(status).toBe('error')
  })
})

describe('walkingLeg', () => {
  it('returns metres + minutes from a v5 walking path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: '1', route: { paths: [{ distance: '600', cost: { duration: '480' } }] },
    }))
    const leg = await walkingLeg({ from: { lat: 31.2, lng: 121.4 }, to: { lat: 31.21, lng: 121.41 }, key: 'K' }, { fetchImpl: fetchMock })
    expect(leg).toEqual({ distM: 600, minutes: 8 })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v5/direction/walking')
  })

  it('returns null when amap has no path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '0' }))
    const leg = await walkingLeg({ from: { lat: 0, lng: 0 }, to: { lat: 0, lng: 0 }, key: 'K' }, { fetchImpl: fetchMock })
    expect(leg).toBeNull()
  })
})
