import type { AgentTraceStep } from '../types';
import { Card, SectionLabel } from './ui';

export function AgentTrace({ trace }: { trace: AgentTraceStep[] }) {
  if (!trace.length) return null;

  return (
    <Card className="p-4">
      <SectionLabel hint="9段 Agent Loop,每段都有输入/输出">Agent Trace</SectionLabel>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {trace.map((s, idx) => (
          <div key={s.key} className="rounded-xl border border-ink-100 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-100 text-[12px] font-bold text-brand-700">
                  {idx + 1}
                </span>
                <span className="text-[12px] font-semibold text-ink-800">{s.label}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                s.status === 'ok' ? 'bg-emerald-50 text-emerald-700' :
                  s.status === 'skip' ? 'bg-ink-50 text-ink-400' : 'bg-amber-50 text-amber-700'
              }`}>
                {s.status} · {s.ms}ms
              </span>
            </div>
            <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-ink-400">in: {s.input}</div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-600">out: {s.output}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

