import type { Category, Constraints } from '../../contract/index.js'
import type { Persona, UnderstandResult } from './types.js'
import { parseConstraintsFallback, fallbackKeywords, type ResolvedLocation } from './understand.js'
import { chatJson } from '../deepseek/client.js'

export interface UnderstandDeps {
  apiKey?: string
  chatJson?: (messages: any[]) => Promise<any | null>
}

const VALID_CATS: Category[] = ['dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape']

function prompt(raw: string, loc: ResolvedLocation, persona: Persona, prefs: any) {
  return [
    { role: 'system', content: '你把中文出行需求解析成结构化 JSON。只输出 JSON。不要给城市/区县（后端已定位）。字段：prefs(string[]) mustCategories(取自 dining|cafe|culture|entertainment|shopping|nightscape) startHour(0-24) durationMin party diningBudget(number|null) totalBudget(number|null) keywords(高德搜索关键词数组，含区县前缀) anchor(string|null：用户想聚拢的中心区域或具体地点，可为区域名如"静安/陆家嘴"或具体地点如"新世界城/某商场"；如"在新世界城附近"→"新世界城"，"静安找咖啡"→"静安"；若用户只给了城市没有更细的区域/地点则为 null)。' },
    { role: 'user', content: JSON.stringify({ request: raw, district: loc.district, persona: persona.id, userPrefs: prefs.prefs, budgetPref: prefs.budgetPref }) },
  ]
}

/** LLM-first constraints+keywords, merged over the deterministic fallback. */
export async function understand(
  raw: string, loc: ResolvedLocation, persona: Persona, prefs: any, deps: UnderstandDeps = {},
): Promise<UnderstandResult> {
  const base = parseConstraintsFallback(raw, loc, persona)
  // merge explicit user-picked prefs (always honoured)
  for (const p of prefs.prefs ?? []) if (!base.prefs.includes(p)) base.prefs.push(p)

  const call = deps.chatJson ?? ((m: any[]) => chatJson({ apiKey: deps.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '', messages: m }))
  let llm: any = null
  try { llm = await call(prompt(raw, loc, persona, prefs)) } catch { llm = null }

  if (!llm || typeof llm !== 'object') {
    return { constraints: base, keywords: fallbackKeywords(base), llmUsed: false, anchor: null }
  }

  const anchor = typeof llm.anchor === 'string' && llm.anchor.trim() ? llm.anchor.trim() : null

  const mustCategories = Array.isArray(llm.mustCategories)
    ? (llm.mustCategories.filter((c: any) => VALID_CATS.includes(c)) as Category[])
    : base.mustCategories
  const merged: Constraints = {
    ...base,
    startTime: Number.isFinite(llm.startHour) ? Number(llm.startHour) : base.startTime,
    durationMin: Number.isFinite(llm.durationMin) ? Number(llm.durationMin) : base.durationMin,
    party: Number.isFinite(llm.party) && llm.party > 0 ? Number(llm.party) : base.party,
    diningBudgetPerCapita: llm.diningBudget != null ? Number(llm.diningBudget) : base.diningBudgetPerCapita,
    budgetPerCapita: llm.totalBudget != null ? Number(llm.totalBudget) : base.budgetPerCapita,
    prefs: [...new Set([...(Array.isArray(llm.prefs) ? llm.prefs : []), ...base.prefs])].map(String),
    mustCategories: mustCategories.length ? mustCategories : base.mustCategories,
  }
  const keywords = Array.isArray(llm.keywords) && llm.keywords.length
    ? llm.keywords.filter((k: any) => typeof k === 'string').slice(0, 8)
    : fallbackKeywords(merged)
  return { constraints: merged, keywords, llmUsed: true, anchor }
}
