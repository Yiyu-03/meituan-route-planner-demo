import type { Route } from '../../contract'
import { StopCard } from './StopCard'

/** Split the streamed per-route explanation into one chunk per stop. */
function explanationForStop(explanation: string, index: number, count: number, fallback: string): string {
  if (!explanation) return fallback
  const parts = explanation.split(/(?<=[。！？])/).filter(Boolean)
  if (parts.length <= 1) return index === 0 ? explanation : fallback
  const per = Math.ceil(parts.length / count)
  const slice = parts.slice(index * per, (index + 1) * per).join('')
  return slice || fallback
}

export function Itinerary({ route, explanation }: { route: Route; explanation: string }) {
  if (route.stops.length === 0) return null
  return (
    <div className="space-y-3">
      {route.stops.map((stop, index) => (
        <StopCard
          key={`${stop.poi.id}-${index}`}
          index={index}
          stop={stop}
          explanation={explanationForStop(explanation, index, route.stops.length, stop.reasons[0] ?? '')}
        />
      ))}
    </div>
  )
}
