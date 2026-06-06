import type { Route, Constraints } from '../../contract'
import { MetaIcons } from '../design/icons'

function stampFor(route: Route): '拿来就走' | '建议调整' | '需调整' {
  if (route.checks.some((c) => c.status === 'fail')) return '需调整'
  if (route.checks.some((c) => c.status === 'warn')) return '建议调整'
  return '拿来就走'
}

export function PlanSummary({ route, constraints }: { route: Route; constraints: Constraints }) {
  const { wallet: Wallet, walk: Walk, pin: Pin } = MetaIcons
  const where = [constraints.city, constraints.district].filter(Boolean).join(' · ')
  return (
    <header className="paper-card relative flex items-center justify-between gap-3 p-4">
      <div>
        <div className="flex items-center gap-1.5 text-[13px] text-[var(--ink-soft)]">
          <Pin size={14} strokeWidth={1.7} aria-hidden />
          <span className="hand">{where}</span>
          <span className="latin">· {constraints.party}人</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="inline-flex items-center gap-1">
            <Wallet size={14} strokeWidth={1.7} aria-hidden />
            人均 <span className="latin">¥{route.totalCost}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Walk size={14} strokeWidth={1.7} aria-hidden />
            步行 <span className="latin">{route.totalWalkMin}min</span>
          </span>
        </div>
      </div>
      <span className="stamp text-[14px]">{stampFor(route)}</span>
    </header>
  )
}
