import type { Category } from '../../contract/index.js'
import type { EnrichedPOI, SceneTag } from '../agent/types.js'

interface AmapV5Poi {
  id?: string
  name?: string
  type?: string
  location?: string
  cityname?: string
  adname?: string
  business?: {
    rating?: string
    cost?: string
    opentime_today?: string
    opentime_week?: string
    tag?: string
    tel?: string
  }
  photos?: { title?: string; url?: string }[]
}

function categoryFor(text: string): Category {
  if (/咖啡|茶饮|奶茶|甜品|饮品|下午茶|面包|烘焙/.test(text)) return 'cafe'
  if (/餐饮|餐厅|中餐|西餐|美食|小吃|肉串|烧烤|火锅|菜馆|饭店|brunch|早午餐/i.test(text)) return 'dining'
  if (/夜景|观景|灯光|夜游/.test(text)) return 'nightscape'
  if (/购物|商场|市集|大巴扎|商业/.test(text)) return 'shopping'
  if (/影院|剧场|演出|娱乐|游乐|KTV|密室|桌游/.test(text)) return 'entertainment'
  return 'culture'
}

const TAG_MAP: { re: RegExp; tag: SceneTag }[] = [
  { re: /安静|清净|僻静/, tag: 'quiet' },
  { re: /拍照|出片|打卡|环境|颜值/, tag: 'photo' },
  { re: /浪漫|情调|氛围/, tag: 'romantic' },
  { re: /亲子|儿童|带娃/, tag: 'family' },
  { re: /热闹|气氛/, tag: 'lively' },
  { re: /文化|艺术|文艺|历史/, tag: 'cultural' },
  { re: /网红|潮流|时髦/, tag: 'trendy' },
  { re: /本地|地道|特色|老字号|本帮/, tag: 'local' },
  { re: /精致|高端|商务/, tag: 'upscale' },
  { re: /实惠|平价|性价比/, tag: 'budget' },
  { re: /自然|公园|江景/, tag: 'nature' },
  { re: /酒吧|清吧|精酿/, tag: 'nightlife' },
  { re: /美食|好吃/, tag: 'foodie' },
]

/** Derive scene tags from a real amap tag string. Provenance is 'derived' (estimate). */
export function deriveSceneTags(tagStr: string, category: Category): SceneTag[] {
  const out = new Set<SceneTag>()
  const text = tagStr || ''
  for (const { re, tag } of TAG_MAP) if (re.test(text)) out.add(tag)
  if (category === 'cafe' && !out.size) out.add('quiet')
  return [...out]
}

/** Parse "HH:MM-HH:MM" (Amap opentime_today). Returns nulls when unparseable — never fabricated. */
export function parseOpenHours(opentime: string | undefined): { openHour: number | null; closeHour: number | null } {
  const m = (opentime || '').match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/)
  if (!m) return { openHour: null, closeHour: null }
  const open = parseInt(m[1], 10) + parseInt(m[2], 10) / 60
  let close = parseInt(m[3], 10) + parseInt(m[4], 10) / 60
  if (close <= open) close += 24
  return { openHour: open, closeHour: Math.min(close, 27) }
}

const STAY_BY_CATEGORY: Record<Category, number> = {
  dining: 75, cafe: 50, culture: 90, entertainment: 85, shopping: 60, nightscape: 60,
}

function num(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Map a raw v5 POI to the contract POI enriched for the deterministic core. Returns null if unusable. */
export function toEnrichedPOI(raw: AmapV5Poi, city: string, district: string | null): EnrichedPOI | null {
  const name = (raw.name || '').trim()
  const [lngStr, latStr] = String(raw.location || '').split(',')
  const lng = Number(lngStr)
  const lat = Number(latStr)
  if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null

  const typeText = `${name} ${raw.type || ''}`
  const category = categoryFor(typeText)
  const b = raw.business || {}
  const { openHour, closeHour } = parseOpenHours(b.opentime_today || b.opentime_week)
  const photos = (raw.photos || []).map((p) => p.url).filter((u): u is string => !!u)

  return {
    id: raw.id || `${name}-${raw.location}`,
    name,
    category,
    city,
    area: raw.adname || district || '',
    lat,
    lng,
    rating: num(b.rating),
    perCapita: num(b.cost),
    tags: (b.tag || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    openHour,
    closeHour,
    photos,
    tel: (b.tel || '').trim() || null,
    source: 'amap',
    sceneTags: deriveSceneTags(b.tag || '', category),
    avgDuration: STAY_BY_CATEGORY[category],
  }
}
