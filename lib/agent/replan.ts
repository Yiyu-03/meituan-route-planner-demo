import type { Category, Constraints, Route, ScoredPOI } from '../../contract/index.js'
import type { EnrichedPOI, Persona } from './types.js'
import { distBetween } from './geo.js'

export type EditOpKind =
  | 'cheaper' | 'closer' | 'higher_rated' | 'swap' | 'remove' | 'add' | 'rebudget'

export interface EditOp {
  op: EditOpKind
  targetIndex?: number
  targetCategory?: Category
  newBudget?: number
  raw: string
}

// ------------------------------------------------------------
// Deterministic edit-intent parser.
// Maps a Chinese edit instruction + the previous plan to a structured op.
// Ordinals ("第二/第3/最后一家") + category words + verbs decide target & action.
// ------------------------------------------------------------

const CAT_WORDS: { cat: Category; words: string[] }[] = [
  { cat: 'dining', words: ['餐厅', '饭店', '吃饭', '吃的', '正餐', '本帮', '菜', '美食', '餐'] },
  { cat: 'cafe', words: ['咖啡', '咖啡馆', '下午茶', '奶茶', '茶'] },
  { cat: 'culture', words: ['美术馆', '博物馆', '展馆', '展览', '书店', '园林', '文化', '展'] },
  { cat: 'entertainment', words: ['娱乐', '演出', '话剧', '剧场', '电影', '密室', '桌游', '乐园'] },
  { cat: 'shopping', words: ['购物', '商场', '逛街', '买'] },
  { cat: 'nightscape', words: ['夜景', '看景', '江景', '夜游', '观景'] },
]

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** Detect a category mentioned in the text (first match wins). */
function detectCategory(text: string): Category | undefined {
  for (const { cat, words } of CAT_WORDS) {
    if (words.some((w) => text.includes(w))) return cat
  }
  return undefined
}

/** Parse an ordinal ("第二家/第3站/最后一家") into a 0-based index against the plan length. */
function detectOrdinalIndex(text: string, length: number): number | undefined {
  if (/最后(一)?(家|站|个|个地方)?/.test(text)) return Math.max(0, length - 1)
  if (/第一(家|站|个)?|头一(家|站|个)/.test(text)) return 0
  const m = text.match(/第\s*([一二两三四五六七八九十]|\d+)\s*(?:家|站|个|处)/)
  if (m) {
    const n = CN_NUM[m[1]] ?? parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 1) return n - 1
  }
  return undefined
}

/** First stop index matching a category, or undefined. */
function indexOfCategory(prev: Route, cat: Category): number | undefined {
  const i = prev.stops.findIndex((s) => s.poi.category === cat)
  return i >= 0 ? i : undefined
}

/** Resolve a target index from ordinal first, then category mention. */
function resolveTarget(
  text: string, prev: Route, cat: Category | undefined,
): number | undefined {
  const ord = detectOrdinalIndex(text, prev.stops.length)
  if (ord != null && ord < prev.stops.length) return ord
  if (cat) return indexOfCategory(prev, cat)
  return undefined
}

const CRITERION = {
  cheaper: /便宜|实惠|省钱|低预算|更便宜|划算|性价比|不贵/,
  closer: /近一点|近点|更近|距离短|步行|少走|少坐车|少打车|不要太远|别太远/,
  higher: /评分(更)?高|高分|好评|口碑|更好|更高分|评分高/,
}

/** Parse a Chinese edit instruction + previous plan into a structured EditOp. */
export function parseEditIntent(request: string, prev: Route): EditOp {
  const raw = request.trim()
  const cat = detectCategory(raw)

  // rebudget — explicit total budget change
  const bm = raw.match(/(?:预算|控制在|不超过)?\s*(?:降到|改成|调到|降低到|控制在|不超过|降至)\s*(\d{2,4})/)
    || (/预算/.test(raw) ? raw.match(/(\d{2,4})/) : null)
  if (bm && /预算|控制在|不超过|整体.*(\d)/.test(raw)) {
    return { op: 'rebudget', newBudget: parseInt(bm[1], 10), raw }
  }

  const target = resolveTarget(raw, prev, cat)

  // remove — delete a stop
  if (/去掉|删掉|删除|删|不要(这|那)|拿掉|去除/.test(raw)) {
    return { op: 'remove', targetIndex: target, targetCategory: cat, raw }
  }

  // add — insert a stop of a category
  if (/(再|多)?加(一?(家|个|站))|新增|添(一?(家|个))|补(一?(家|个|站))/.test(raw)) {
    return { op: 'add', targetCategory: cat, targetIndex: target, raw }
  }

  // criterion-based replacement
  if (CRITERION.cheaper.test(raw)) {
    return { op: 'cheaper', targetIndex: target, targetCategory: cat, raw }
  }
  if (CRITERION.closer.test(raw)) {
    return { op: 'closer', targetIndex: target, targetCategory: cat, raw }
  }
  if (CRITERION.higher.test(raw)) {
    return { op: 'higher_rated', targetIndex: target, targetCategory: cat, raw }
  }

  // bare "换/替换/换一家" without a criterion → swap for a fresh same-category pick
  if (/换|替换|改一(家|个)|换个|换成/.test(raw)) {
    return { op: 'swap', targetIndex: target, targetCategory: cat, raw }
  }

  // best-effort fallback
  return { op: 'swap', targetIndex: target, targetCategory: cat, raw }
}

