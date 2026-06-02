import type { Route } from '../types';
import { CATEGORY_LABEL } from '../types';
import { Card, SectionLabel, Badge, fmtH } from './ui';

export function AlternativeRoutes({
  routes, activeIdx, onPick,
}: {
  routes: Route[];
  activeIdx: number;
  onPick: (idx: number) => void;
}) {
  if (routes.length <= 1) return null;
  return (
    <Card className="p-4">
      <SectionLabel hint={`${routes.length} 条候选 · beam search 产出`}>方案对比</SectionLabel>
      <div className="space-y-2">
        {routes.map((r, i) => {
          const active = i === activeIdx;
          const fails = r.checks.filter((c) => c.status === 'fail').length;
          const warns = r.checks.filter((c) => c.status === 'warn').length;
          return (
            <button
              key={r.id}
              onClick={() => onPick(i)}
              className={`w-full rounded-xl border p-3 text-left transition-all ${
                active
                  ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300'
                  : 'border-ink-100 bg-white hover:border-ink-300 hover:shadow-card'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] font-semibold ${active ? 'text-ink-900' : 'text-ink-700'}`}>
                    {i === 0 ? '★ 推荐方案' : `方案 ${i + 1}`}
                  </span>
                  <span className="tnum text-[12px] text-ink-400">综合 {r.score.toFixed(1)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  {fails > 0 && <Badge tone="red">{fails} 冲突</Badge>}
                  {warns > 0 && <Badge tone="amber">{warns} 提示</Badge>}
                  {fails === 0 && warns === 0 && <Badge tone="green">全通过</Badge>}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-500">
                {r.stops.map((s, j) => (
                  <span key={s.scored.poi.id} className="inline-flex items-center">
                    {j > 0 && <span className="mx-1 text-ink-300">→</span>}
                    {s.scored.poi.name}
                  </span>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-ink-400">
                <span className="tnum">人均 ¥{r.totalCost}</span>
                <span className="tnum">{fmtH(r.stops[0].arrive)}–{fmtH(r.endTime)}</span>
                <span>{[...new Set(r.coverage)].map((c) => CATEGORY_LABEL[c]).join('·')}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
