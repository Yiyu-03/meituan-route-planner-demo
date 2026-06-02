import type { ReactNode } from 'react';
import type { ScoreBreakdown, Check } from '../types';

export function fmtH(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function Chip({
  children, active, onClick, tone = 'default', size = 'md',
}: {
  children: ReactNode; active?: boolean; onClick?: () => void;
  tone?: 'default' | 'gold' | 'muted'; size?: 'sm' | 'md';
}) {
  const base =
    'inline-flex items-center gap-1 rounded-full border transition-all whitespace-nowrap';
  const sz = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-[13px]';
  const click = onClick ? 'cursor-pointer hover:-translate-y-px active:translate-y-0' : '';
  const toneCls = active
    ? 'bg-brand-400 border-brand-400 text-ink-900 font-medium shadow-sm'
    : tone === 'gold'
    ? 'bg-brand-50 border-brand-200 text-brand-700'
    : tone === 'muted'
    ? 'bg-ink-50 border-ink-200 text-ink-500'
    : 'bg-white border-ink-200 text-ink-600 hover:border-ink-300';
  return (
    <span className={`${base} ${sz} ${click} ${toneCls}`} onClick={onClick}>
      {children}
    </span>
  );
}

export function Badge({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'ink' | 'green' | 'amber' | 'red' }) {
  const map = {
    gold: 'bg-brand-100 text-brand-700',
    ink: 'bg-ink-100 text-ink-600',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-rose-100 text-rose-700',
  } as const;
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

export function ScorePill({ score }: { score: number }) {
  // 分数 → 颜色:高分金,中分灰,低分淡
  const tone =
    score >= 80 ? 'from-brand-400 to-brand-500 text-ink-900'
    : score >= 65 ? 'from-brand-200 to-brand-300 text-ink-800'
    : 'from-ink-200 to-ink-300 text-ink-700';
  return (
    <span className={`tnum inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-sm font-bold shadow-sm`}>
      {Math.round(score)}
    </span>
  );
}

const DIM_LABEL: Record<keyof ScoreBreakdown, string> = {
  quality: '质量', popularity: '热度', sceneFit: '场景契合', prefMatch: '偏好匹配',
  budgetFit: '预算', proximity: '距离', companionFit: '同行', ugcBonus: 'UGC',
};
const DIM_MAX: Record<keyof ScoreBreakdown, number> = {
  quality: 18, popularity: 10, sceneFit: 26, prefMatch: 18,
  budgetFit: 12, proximity: 8, companionFit: 5, ugcBonus: 3,
};

export function ScoreBreakdownBars({ b }: { b: ScoreBreakdown }) {
  const keys = Object.keys(b) as (keyof ScoreBreakdown)[];
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
      {keys.map((k) => {
        const pct = Math.max(4, Math.min(100, (b[k] / DIM_MAX[k]) * 100));
        return (
          <div key={k} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] text-ink-500">{DIM_LABEL[k]}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-300 to-brand-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tnum w-8 shrink-0 text-right text-[11px] font-medium text-ink-600">
              {b[k].toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function StatusDot({ status }: { status: Check['status'] }) {
  const map = { pass: 'bg-emerald-500', warn: 'bg-amber-400', fail: 'bg-rose-500' } as const;
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${map[status]}`} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-ink-100 bg-white/90 shadow-card backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

export function SectionLabel({ icon, children, hint }: { icon?: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {icon && <span className="text-ink-400">{icon}</span>}
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-500">{children}</h3>
      {hint && <span className="text-[11px] text-ink-300">· {hint}</span>}
    </div>
  );
}