// ------------------------------------------------------------
// Optional LLM enhancement — deterministic rules stay the source of truth;
// the LLM only fills gaps (op/targetIndex/targetCategory/newBudget) the rules
// left unresolved. Unavailable/invalid LLM ⇒ pure rule result. Same injectable
// deps pattern as understandLLM.
// ------------------------------------------------------------

const VALID_OPS: EditOpKind[] = ['cheaper', 'closer', 'higher_rated', 'swap', 'remove', 'add', 'rebudget']
const VALID_CATS: Category[] = ['dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape']

export interface EditIntentDeps {
  chatJson?: (messages: any[]) => Promise<any | null>
  /** The user's ORIGINAL request that produced the plan — full intent context for the LLM. */
  baseRequest?: string
}

const CRITERION_OPS: EditOpKind[] = ['cheaper', 'closer', 'higher_rated']

function editPrompt(request: string, prev: Route, baseRequest?: string) {
  const stops = prev.stops.map((s, i) => ({
    index: i, category: s.poi.category, name: s.poi.name,
    perCapita: s.poi.perCapita, rating: s.poi.rating,
  }))
  return [
    { role: 'system', content: '你把用户对已有路线的「改方案」指令解析成结构化 JSON。结合“原始需求 + 当前路线(含人均/评分) + 修改要求”理解意图。只输出 JSON。字段：op(取自 cheaper|closer|higher_rated|swap|remove|add|rebudget) targetIndex(0 起的站序号|null) targetCategory(dining|cafe|culture|entertainment|shopping|nightscape|null) newBudget(number|null，仅 rebudget)。序数“第二/第3/最后一家”对应 targetIndex。“更便宜/省钱”=cheaper，“更近/少走/少打车”=closer，“评分更高/口碑更好”=higher_rated。' },
    { role: 'user', content: JSON.stringify({ originalRequest: baseRequest ?? null, currentPlan: stops, modification: request }) },
  ]
}

/** Rules-first edit intent with an optional LLM gap-filler. Always returns a valid op. */
export async function parseEditIntentLLM(
  request: string, prev: Route, deps: EditIntentDeps = {},
): Promise<EditOp> {
  const base = parseEditIntent(request, prev)
  if (!deps.chatJson) return base

  let llm: any = null
  try { llm = await deps.chatJson(editPrompt(request, prev, deps.baseRequest)) } catch { llm = null }
  if (!llm || typeof llm !== 'object') return base

  // Never let the LLM downgrade a clearly-stated criterion (便宜/近/高分) into a plain swap.
  const ruleIsCriterion = CRITERION_OPS.includes(base.op)
  const op: EditOpKind = ruleIsCriterion && !CRITERION_OPS.includes(llm.op)
    ? base.op
    : (VALID_OPS.includes(llm.op) ? llm.op : base.op)
  const targetIndex = Number.isInteger(llm.targetIndex) && llm.targetIndex >= 0 && llm.targetIndex < prev.stops.length
    ? llm.targetIndex
    : base.targetIndex
  const targetCategory = VALID_CATS.includes(llm.targetCategory) ? llm.targetCategory : base.targetCategory
  const newBudget = op === 'rebudget'
    ? (Number.isFinite(llm.newBudget) ? Number(llm.newBudget) : base.newBudget)
    : undefined
  return { op, targetIndex, targetCategory, newBudget, raw: request.trim() }
}

// ------------------------------------------------------------
// Constraints reconstruction + minimal-edit application.
// ------------------------------------------------------------

const CAT_KEYWORD: Record<Category, string[]> = {
  dining: ['餐厅', '美食'],
  cafe: ['咖啡', '咖啡馆'],
  culture: ['博物馆', '展览', '书店'],
  entertainment: ['剧场', '电影院'],
  shopping: ['商场', '购物中心'],
  nightscape: ['观景', '夜景'],
}

/** Amap search keywords for a single target category, scoped to the plan's area/city. */
export function replanKeywords(prev: Route, cat: Category): string[] {
  const first = prev.stops[0]?.poi
  const scope = first?.area || first?.city || ''
  return CAT_KEYWORD[cat].map((t) => (scope ? `${scope} ${t}` : t)).slice(0, 4)
}

