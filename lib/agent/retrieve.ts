import { searchPlaceText } from '../amap/client'
import { normalizeCacheKey } from '../amap/cache.js'
import { toEnrichedPOI } from '../amap/poiFeatures'
import type { EnrichedPOI, RetrieveResult } from './types'
import type { ResolvedLocation } from './understand'

export interface RetrieveParams {
  keywords: string[]
  location: ResolvedLocation & { district: string | null }
  key: string
}

export interface RetrieveDeps {
  fetchImpl?: typeof fetch
  readCache?: (key: string) => Promise<any[] | null>
  writeCache?: (key: string, payload: any[]) => Promise<void>
}

function stripCity(name: string): string {
  return (name || '').replace(/(市|地区|自治州|州|盟)$/, '')
}

export async function retrieve(p: RetrieveParams, deps: RetrieveDeps = {}): Promise<RetrieveResult> {
  const { keywords, location, key } = p
  const center = location.center
  if (!key) {
    return { pois: [], center, cacheHits: 0, cacheMisses: 0, amapStatus: 'not_configured' }
  }
  const readCache = deps.readCache ?? (async () => null)
  const writeCache = deps.writeCache ?? (async () => {})

  const byId = new Map<string, EnrichedPOI>()
  let cacheHits = 0
  let cacheMisses = 0
  let sawError = false

  for (const keyword of keywords) {
    const cacheKey = normalizeCacheKey({ city: location.city, keyword, scope: 'place-text' })
    let rawPois = await readCache(cacheKey)
    if (rawPois) {
      cacheHits += 1
    } else {
      const res = await searchPlaceText(
        { keyword, city: location.city, key }, { fetchImpl: deps.fetchImpl },
      )
      cacheMisses += 1
      if (res.status === 'error') { sawError = true; continue }
      rawPois = res.pois
      await writeCache(cacheKey, rawPois)
    }
    for (const raw of rawPois) {
      const poi = toEnrichedPOI(raw, location.city, location.district)
      if (!poi) continue
      if (poi.city && location.city && stripCity(poi.city) !== stripCity(location.city)) continue
      if (!byId.has(poi.id)) byId.set(poi.id, poi)
    }
  }

  const pois = [...byId.values()]
  const amapStatus: RetrieveResult['amapStatus'] = pois.length ? 'ok' : sawError ? 'error' : 'empty'
  return { pois, center, cacheHits, cacheMisses, amapStatus }
}
