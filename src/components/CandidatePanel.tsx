import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Category, ScoredPOI } from '../types';
import { CATEGORY_LABEL } from '../types';
import { AREA_MAP } from '../data/areas';
import { Badge, Card, ScoreBreakdownBars, ScorePill, SectionLabel } from './ui';

const CATEGORY_ORDER: Category[] = [
  'dining',
  'cafe',
  'culture',
  'entertainment',
  'shopping',
  'nightscape',
];

export function CandidatePanel({ candidates }: { candidates: ScoredPOI[] }) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<Category, number>();
    for (const item of candidates) {
      map.set(item.poi.category, (map.get(item.poi.category) ?? 0) + 1);
    }
    return map;
  }, [candidates]);

  const visible = candidates
    .filter((item) => category === 'all' || item.poi.category === category)
    .slice(0, category === 'all' ? 12 : 8);

  if (!candidates.length) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <SectionLabel hint={`${candidates.length} 个候选 · 已按 personalized_score 排序`}>
          候选 POI 评分
        </SectionLabel>
        <Badge tone="ink">非预制路线证据</Badge>
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        <FilterButton active={category === 'all'} onClick={() => setCategory('all')}>
          全部 {candidates.length}
        </FilterButton>
        {CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => (
          <FilterButton key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABEL[c]} {counts.get(c)}
          </FilterButton>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((item, idx) => {
          const isOpen = expanded === item.poi.id;
          return (
            <button
              key={item.poi.id}
              onClick={() => setExpanded(isOpen ? null : item.poi.id)}
              className="rounded-xl border border-ink-100 bg-white p-3 text-left transition-all hover:border-brand-300 hover:shadow-card"
            >
              <div className="flex items-start gap-3">
                <ScorePill score={item.score} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-ink-900">
                      {idx + 1}. {item.poi.name}
                    </span>
                    <Badge tone="ink">{CATEGORY_LABEL[item.poi.category]}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-ink-400">
                    <span>⭐ {item.poi.rating}</span>
                    <span>¥{item.poi.perCapita}/人</span>
                    <span>{AREA_MAP[item.poi.area]?.name ?? item.poi.area}</span>
                    <span>{item.poi.source.replace('mock_', '')} · {Math.round(item.poi.confidence * 100)}%</span>
                    {item.poi.queueBase >= 0.65 && <span className="text-amber-600">排队风险</span>}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {item.reasons.slice(0, 3).map((reason) => (
                  <span key={reason} className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
                    {reason}
                  </span>
                ))}
              </div>

              {isOpen && (
                <div className="mt-3 rounded-lg bg-ink-50/70 p-3 animate-fadeUp">
                  <ScoreBreakdownBars b={item.breakdown} />
                  <p className="mt-2 text-[11px] italic leading-relaxed text-ink-400">「{item.poi.ugc}」</p>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
        这里展示的是召回池中的前排候选,路线组合只会从这些候选里继续做 slot plan + beam search,不是写死路线模板。
      </p>
    </Card>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-[12px] transition-all ${
        active
          ? 'border-brand-400 bg-brand-400 font-semibold text-ink-900 shadow-sm'
          : 'border-ink-200 bg-white text-ink-500 hover:border-ink-300 hover:text-ink-800'
      }`}
    >
      {children}
    </button>
  );
}
