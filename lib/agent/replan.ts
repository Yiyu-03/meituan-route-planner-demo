import type { Category, Route } from '../../contract/index'

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
