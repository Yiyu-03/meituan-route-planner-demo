import type { PlanResult } from '../types';
import { PERSONA_MAP } from '../data/personas';
import { Card } from './ui';

export function ConflictBanner({ plan }: { plan: PlanResult }) {
  const conflict = plan.conflict;
  const inference = plan.personaInference;
  if (!conflict || !inference) return null;

  const tone = conflict.hasConflict ? 'border-amber-200 bg-amber-50' : 'border-emerald-100 bg-emerald-50';
  const resolved = PERSONA_MAP[conflict.resolvedPersonaId];

  return (
    <Card className={`p-3 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-ink-800">
            {conflict.hasConflict ? '画像冲突已处理' : '画像自动识别'}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{conflict.message}</p>
        </div>
        <div className="rounded-lg border border-white/70 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-700">
          使用: {resolved?.emoji} {resolved?.label}
        </div>
      </div>
      {inference.signals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {inference.signals.slice(0, 5).map((s, idx) => (
            <span key={`${s.keyword}-${idx}`} className="rounded-full bg-white px-2 py-1 text-[11px] text-ink-500">
              {s.keyword} → {PERSONA_MAP[s.personaId]?.label}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

