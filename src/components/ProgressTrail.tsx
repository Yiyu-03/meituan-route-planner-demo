import type { StageState } from '../hooks/usePlanStream'

const STATUS_DOT: Record<StageState['status'], string> = {
  running: 'dot-cinnabar animate-pulse',
  ok: 'dot-sage',
  skip: 'bg-[var(--hairline)]',
  fail: 'bg-[var(--cinnabar)]',
}

export function ProgressTrail({ stages }: { stages: StageState[] }) {
  if (stages.length === 0) return null
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-[var(--ink-soft)]">
      {stages.map((stage) => (
        <li key={stage.key} data-status={stage.status} className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[stage.status]}`} />
          <span className="hand">{stage.label}</span>
          {typeof stage.ms === 'number' && (
            <span className="latin text-[11px] text-[var(--hairline)]">{stage.ms}ms</span>
          )}
        </li>
      ))}
    </ol>
  )
}