/** Centroid of the previous plan's real stops — a proximity anchor derived from real coords. */
export function prevCenter(prev: Route): { lat: number; lng: number } {
  const n = Math.max(1, prev.stops.length)
  return {
    lat: prev.stops.reduce((s, st) => s + st.poi.lat, 0) / n,
    lng: prev.stops.reduce((s, st) => s + st.poi.lng, 0) / n,
  }
}

/**
 * Reconstruct constraints from the previous plan so validate/repair/rank can run.
 * Budget comes from the rebudget op; otherwise left null (loose). mustCategories
 * derive from the plan's actual coverage. Times/party/pace from persona + plan.
 */
export function constraintsFromPrev(prev: Route, persona: Persona, op: EditOp): Constraints {
  const start = prev.stops[0]?.arrive ?? persona.latestEnd - 6
  const durationMin = Math.max(120, Math.round((prev.endTime - start) * 60))
  const first = prev.stops[0]?.poi
  const must = [...new Set(prev.stops.map((s) => s.poi.category))] as Category[]
  return {
    city: first?.city ?? '',
    district: first?.area ?? null,
    startTime: start,
    durationMin,
    party: persona.partyDefault,
    budgetPerCapita: op.op === 'rebudget' && op.newBudget != null ? op.newBudget : null,
    diningBudgetPerCapita: null,
    prefs: [],
    avoid: [],
    mustCategories: must,
    pace: persona.pace,
    personaId: persona.id,
    raw: op.raw,
  }
}

/** A kept previous stop, lifted into a ScoredPOI the build/repair core can consume. */
function keptPick(stop: Route['stops'][number]): ScoredPOI {
  return { poi: stop.poi, score: 0, reasons: stop.reasons, sources: stop.sources }
}

/** Pick the best fresh same-category replacement candidate for an op, or null. */
function chooseReplacement(
  op: EditOp,
  current: ScoredPOI,
  pool: ScoredPOI[],
  prev: Route,
  targetIndex: number,
  usedIds: Set<string>,
): ScoredPOI | null {
  const cat = current.poi.category
  const cands = pool.filter((s) => s.poi.category === cat && s.poi.id !== current.poi.id && !usedIds.has(s.poi.id))
  if (cands.length === 0) return null

  if (op.op === 'cheaper') {
    const cur = current.poi.perCapita ?? Infinity
    const cheaper = cands.filter((s) => (s.poi.perCapita ?? Infinity) < cur)
    return cheaper.sort((a, b) => (a.poi.perCapita ?? 0) - (b.poi.perCapita ?? 0) || b.score - a.score)[0] ?? null
  }
  if (op.op === 'higher_rated') {
    const cur = current.poi.rating ?? -Infinity
    const higher = cands.filter((s) => (s.poi.rating ?? -Infinity) > cur)
    return higher.sort((a, b) => (b.poi.rating ?? 0) - (a.poi.rating ?? 0) || b.score - a.score)[0] ?? null
  }
  if (op.op === 'closer') {
    const neighbor = prev.stops[targetIndex - 1]?.poi ?? prev.stops[targetIndex + 1]?.poi
    if (!neighbor) return cands.sort((a, b) => b.score - a.score)[0] ?? null
    const curD = distBetween(current.poi, neighbor)
    const closer = cands.filter((s) => distBetween(s.poi, neighbor) < curD)
    return closer.sort((a, b) => distBetween(a.poi, neighbor) - distBetween(b.poi, neighbor) || b.score - a.score)[0] ?? null
  }
  // swap / add → best unused same-category by score
  return cands.sort((a, b) => b.score - a.score)[0] ?? null
}

export interface ApplyEditResult {
  picks: ScoredPOI[]
  changed: boolean
  note: string
}

/**
 * Apply a minimal edit to the previous plan's stops.
 * Returns the new pick list (kept stops untouched) plus whether anything changed.
 * Replacement candidates come only from the freshly retrieved `scoredPool`.
 */
