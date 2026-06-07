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

/**
 * Non-destinations / service POIs that should never appear as a stop on a leisure route
 * (matched against name + Amap type). Filters out parking lots, transit nodes, hospitals,
 * banks, schools, offices, hotels, warehouses, etc. — surfaced by keyword search but not places to visit.
 */
const BLOCKED_POI = /停车场|充电站|地铁站|公交[车站]|站台|[0-9]号口|出入口|检票|售票|配送|仓库|物流|批发市场|医院|门诊|诊所|卫生院|药店|药房|银行|信用社|ATM|证券|保险公司|加油站|加气站|政府|管委会|派出所|公安局|法院|检察院|税务|居委会|村委会|小学|中学|大学|学院|幼儿园|驾校|写字楼|商务楼|产业园|创业园|小区|公寓|住宅|宿舍|人才市场|人力资源|招聘|房产中介|营业厅|汽车维修|汽修|4S店|售楼|售楼处|有限公司|厕所|公共卫生间|殡仪|陵园|酒店|宾馆|招待所|住宿|旅馆|旅社|客栈|民宿|青年旅舍|度假村|公寓式/

/** Map a raw v5 POI to the contract POI enriched for the deterministic core. Returns null if unusable. */
export function toEnrichedPOI(raw: AmapV5Poi, city: string, district: string | null): EnrichedPOI | null {
  const name = (raw.name || '').trim()
  const [lngStr, latStr] = String(raw.location || '').split(',')
  const lng = Number(lngStr)
  const lat = Number(latStr)
  if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null

  const typeText = `${name} ${raw.type || ''}`
  if (BLOCKED_POI.test(typeText)) return null // non-destination / service POI — drop it
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
