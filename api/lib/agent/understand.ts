import type { Category, Constraints } from '../../../contract/index'
import type { Persona, SceneTag } from './types'

export interface ResolvedLocation {
  city: string
  district: string | null
  center: { lat: number; lng: number }
}

const PREF_LEX: { tag: SceneTag; words: string[] }[] = [
  { tag: 'romantic', words: ['浪漫', '约会', '情侣', '氛围', '小资', '情调'] },
  { tag: 'quiet', words: ['安静', '清净', '不吵', '僻静', '慢', '轻松', '慢慢逛'] },
  { tag: 'photo', words: ['拍照', '出片', '打卡', '上镜', '好看', '颜值'] },
  { tag: 'family', words: ['带娃', '小孩', '孩子', '亲子', '宝宝', '儿童', '遛娃'] },
  { tag: 'lively', words: ['热闹', '好玩', '气氛', '嗨', '聚会', '聚餐'] },
  { tag: 'cultural', words: ['文艺', '文化', '艺术', '展', '展馆', '博物馆', '书店', '历史', '园林'] },
  { tag: 'trendy', words: ['网红', '潮', '时髦', '新潮', '潮流'] },
  { tag: 'local', words: ['本地', '地道', '烟火', '小吃', '特色', '本帮'] },
  { tag: 'upscale', words: ['精致', '高端', '高档', '正式', '商务', '档次'] },
  { tag: 'budget', words: ['便宜', '实惠', '性价比', '平价', '不贵', '省'] },
  { tag: 'nature', words: ['自然', '绿', '公园', '江边', '滨江', '户外'] },
  { tag: 'nightlife', words: ['酒吧', '夜生活', '蹦迪', '小酌', '喝一杯', 'livehouse', '夜店'] },
  { tag: 'foodie', words: ['好吃', '美食', '吃货', '大餐'] },
]

const AVOID_PATTERNS: { re: RegExp; tag: SceneTag }[] = [
  { re: /不要(太)?吵|别(太)?吵|太吵/, tag: 'lively' },
  { re: /不要太贵|别太贵|不想太贵/, tag: 'upscale' },
  { re: /不要(去)?酒吧|不喝酒|没有酒/, tag: 'nightlife' },
]

const CAT_LEX: { cat: Category; words: string[] }[] = [
  { cat: 'dining', words: ['吃饭', '吃', '美食', '正餐', '晚饭', '午饭', '大餐', '餐厅', '本帮', '菜'] },
  { cat: 'cafe', words: ['咖啡', '喝咖啡', '茶', '下午茶', '奶茶'] },
  { cat: 'culture', words: ['博物馆', '美术馆', '展', '展馆', '园林', '书店', '历史', '文化', 'citywalk'] },
  { cat: 'entertainment', words: ['演出', '话剧', '剧场', '电影', '密室', '桌游', '乐园'] },
  { cat: 'shopping', words: ['逛街', '购物', '商场', '买', '淘'] },
  { cat: 'nightscape', words: ['夜景', '看景', '江景', '登高', '夜游', '灯'] },
]

const CAT_KEYWORD: Record<Category, string[]> = {
  dining: ['餐厅', '本帮菜', '美食'],
  cafe: ['咖啡', '咖啡馆'],
  culture: ['博物馆', '展览', '书店'],
  entertainment: ['剧场', '电影院'],
  shopping: ['商场', '购物中心'],
  nightscape: ['观景', '夜景'],
}

function parseStartTime(raw: string): number {
  const m = raw.match(/(\d{1,2})\s*点(?!前|之前|以前|结束|回)/)
  if (m) {
    let h = parseInt(m[1], 10)
    if (/晚|下午/.test(raw) && h <= 9 && !/中午/.test(raw)) h += 12
    return h
  }
  if (/凌晨|半夜/.test(raw)) return 0.5
  if (/早上|上午|一早/.test(raw)) return 10
  if (/中午/.test(raw)) return 12
  if (/下午/.test(raw)) return 14
  if (/傍晚/.test(raw)) return 17
  if (/晚上|夜里|晚/.test(raw)) return 18.5
  return 14
}

