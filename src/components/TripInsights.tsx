import type { ReactNode } from 'react'
import type { Route, Constraints, Category } from '../../contract'
import { CategoryIcon, MetaIcons } from '../design/icons'
import { TramFront } from 'lucide-react'

const CATEGORY_LABEL: Record<Category, string> = {
  dining: '餐饮', cafe: '咖啡', culture: '文化',
  entertainment: '娱乐', shopping: '购物', nightscape: '夜景',
}
const ALL_CATEGORIES: Category[] = ['dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape']

/** Small index label, ledger-style. */
function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">{children}</p>
  )
}

export function TripInsights({ route, constraints }: { route: Route; constraints: Constraints }) {
  const { walk: Walk } = MetaIcons
  const budget = constraints.budgetPerCapita
  const over = budget != null && route.totalCost > budget
  const scaleMax = Math.max(route.totalCost, budget ?? 0) * 1.12 || 1
  const fillPct = (route.totalCost / scaleMax) * 100
  const notchPct = budget ? (budget / scaleMax) * 100 : 0

  const contributions = route.stops
    .map((s) => ({ name: s.poi.name, value: s.poi.perCapita ?? 0 }))
    .filter((c) => c.value > 0)

  const walk = route.totalWalkMin
  const transit = route.totalTransitMin
  const moveTotal = Math.max(1, walk + transit)
  const covered = ALL_CATEGORIES.filter((c) => route.coverage.includes(c))
  const reminders = [
    ...route.checks.filter((c) => c.status !== 'pass').map((c) => c.detail),
    ...route.risks,
  ].filter(Boolean)

  return (
    <section className="paper-card space-y-5 p-5">
      <div className="flex items-baseline justify-between border-b border-dashed border-[var(--hairline)] pb-2">
        <h3 className="hand text-[16px]">行程洞察</h3>
        <Label>Insights</Label>
      </div>

      {/* 预算 — 焦点 */}
      <div>
        <div className="flex items-end justify-between">
          <Label>人均花费</Label>
          {over
            ? <span className="stamp -rotate-2 text-[12px]">超支 ¥{route.totalCost - (budget ?? 0)}</span>
            : budget != null && <span className="text-[11px] text-[var(--sage)]">在预算内</span>}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="latin text-[30px] font-semibold leading-none" style={{ color: over ? 'var(--cinnabar)' : 'var(--ink)' }}>
            ¥{route.totalCost}
          </span>
          {budget != null && <span className="latin text-[13px] text-[var(--ink-soft)]">/ 预算 ¥{budget}</span>}
        </div>
        {/* 刻度条 + 预算线 */}
        <div className="relative mt-2.5 h-2 w-full rounded-full bg-[var(--hairline)]">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${Math.min(100, fillPct)}%`, background: over ? 'var(--cinnabar)' : 'var(--sage)' }}
          />
          {budget != null && (
            <span
              className="absolute -top-1 bottom-[-4px] w-px bg-[var(--ink)]"
              style={{ left: `${notchPct}%` }}
              aria-hidden
            />
          )}
        </div>
        {/* 各站账目:点引线 */}
        {contributions.length > 1 && (
          <ul className="mt-3 space-y-1">
            {contributions.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px]">
                <span className="hand max-w-[55%] truncate text-[var(--ink)]">{c.name}</span>
                <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dotted border-[var(--hairline)]" aria-hidden />
                <span className="latin text-[var(--ink-soft)]">¥{c.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 移动构成 */}
      <div className="space-y-2">
        <Label>移动构成</Label>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--hairline)]">
          <div style={{ width: `${(walk / moveTotal) * 100}%`, background: 'var(--sage)' }} />
          <div style={{ width: `${(transit / moveTotal) * 100}%`, background: 'var(--amber)' }} />
        </div>
        <div className="flex flex-wrap gap-4 text-[12px] text-[var(--ink-soft)]">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--sage)' }} aria-hidden />
            <Walk size={13} strokeWidth={1.7} aria-hidden /> 步行 <span className="latin text-[var(--ink)]">{walk}min</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--amber)' }} aria-hidden />
            <TramFront size={13} strokeWidth={1.7} aria-hidden /> 车程 <span className="latin text-[var(--ink)]">{transit}min</span>
          </span>
        </div>
      </div>

      {/* 类目覆盖 */}
      {covered.length > 0 && (
        <div className="space-y-2">
          <Label>这趟覆盖</Label>
          <div className="flex flex-wrap gap-1.5">
            {covered.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--paper-base)] px-2.5 py-1 text-[12px]"
              >
                <CategoryIcon category={c} size={13} />
                {CATEGORY_LABEL[c]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 提醒 — 便签 */}
      {reminders.length > 0 && (
        <div className="space-y-1.5 border-l-2 border-[var(--cinnabar)] pl-3">
          <Label>留意</Label>
          <ul className="space-y-1">
            {reminders.map((r, i) => (
              <li key={i} className="hand text-[12.5px] leading-5 text-[var(--ink)]">{r}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
