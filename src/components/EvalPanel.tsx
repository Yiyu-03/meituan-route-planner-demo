import { useState } from 'react';
import {
  CASES, PERSONA_DIFF_CASES, runCase, runPersonaDiff,
  type CaseResult, type PersonaDiffResult,
} from '../eval/cases';
import { Card, SectionLabel, Badge, StatusDot } from './ui';

export function EvalPanel() {
  const [ran, setRan] = useState(false);
  const [cases, setCases] = useState<CaseResult[]>([]);
  const [diffs, setDiffs] = useState<PersonaDiffResult[]>([]);

  const run = () => {
    setCases(CASES.map(runCase));
    setDiffs(PERSONA_DIFF_CASES.map(runPersonaDiff));
    setRan(true);
  };

  const totalAsserts = cases.reduce((s, c) => s + c.asserts.length, 0);
  const passAsserts = cases.reduce((s, c) => s + c.asserts.filter((a) => a.pass).length, 0);
  const allPassCases = cases.filter((c) => c.allPass).length;
  const distinctCount = diffs.filter((d) => d.distinct).length;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">评测面板</h2>
          <p className="text-[12px] text-ink-400">
            {CASES.length} 个功能 case + {PERSONA_DIFF_CASES.length} 个「同输入×多画像」差异 case,全部在浏览器内实时运行。
          </p>
        </div>
        <button
          onClick={run}
          className="rounded-lg bg-brand-400 px-5 py-2 text-[13px] font-semibold text-ink-900 shadow-sm transition-all hover:-translate-y-px hover:bg-brand-300"
        >
          {ran ? '重新运行评测' : '▶ 运行评测'}
        </button>
      </Card>

      {ran && (
        <>
          {/* 汇总指标 */}
          <div className="grid grid-cols-3 gap-3">
            <Metric label="断言通过" value={`${passAsserts}/${totalAsserts}`} pct={passAsserts / totalAsserts} />
            <Metric label="全过 case" value={`${allPassCases}/${cases.length}`} pct={allPassCases / cases.length} />
            <Metric
              label="画像差异"
              value={`${distinctCount}/${diffs.length}`}
              pct={distinctCount / diffs.length}
              note="证明非预制"
            />
          </div>

          {/* Part 1 */}
          <Card className="p-4">
            <SectionLabel hint="功能断言">Part 1 · 路线质量</SectionLabel>
            <div className="space-y-2">
              {cases.map((c) => (
                <div key={c.id} className="rounded-xl border border-ink-100 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge tone={c.allPass ? 'green' : 'red'}>{c.allPass ? 'PASS' : 'FAIL'}</Badge>
                      <span className="text-[13px] font-medium text-ink-800">{c.title}</span>
                      <span className="text-[11px] text-ink-300">{c.routeCount} 条路线</span>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[12px] text-ink-400">
                    {c.stops.join(' → ')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {c.asserts.map((a) => (
                      <span key={a.name} className="flex items-center gap-1 text-[11px]">
                        <StatusDot status={a.pass ? 'pass' : 'fail'} />
                        <span className={a.pass ? 'text-ink-500' : 'text-rose-600'}>{a.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Part 2 */}
          <Card className="p-4">
            <SectionLabel hint="同输入 → 不同画像 → 不同路线">Part 2 · 个性化差异(核心论点)</SectionLabel>
            <div className="space-y-3">
              {diffs.map((d) => (
                <div key={d.id} className="rounded-xl border border-ink-100 p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={d.distinct ? 'green' : 'red'}>{d.distinct ? 'DISTINCT' : 'IDENTICAL'}</Badge>
                    <span className="text-[13px] font-medium text-ink-800">{d.title}</span>
                    <span className="text-[11px] text-ink-400">两两差异 {Math.round(d.pairwiseDiff * 100)}%</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {d.perPersona.map((p) => (
                      <div key={p.persona} className="flex gap-2 text-[12px]">
                        <span className="w-16 shrink-0 font-medium text-brand-600">{p.persona}</span>
                        <span className="text-ink-500">{p.stops.join(' → ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, pct, note }: { label: string; value: string; pct: number; note?: string }) {
  const good = pct >= 0.999;
  return (
    <Card className="p-4">
      <div className="text-[12px] text-ink-400">{label}{note && <span className="ml-1 text-brand-500">· {note}</span>}</div>
      <div className={`tnum mt-1 text-2xl font-bold ${good ? 'text-emerald-600' : 'text-ink-800'}`}>{value}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={`h-full rounded-full ${good ? 'bg-emerald-500' : 'bg-brand-400'}`}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </Card>
  );
}