function parseDuration(raw: string, startHour: number): number {
  if (/一天|整天|玩一天/.test(raw)) return 360
  if (/(下午|白天).*(晚上|夜)|逛到晚上|到晚上/.test(raw)) return 300
  if (/半天/.test(raw)) return 240
  const endM = raw.match(/(\d{1,2})\s*点前/)
  if (endM) {
    let endH = parseInt(endM[1], 10)
    if (endH <= 9) endH += 12
    return Math.max(120, Math.round((endH - startHour) * 60))
  }
  if (/晚饭前/.test(raw)) return Math.max(120, Math.round((18 - startHour) * 60))
  return startHour >= 18 ? 240 : 300
}

function parseBudget(raw: string): { total: number | null; dining: number | null } {
  const diningPatterns = [
    /(?:预算|人均)\s*(\d{2,4})\s*(?:吃午饭|吃午餐|吃晚饭|吃晚餐|吃饭|吃正餐)/,
    /(?:午饭|午餐|晚饭|晚餐|吃饭|正餐).*?(?:预算|人均)\s*(\d{2,4})/,
    /(\d{2,4})\s*(?:元|块)?\s*(?:吃午饭|吃午餐|吃晚饭|吃晚餐|吃饭|吃正餐)/,
    /(?:预算)\s*(\d{2,4})\s*吃饭/,
  ]
  for (const p of diningPatterns) {
    const m = raw.match(p)
    if (m) return { total: null, dining: parseInt(m[1], 10) }
  }
  const patterns = [/人均\s*(\d{2,4})/, /预算\s*(?:人均)?\s*(\d{2,4})/, /(\d{2,4})\s*(?:左右|以内|以下|块|元)/]
  for (const p of patterns) {
    const m = raw.match(p)
    if (m) return { total: parseInt(m[1], 10), dining: null }
  }
  return { total: null, dining: null }
}

function parseParty(raw: string): number {
  const cnMap: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 }
  const m = raw.match(/([一两二三四五六七八]|\d+)\s*(?:个|位)?\s*(?:朋友|同学|人|家)/)
  if (m) {
    const n = cnMap[m[1]] ?? parseInt(m[1], 10)
    if (!Number.isNaN(n) && n > 0) return n
  }
  if (/情侣|对象|女朋友|男朋友|两个人/.test(raw)) return 2
  if (/一个人|独自|自己/.test(raw)) return 1
  if (/带娃|带孩子|一家|全家/.test(raw)) return 3
  return 0
}

function parsePace(raw: string): Constraints['pace'] | null {
  if (/不要太赶|别太赶|不赶|慢慢|轻松|不要太累/.test(raw)) return 'relaxed'
  if (/多逛|多玩|尽量多|紧凑|赶一点/.test(raw)) return 'packed'
  return null
}

/** Deterministic constraints parser — the fallback when the LLM is unavailable or times out. */
export function parseConstraintsFallback(
  raw: string, loc: ResolvedLocation, persona: Persona,
): Constraints {
  const startTime = parseStartTime(raw)
  const durationMin = parseDuration(raw, startTime)
  const budget = parseBudget(raw)
  const party = parseParty(raw)

  const prefs = new Set<string>()
  for (const { tag, words } of PREF_LEX) if (words.some((w) => raw.includes(w))) prefs.add(tag)
  const avoid = new Set<string>()
  for (const { re, tag } of AVOID_PATTERNS) if (re.test(raw)) { avoid.add(tag); prefs.delete(tag) }

  const mustCategories = new Set<Category>()
  for (const { cat, words } of CAT_LEX) if (words.some((w) => raw.includes(w))) mustCategories.add(cat)

  return {
    city: loc.city,
    district: loc.district,
    startTime,
    durationMin,
    party: party || persona.partyDefault,
    budgetPerCapita: budget.total,
    diningBudgetPerCapita: budget.dining,
    prefs: [...prefs],
    avoid: [...avoid],
    mustCategories: [...mustCategories],
    pace: parsePace(raw) ?? persona.pace,
    personaId: persona.id,
    raw,
  }
}

/** Build Amap search keywords from constraints. City/district come from resolveLocation, never hardcoded. */
export function fallbackKeywords(c: Constraints): string[] {
  const scope = c.district || c.city
  const words = new Set<string>()
  const cats: Category[] = c.mustCategories.length ? c.mustCategories : ['dining', 'cafe', 'culture']
  for (const cat of cats) {
    for (const term of CAT_KEYWORD[cat]) words.add(`${scope} ${term}`)
  }
  if (c.prefs.includes('cultural')) words.add(`${scope} 景点`)
  if (c.prefs.includes('nature')) words.add(`${scope} 公园`)
  return [...words].slice(0, 8)
}
