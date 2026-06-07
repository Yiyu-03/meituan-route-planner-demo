import type { Route, Constraints, Category } from '../../contract'
import { CategoryIcon, MetaIcons } from '../design/icons'
import { TramFront, TriangleAlert, Sparkles } from 'lucide-react'

const CATEGORY_LABEL: Record<Category, string> = {
  dining: '餐饮',
  cafe: '咖啡',
  culture: '文化',
  entertainment: '娱乐',
  shopping: '购物',
  nightscape: '夜景',
}

const ALL_CATEGORIES: Category[] = ['dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape']

/** A pure-CSS horizontal bar. width is a 0..1 ratio. */
function Bar({ ratio, tone }: { ratio: number; tone: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--hairline)]">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
    </div>
  )
}

export function TripInsights({ route, constraints }: { route: Route; constraints: Constraints }) {
  const { wallet: Wallet, walk: Walk } = MetaIcons
  const budget = constraints.budgetPerCapita
  const overBudget = budget != null && route.totalCost > budget
  // budget bar ratio: spend vs budget (or vs spend itself when no budget known)
  const budgetRatio = budget && budget > 0 ? route.totalCost / budget : 1

  // per-stop per-capita contribution (only stops carrying a perCapita)
  const contributions = route.stops
    .map((s) => ({ name: s.poi.name, category: s.poi.category, value: s.poi.perCapita ?? 0 }))
    .filter((c) => c.value > 0)
  const contribMax = Math.max(1, ...contributions.map((c) => c.value))

  // movement split
  const walk = route.totalWalkMin
  const transit = route.totalTransitMin
  const moveTotal = Math.max(1, walk + transit)

  // covered categories (preserve canonical order)
  const covered = ALL_CATEGORIES.filter((c) => route.coverage.includes(c))

  // reminders: warn/fail check details + risks
  const reminders = [
    ...route.checks.filter((c) => c.status !== 'pass').map((c) => c.detail),
    ...route.risks,
  ].filter(Boolean)

  return (
    <section className="paper-card space-y-4 p-4">
      <div className="flex items-center gap-1.5">
        <Sparkles size={16} strokeWidth={1.7} aria-hidden className="text-[var(--amber)]" />
        <h3 className="hand text-[15px]">行程洞察</h3>
      </div>

      {/* 预算 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="inline-flex items-center gap-1 text-[var(--ink-soft)]">
            <Wallet size={14} strokeWidth={1.7} aria-hidden /> 人均合计
          </span>
          <span className="latin">
            ¥{route.totalCost}
            {budget != null && <span className="text-[var(--ink-soft)]"> / ¥{budget}</span>}
          </span>
        </div>
        <Bar ratio={budgetRatio} tone={overBudget ? 'var(--cinnabar)' : 'var(--sage)'} />
        {overBudget && (
          <p className="inline-flex items-center gap-1 text-[12px] text-[var(--cinnabar)]">
            <TriangleAlert size={13} strokeWidth={1.7} aria-hidden />
            超支 ¥{route.totalCost - (budget ?? 0)}/人
          </p>
        )}
        {contributions.length > 1 && (
          <ul className="space-y-1 pt-1">
            {contributions.map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px] text-[var(--ink-soft)]">
                <span className="w-16 shrink-0 truncate hand text-[var(--ink)]">{c.name}</span>
                <span className="flex-1"><Bar ratio={c.value / contribMax} tone="var(--amber)" /></span>
                <span className="latin w-10 shrink-0 text-right">¥{c.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 类目覆盖 */}
      {covered.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-[var(--ink-soft)]">类目覆盖</p>
          <div className="flex flex-wrap gap-1.5">
            {covered.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--paper-base)] px-2 py-0.5 text-[12px]"
              >
                <CategoryIcon category={c} size={13} />
                {CATEGORY_LABEL[c]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 移动构成 */}
      <div className="space-y-1.5">
        <p className="text-[12px] text-[var(--ink-soft)]">移动构成</p>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--hairline)]">
          <div className="h-full" style={{ width: `${(walk / moveTotal) * 100}%`, background: 'var(--sage)' }} />
          <div className="h-full" style={{ width: `${(transit / moveTotal) * 100}%`, background: 'var(--amber)' }} />
        </div>
        <div className="flex flex-wrap gap-3 text-[12px] text-[var(--ink-soft)]">
          <span className="inline-flex items-center gap-1">
            <Walk size={13} strokeWidth={1.7} aria-hidden /> 步行 <span className="latin">{walk}min</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <TramFront size={13} strokeWidth={1.7} aria-hidden /> 车程 <span className="latin">{transit}min</span>
          </span>
        </div>
      </div>

      {/* 亮点 & 提醒 */}
      {reminders.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-[var(--ink-soft)]">亮点 & 提醒</p>
          <ul className="space-y-1">
            {reminders.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] leading-5 text-[var(--ink)]">
                <TriangleAlert size={13} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0 text-[var(--amber)]" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
