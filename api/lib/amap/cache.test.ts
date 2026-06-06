import { describe, it, expect } from 'vitest'
import { normalizeCacheKey, legCacheKey, isFresh } from './cache.js'

describe('normalizeCacheKey', () => {
  it('is stable across whitespace/case and keyword order within scope', () => {
    const a = normalizeCacheKey({ city: '上海', keyword: '静安  咖啡', scope: 'cafe' })
    const b = normalizeCacheKey({ city: '上海', keyword: '静安 咖啡', scope: 'cafe' })
    expect(a).toBe(b)
    expect(a.startsWith('poi:')).toBe(true)
  })
  it('differs by city and scope', () => {
    expect(normalizeCacheKey({ city: '上海', keyword: 'k', scope: 'cafe' }))
      .not.toBe(normalizeCacheKey({ city: '北京', keyword: 'k', scope: 'cafe' }))
    expect(normalizeCacheKey({ city: '上海', keyword: 'k', scope: 'cafe' }))
      .not.toBe(normalizeCacheKey({ city: '上海', keyword: 'k', scope: 'dining' }))
  })
})

describe('legCacheKey', () => {
  it('rounds coordinates so near-identical legs share a key', () => {
    const a = legCacheKey({ lat: 31.22401, lng: 121.44302 }, { lat: 31.23001, lng: 121.45001 })
    const b = legCacheKey({ lat: 31.22404, lng: 121.44298 }, { lat: 31.23002, lng: 121.45004 })
    expect(a).toBe(b)
    expect(a.startsWith('leg:')).toBe(true)
  })
})

describe('isFresh', () => {
  it('true within TTL, false after', () => {
    const now = Date.now()
    expect(isFresh(new Date(now - 5 * 86400_000).toISOString(), 14)).toBe(true)
    expect(isFresh(new Date(now - 40 * 86400_000).toISOString(), 14)).toBe(false)
  })
})
