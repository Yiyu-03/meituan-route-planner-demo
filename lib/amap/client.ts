const AMAP_V5 = 'https://restapi.amap.com/v5'

export interface AmapDeps {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function fetchJson(url: string, deps: AmapDeps): Promise<any> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 4500)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    return await (res as Response).json()
  } finally {
    clearTimeout(timer)
  }
}

export interface PlaceTextParams {
  keyword: string
  city: string
  key: string
  citylimit?: boolean
  pageSize?: number
}

export interface PlaceTextResult {
  status: 'ok' | 'empty' | 'error'
  pois: any[]
  info?: string
}

/** v5 place/text with business+photos. Caller is responsible for caching/quota. */
export async function searchPlaceText(p: PlaceTextParams, deps: AmapDeps = {}): Promise<PlaceTextResult> {
  const params = new URLSearchParams({
    key: p.key,
    keywords: p.keyword,
    region: p.city,
    city_limit: p.citylimit === false ? 'false' : 'true',
    show_fields: 'business,photos',
    page_size: String(p.pageSize ?? 12),
    page_num: '1',
  })
  try {
    const data = await fetchJson(`${AMAP_V5}/place/text?${params.toString()}`, deps)
    if (data?.status !== '1') return { status: 'error', pois: [], info: data?.info }
    const pois = Array.isArray(data.pois) ? data.pois : []
    return { status: pois.length ? 'ok' : 'empty', pois }
  } catch (err) {
    return { status: 'error', pois: [], info: err instanceof Error ? err.message : String(err) }
  }
}

export interface WalkingParams {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  key: string
}

/** v5 walking direction. Returns { distM, minutes } or null. */
export async function walkingLeg(p: WalkingParams, deps: AmapDeps = {}): Promise<{ distM: number; minutes: number } | null> {
  const params = new URLSearchParams({
    key: p.key,
    origin: `${p.from.lng},${p.from.lat}`,
    destination: `${p.to.lng},${p.to.lat}`,
  })
  try {
    const data = await fetchJson(`${AMAP_V5}/direction/walking?${params.toString()}`, { ...deps, timeoutMs: deps.timeoutMs ?? 1600 })
    const path = data?.route?.paths?.[0]
    const distM = Math.round(Number(path?.distance ?? 0))
    const durationSec = Number(path?.cost?.duration ?? path?.duration ?? 0)
    const minutes = Math.round(durationSec / 60)
    if (data?.status === '1' && distM > 0 && minutes > 0) return { distM, minutes }
    return null
  } catch {
    return null
  }
}
