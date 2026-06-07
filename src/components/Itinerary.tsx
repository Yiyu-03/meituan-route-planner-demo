import type { Route } from '../../contract'
import { StopCard } from './StopCard'

/**
 * The LLM explanation is ONE flowing route narrative ("先到X…随后到Y…") — it must NOT be
 * sliced per stop (that misaligns sentences onto the wrong cards). We show it once as an
 * overview, and each StopCard shows its own accurate per-stop reason from scoring.
 */
export function Itinerary({ route, explanation, activeIndex = null, onSelect }: {
  route: Route
  explanation: string
  activeIndex?: number | null
  onSelect?: (index: number) => void
}) {
  if (route.stops.length === 0) return null
  return (
    <div className="space-y-3">
      {explanation && (
        <div className="paper-card p-3 sm:p-4">
          <div className="mb-1 text-[11px] tracking-[0.3em] text-[var(--ink-soft)]">本次安排</div>
          <p className="hand text-[14px] leading-relaxed text-[var(--ink)]">{explanation}</p>
        </div>
      )}
      {route.stops.map((stop, index) => (
        <StopCard
          key={`${stop.poi.id}-${index}`}
          index={index}
          stop={stop}
          explanation={stop.reasons[0] ?? ''}
          active={activeIndex === index}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
