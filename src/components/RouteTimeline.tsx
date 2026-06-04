import { useState } from 'react';
import type { Route } from '../types';
import { CATEGORY_LABEL } from '../types';
import {
  ScorePill, ScoreBreakdownBars, Badge, fmtH, Card, SectionLabel,
} from './ui';
import { formatDistance, formatMoveMinutes } from '../lib/display';

function LegConnector({ leg }: { leg: NonNullable<Route['stops'][0]['legFromPrev']> }) {
  const isWalk = leg.mode === 'walk';
  const dist = formatDistance(leg.distM);
  return (
    <div className="flex items-center gap-2 py-1.5 pl-[52px] text-[11px] text-ink-400">
      <span className="inline-flex h-4 items-center">
        <span className="ml-[-1px] mr-2 h-4 w-px bg-ink-200" />
      </span>
      <span className="rounded-full bg-ink-50 px-2 py-0.5">
        {isWalk ? '🚶 步行' : '🚇 地铁/打车'} {formatMoveMinutes(leg.minutes)} · {dist}
      </span>
    </div>
  );
}

function StopRow({
  stop, index, highlight,
}: { stop: Route['stops'][0]; index: number; highlight?: boolean }) {
  const [open, setOpen] = useState(false);
  const poi = stop.scored.poi;
  const changed = highlight;

  return (
    <div className={`rounded-xl border p-3 transition-all ${
      changed ? 'border-brand-300 bg-brand-50/60 ring-1 ring-brand-200' : 'border-ink-100 bg-white'
    }`}>
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <ScorePill score={stop.scored.score} />
          <span className="text-[10px] text-ink-300">#{index + 1}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink-900">{poi.name}</span>
            <Badge tone="ink">{CATEGORY_LABEL[poi.category]}</Badge>
            {changed && <Badge tone="gold">已更新</Badge>}
            <span className="tnum text-[12px] text-ink-400">
              {fmtH(stop.arrive)}–{fmtH(stop.depart)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-500">
            <span>⭐ {poi.rating}</span>
            <span>¥{poi.perCapita}/人</span>
            <span>停留 {poi.avgDuration}min</span>
            {poi.queueBase >= 0.65 && <span className="text-amber-600">排队偏多</span>}
          </div>

          {/* 推荐理由 */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {stop.scored.reasons.map((r, i) => (
              <span key={i} className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
                {r}
              </span>
            ))}
          </div>

          {/* UGC */}
          <p className="mt-1.5 text-[12px] italic text-ink-400">「{poi.ugc}」</p>

          {/* 评分拆解(展开) */}
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-[11px] font-medium text-ink-400 hover:text-brand-600"
          >
            {open ? '收起' : '展开'} 8 维评分拆解 {open ? '▲' : '▼'}
          </button>
          {open && (
            <div className="mt-2 rounded-lg bg-ink-50/60 p-3 animate-fadeUp">
              <ScoreBreakdownBars b={stop.scored.breakdown} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RouteTimeline({
  route, changedIds,
}: { route: Route; changedIds?: string[] }) {
  const changed = new Set(changedIds ?? []);
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel hint={`${route.stops.length} 站 · 实时计算`}>推荐路线</SectionLabel>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-500">
          <span className="tnum">人均 <b className="text-ink-800">¥{route.totalCost}</b></span>
          <span className="tnum">{route.totalWalkMin > 0 ? `步行 ${route.totalWalkMin}min` : '步行少'}</span>
          <span className="tnum">车程 {route.totalTransitMin}min</span>
          <span className="tnum">收尾 {fmtH(route.endTime)}</span>
        </div>
      </div>

      {/* 解释 */}
      <p className="mb-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-[13px] leading-relaxed text-ink-700">
        {route.explanation}
      </p>

      <div>
        {route.stops.map((s, i) => (
          <div key={s.scored.poi.id}>
            {i > 0 && s.legFromPrev && <LegConnector leg={s.legFromPrev} />}
            <StopRow stop={s} index={i} highlight={changed.has(s.scored.poi.id)} />
          </div>
        ))}
      </div>
    </Card>
  );
}
