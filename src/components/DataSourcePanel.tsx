import type { PlanResult, Route } from '../types';
import { Card, SectionLabel } from './ui';

const SOURCE_LABEL: Record<string, string> = {
  mock_dianping: '生活数据: mock 点评/UGC',
  mock_meituan: '交易/履约数据: mock 美团',
  mock_map: '导航数据: mock 地图',
};

export function DataSourcePanel({ plan, route }: { plan: PlanResult; route: Route }) {
  const counts = plan.candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.poi.source] = (acc[c.poi.source] ?? 0) + 1;
    return acc;
  }, {});
  const navSources = route.stops
    .map((s) => s.legFromPrev?.etaSource)
    .filter(Boolean)
    .reduce<Record<string, number>>((acc, s) => {
      acc[s!] = (acc[s!] ?? 0) + 1;
      return acc;
    }, {});

  return (
    <Card className="p-4">
      <SectionLabel hint="把生活 POI 和导航 ETA 分开展示">数据源证据</SectionLabel>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-100 p-3">
          <div className="text-[12px] font-semibold text-ink-700">候选 POI 池</div>
          <div className="mt-2 space-y-1">
            {Object.entries(counts).map(([source, count]) => (
              <div key={source} className="flex justify-between text-[12px] text-ink-500">
                <span>{SOURCE_LABEL[source] ?? source}</span>
                <span className="font-semibold text-ink-700">{count}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">{plan.retrieveNote}</p>
        </div>
        <div className="rounded-xl border border-ink-100 p-3">
          <div className="text-[12px] font-semibold text-ink-700">导航 ETA</div>
          <div className="mt-2 space-y-1">
            {Object.entries(navSources).length ? Object.entries(navSources).map(([source, count]) => (
              <div key={source} className="flex justify-between text-[12px] text-ink-500">
                <span>{SOURCE_LABEL[source] ?? source}</span>
                <span className="font-semibold text-ink-700">{count} 段</span>
              </div>
            )) : <span className="text-[12px] text-ink-400">首站无需导航边</span>}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            POI 评分使用标签、UGC、人均、评分、距离;动线时间使用 mock map leg,不让 LLM 直接编路线。
          </p>
        </div>
      </div>
    </Card>
  );
}

