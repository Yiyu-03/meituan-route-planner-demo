import type { RepairLog as RepairLogType } from '../types';
import { Card, SectionLabel, Badge } from './ui';

export function RepairLog({ logs }: { logs: RepairLogType[] }) {
  return (
    <Card className="p-4">
      <SectionLabel hint="系统自动修复硬失败,用户修改仍走局部 replan">Repair Log</SectionLabel>
      {!logs.length ? (
        <p className="mt-2 text-[12px] text-ink-400">无硬失败需要自动修复,路线直接进入解释生成。</p>
      ) : (
        <div className="mt-3 space-y-2">
          {logs.map((l) => (
            <div key={l.round} className="rounded-xl border border-ink-100 p-3">
              <div className="flex items-center gap-2">
                <Badge tone={l.resolved ? 'green' : 'amber'}>{l.resolved ? 'FIXED' : 'OPEN'}</Badge>
                <span className="text-[12px] font-semibold text-ink-800">Round {l.round} · {l.trigger}</span>
              </div>
              <p className="mt-1 text-[12px] text-ink-600">{l.action}</p>
              <p className="mt-1 line-clamp-2 text-[11px] text-ink-400">{l.before} → {l.after}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

