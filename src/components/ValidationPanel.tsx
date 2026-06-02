import type { Route } from '../types';
import { StatusDot, Card, SectionLabel, Badge } from './ui';

export function ValidationPanel({ route }: { route: Route }) {
  const counts = {
    pass: route.checks.filter((c) => c.status === 'pass').length,
    warn: route.checks.filter((c) => c.status === 'warn').length,
    fail: route.checks.filter((c) => c.status === 'fail').length,
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <SectionLabel hint="硬约束校验">约束校验</SectionLabel>
        <div className="flex items-center gap-1.5">
          {counts.pass > 0 && <Badge tone="green">{counts.pass} 通过</Badge>}
          {counts.warn > 0 && <Badge tone="amber">{counts.warn} 提示</Badge>}
          {counts.fail > 0 && <Badge tone="red">{counts.fail} 冲突</Badge>}
        </div>
      </div>

      <div className="space-y-1.5">
        {route.checks.map((c) => (
          <div key={c.key} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-50/60">
            <span className="mt-1"><StatusDot status={c.status} /></span>
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-medium text-ink-700">{c.label}</span>
              <span className="ml-2 text-[12px] text-ink-400">{c.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 风险提示 */}
      {route.risks.length > 0 && (
        <div className="mt-3 border-t border-ink-100 pt-3">
          <span className="text-[12px] font-medium text-ink-500">风险提示</span>
          <ul className="mt-1.5 space-y-1">
            {route.risks.map((r, i) => (
              <li key={i} className="text-[12px] leading-snug text-ink-500">{r}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
