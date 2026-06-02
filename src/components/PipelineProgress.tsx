import { STAGES, type StageKey } from '../types';

export function PipelineProgress({
  activeStages, timings, running,
}: {
  activeStages: StageKey[];
  timings?: Partial<Record<StageKey, number>>;
  running: boolean;
}) {
  const activeSet = new Set(activeStages);
  const lastActive = activeStages[activeStages.length - 1];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STAGES.map((s, i) => {
        const done = activeSet.has(s.key);
        const isCurrent = running && s.key === lastActive;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <div
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-all ${
                done
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-ink-100 bg-white opacity-50'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${
                  done ? 'bg-brand-400 text-ink-900' : 'bg-ink-100 text-ink-400'
                } ${isCurrent ? 'animate-pulseDot' : ''}`}
              >
                {i + 1}
              </span>
              <div className="leading-tight">
                <div className={`text-[12px] font-medium ${done ? 'text-ink-800' : 'text-ink-400'}`}>
                  {s.label}
                </div>
                {timings?.[s.key] != null && (
                  <div className="tnum text-[10px] text-ink-400">{timings[s.key]}ms</div>
                )}
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <span className={`text-xs ${done ? 'text-brand-400' : 'text-ink-200'}`}>›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
