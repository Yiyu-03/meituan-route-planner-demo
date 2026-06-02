import type { Constraints } from '../types';
import { SCENE_LABEL, CATEGORY_LABEL } from '../types';
import { AREA_MAP } from '../data/areas';
import { anchorAreas } from '../engine/parseConstraints';
import { Chip, Card, SectionLabel, fmtH } from './ui';

export function ConstraintPanel({ c }: { c: Constraints }) {
  const areas = anchorAreas(c);
  const durH = (c.durationMin / 60).toFixed(1);

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-[12px] text-ink-400">{label}</span>
      <span className="text-[13px] text-ink-800">{children}</span>
    </div>
  );

  return (
    <Card className="p-4">
      <SectionLabel hint="规则式抽取 · 可逐条溯源">约束抽取</SectionLabel>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="区域">
          {areas.length ? areas.map((k) => AREA_MAP[k].name).join('、') : '未指定(市中心)'}
        </Field>
        <Field label="时间">
          {fmtH(c.startTime)} 起 · 约 {durH} 小时
        </Field>
        <Field label="人数">{c.party} 人</Field>
        <Field label="预算">{c.budgetPerCapita != null ? `人均 ¥${c.budgetPerCapita}` : '未设'}</Field>
        <Field label="节奏">
          {c.pace === 'relaxed' ? '舒缓' : c.pace === 'packed' ? '紧凑' : '正常'}
        </Field>
        <Field label="交通">{c.transport === 'walk' ? '步行优先' : '步行+地铁'}</Field>
      </div>

      {(c.prefs.length > 0 || c.avoid.length > 0 || c.mustCategories.length > 0) && (
        <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
          {c.mustCategories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-ink-400">必去类目</span>
              {c.mustCategories.map((m) => (
                <Chip key={m} size="sm" tone="gold">{CATEGORY_LABEL[m]}</Chip>
              ))}
            </div>
          )}
          {c.prefs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-ink-400">偏好</span>
              {c.prefs.map((t) => (
                <Chip key={t} size="sm" tone="gold">{SCENE_LABEL[t]}</Chip>
              ))}
            </div>
          )}
          {c.avoid.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-ink-400">规避</span>
              {c.avoid.map((t) => (
                <Chip key={t} size="sm" tone="muted">✕ {SCENE_LABEL[t]}</Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {c.matched.length > 0 && (
        <div className="mt-3 border-t border-ink-100 pt-3">
          <span className="text-[12px] text-ink-400">命中关键词</span>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {c.matched.map((m, i) => (
              <span key={i} className="rounded bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
