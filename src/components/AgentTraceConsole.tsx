import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, CircleX, LoaderCircle } from 'lucide-react';
import type { AgentTraceLog } from '../mock/store';

interface AgentTraceConsoleProps {
  logs: AgentTraceLog[];
}

const statusMap = {
  loading: {
    icon: LoaderCircle,
    className: 'text-yellow-400',
    label: 'RUN',
  },
  ok: {
    icon: CheckCircle2,
    className: 'text-emerald-400',
    label: 'OK',
  },
  warn: {
    icon: CircleAlert,
    className: 'text-orange-400',
    label: 'FIX',
  },
  error: {
    icon: CircleX,
    className: 'text-red-400',
    label: 'ERR',
  },
} as const;

export function AgentTraceConsole({ logs }: AgentTraceConsoleProps) {
  const [visible, setVisible] = useState(logs.length > 0);

  useEffect(() => {
    if (!logs.length) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const complete = logs.every((log) => log.status !== 'loading');
    if (!complete) return undefined;

    const timer = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [logs]);

  if (!visible || !logs.length) return null;

  return (
    <section className="rounded-xl border border-[#1F2328] bg-[#111213] p-3 font-mono text-[12px] leading-5 text-white shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A8F99]">
            Trace Console
          </p>
          <p className="text-[12px] text-gray-300">Plan → Execute → Repair</p>
        </div>
        <span className="rounded-xl border border-white/10 px-2 py-1 text-[10px] text-[#FFC300]">
          parallel tools
        </span>
      </div>

      <div className="space-y-1.5">
        {logs.map((log) => {
          const meta = statusMap[log.status];
          const Icon = meta.icon;
          return (
            <div key={`${log.step}-${log.latency}`} className="flex min-w-0 items-center gap-2">
              <Icon
                size={14}
                strokeWidth={1.5}
                className={`${meta.className} ${log.status === 'loading' ? 'animate-spin' : ''}`}
              />
              <span className={`w-8 shrink-0 ${meta.className}`}>{meta.label}</span>
              <span className="min-w-0 flex-1 truncate text-gray-100">{log.step}</span>
              <span className="shrink-0 text-[#8A8F99]">{log.latency}ms</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
