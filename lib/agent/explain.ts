import type { Constraints, Route } from '../../contract/index.js'
import { chatStream, type ChatMessage } from '../deepseek/client.js'

const CATEGORY_LABEL: Record<string, string> = {
  dining: '正餐', cafe: '咖啡', culture: '文化点', entertainment: '娱乐', shopping: '逛街', nightscape: '夜景',
}

function fmtH(h: number): string {
  const hh = Math.floor(h) % 24
  const mm = Math.round((h - Math.floor(h)) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Always-available deterministic reasoning text — no LLM, no fabrication. */
export function deterministicExplanation(route: Route, c: Constraints): string {
  const parts: string[] = []
  route.stops.forEach((s, i) => {
    const when = fmtH(s.arrive)
    const cat = CATEGORY_LABEL[s.poi.category] ?? '一站'
    const price = s.poi.perCapita != null ? `（人均¥${s.poi.perCapita}）` : ''
    const lead = i === 0 ? `${when} 先到${cat}「${s.poi.name}」${price}` : `随后约 ${when} 前往「${s.poi.name}」${price}`
    const reason = s.reasons[0] ? `，${s.reasons[0]}` : ''
    parts.push(`${lead}${reason}。`)
  })
  const budget = c.diningBudgetPerCapita != null
    ? `全程正餐预算控制在 ¥${c.diningBudgetPerCapita} 内。`
    : c.budgetPerCapita != null ? `人均合计约 ¥${route.totalCost}，在 ¥${c.budgetPerCapita} 预算内。` : ''
  return parts.join('') + budget
}

function buildPrompt(route: Route, c: Constraints): ChatMessage[] {
  const stops = route.stops.map((s) => ({
    name: s.poi.name, category: s.poi.category, area: s.poi.area,
    rating: s.poi.rating, perCapita: s.poi.perCapita, reasons: s.reasons,
  }))
  return [
    { role: 'system', content: '你是本地路线讲解员。用温暖、具体的中文写一段推荐理由，扣住用户的需求与每一站的真实信息，不要编造数据，不要 Markdown。' },
    { role: 'user', content: JSON.stringify({ request: c.raw, constraints: { prefs: c.prefs, party: c.party, budgetPerCapita: c.budgetPerCapita, diningBudgetPerCapita: c.diningBudgetPerCapita }, stops }) },
  ]
}

export interface ExplainDeps {
  apiKey: string
  /** Injectable stream for tests; defaults to deepseek chatStream. */
  stream?: (messages: ChatMessage[]) => AsyncGenerator<string>
}

/** Streams explanation deltas: LLM if it produces anything, else the deterministic text. */
export async function* streamExplanation(route: Route, c: Constraints, deps: ExplainDeps): AsyncGenerator<string> {
  const messages = buildPrompt(route, c)
  const streamFn = deps.stream
    ?? ((m: ChatMessage[]) => chatStream({ apiKey: deps.apiKey, messages: m }))
  let produced = false
  if (deps.apiKey) {
    for await (const delta of streamFn(messages)) {
      produced = true
      yield delta
    }
  }
  if (!produced) yield deterministicExplanation(route, c)
}