export function applyEdit(
  op: EditOp, prev: Route, scoredPool: ScoredPOI[], constraints: Constraints,
): ApplyEditResult {
  const picks: ScoredPOI[] = prev.stops.map(keptPick)
  const usedIds = new Set(picks.map((p) => p.poi.id))

  // resolve a concrete target index when one is implied
  let idx = op.targetIndex
  if (idx == null && op.targetCategory) {
    const found = prev.stops.findIndex((s) => s.poi.category === op.targetCategory)
    if (found >= 0) idx = found
  }

  if (op.op === 'remove') {
    if (idx == null || idx < 0 || idx >= picks.length) {
      return { picks, changed: false, note: '没找到要删除的站点，方案保持不变。' }
    }
    if (picks.length <= 2) {
      return { picks, changed: false, note: '只剩两站，删掉会让行程过短，已保留原站点。' }
    }
    const removed = picks[idx]
    picks.splice(idx, 1)
    return { picks, changed: true, note: `已去掉「${removed.poi.name}」这一站。` }
  }

  if (op.op === 'add') {
    const cat: Category = op.targetCategory ?? 'cafe'
    const add = scoredPool
      .filter((s) => s.poi.category === cat && !usedIds.has(s.poi.id))
      .sort((a, b) => b.score - a.score)[0]
    if (!add) {
      return { picks, changed: false, note: '该区域没有可补充的真实候选，方案保持不变。' }
    }
    picks.push(add)
    return { picks, changed: true, note: `已加入一站「${add.poi.name}」。` }
  }

  if (op.op === 'rebudget') {
    // budget already lives in constraints; repair will downgrade overspending stops.
    return { picks, changed: true, note: `已把整体预算调整为 ¥${op.newBudget}，并对超支站点降档。` }
  }

  // cheaper / closer / higher_rated / swap → replace one targeted stop
  if (idx == null) {
    // no explicit target → pick the stop that best fits the criterion intent
    if (op.op === 'cheaper') {
      idx = picks.reduce((best, p, i) => ((p.poi.perCapita ?? 0) > (picks[best].poi.perCapita ?? 0) ? i : best), 0)
    } else if (op.op === 'higher_rated') {
      idx = picks.reduce((best, p, i) => ((p.poi.rating ?? 5) < (picks[best].poi.rating ?? 5) ? i : best), 0)
    } else {
      idx = 0
    }
  }
  if (idx < 0 || idx >= picks.length) {
    return { picks, changed: false, note: '没定位到要替换的站点，方案保持不变。' }
  }
  const current = picks[idx]
  const repl = chooseReplacement(op, current, scoredPool, prev, idx, usedIds)
  if (!repl) {
    return { picks, changed: false, note: `没有找到更合适的同类真实候选，已保留「${current.poi.name}」。` }
  }
  picks[idx] = repl
  return { picks, changed: true, note: `已把「${current.poi.name}」换成「${repl.poi.name}」。` }
}

/** Cuisine / sub-type markers — keep a replacement the SAME kind (换更便宜的火锅 ≠ 随便一家餐厅). */
const CUISINE_MARKERS = [
  '火锅', '串串香', '串串', '烤鱼', '烧烤', '烤肉', '小龙虾', '海鲜', '日料', '寿司', '韩餐', '烤肉',
  '西餐', '牛排', '披萨', 'brunch', '早午餐', '川菜', '湘菜', '粤菜', '本帮菜', '江浙菜', '东北菜',
  '面馆', '米线', '冒菜', '钵钵鸡', '小吃', '茶餐厅', '酒馆', '居酒屋', '清吧', '精酿', '酒吧',
  '咖啡', '茶饮', '甜品', '烘焙', '书店', '美术馆', '博物馆', '剧场', '影院',
]

/** Pull a distinctive sub-type keyword from a stop's name + tags, e.g. 龙户人家串串香 → 串串香. */
function cuisineOf(poi: { name: string; tags?: string[] }): string | null {
  const hay = `${poi.name} ${(poi.tags ?? []).join(' ')}`
  for (const m of CUISINE_MARKERS) if (hay.includes(m)) return m
  return null
}

/** Search keywords covering the categories an op may need to retrieve fresh candidates for. */
export function keywordsForEdit(op: EditOp, prev: Route): string[] {
  let cat = op.targetCategory
  let targetIdx = op.targetIndex
  if (cat == null && targetIdx == null && op.op === 'cheaper') {
    targetIdx = prev.stops.reduce((best, s, idx) => ((s.poi.perCapita ?? 0) > (prev.stops[best].poi.perCapita ?? 0) ? idx : best), 0)
  }
  if (!cat && targetIdx != null) cat = prev.stops[targetIdx]?.poi.category

  if (op.op === 'rebudget') {
    // need cheaper options across every paid category
    const cats = [...new Set(prev.stops.filter((s) => (s.poi.perCapita ?? 0) > 0).map((s) => s.poi.category))] as Category[]
    return [...new Set(cats.flatMap((c) => replanKeywords(prev, c)))].slice(0, 8)
  }
  if (!cat) cat = prev.stops[0]?.poi.category ?? 'dining'

  // Keep the same sub-type when we're replacing a concrete stop (火锅→火锅, 咖啡→咖啡).
  const target = targetIdx != null ? prev.stops[targetIdx]?.poi : null
  const cuisine = target ? cuisineOf(target) : null
  const generic = replanKeywords(prev, cat)
  if (!cuisine) return generic
  const scope = prev.stops[0]?.poi.area || prev.stops[0]?.poi.city || ''
  const scoped = scope ? `${scope} ${cuisine}` : cuisine
  return [...new Set([scoped, cuisine, ...generic])].slice(0, 4)
}

