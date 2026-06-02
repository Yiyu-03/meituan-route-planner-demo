import type { AgentTraceStep } from '../types';
import { Card, SectionLabel } from './ui';

const STEP_COPY: Partial<Record<AgentTraceStep['key'], { fn: string; desc: string }>> = {
  parseIntent: {
    fn: 'parseConstraints',
    desc: '抽取城市、区域、时间、人数、预算、偏好、规避和必去类目。',
  },
  inferPersona: {
    fn: 'inferPersona',
    desc: '根据“约会、带娃、朋友、一个人”等文本信号判断出行场景。',
  },
  detectConflict: {
    fn: 'detectConflict',
    desc: '检查手选场景和文本意图是否冲突，冲突时优先相信文本。',
  },
  retrieveCandidates: {
    fn: 'retrieveCandidates',
    desc: '按区域、类目、营业时间和规避条件召回候选 POI。',
  },
  scorePOIs: {
    fn: 'scorePOIs',
    desc: '结合画像、预算、距离、UGC、人均和排队风险做个性化排序。',
  },
  planRoute: {
    fn: 'buildRouteCandidates',
    desc: '从前排候选里组合 3-5 个地点，生成多条可比较路线。',
  },
  validateConstraints: {
    fn: 'validateRoute',
    desc: '校验营业时间、预算、交通时间、步行距离、排队和类目覆盖。',
  },
  repairIfNeeded: {
    fn: 'repair/replan',
    desc: '发现硬冲突时只替换受影响节点，保留其他路线结构。',
  },
  explainRoute: {
    fn: 'explainRoute',
    desc: '把结构化结果转成人能看懂的路线说明、提醒和推荐依据。',
  },
};

export function AgentTrace({ trace }: { trace: AgentTraceStep[] }) {
  if (!trace.length) return null;

  return (
    <Card className="p-4">
      <SectionLabel hint="不是直接生成攻略,而是逐步规划并校验">Agent Loop 规划链路</SectionLabel>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {trace.map((s, idx) => (
          <div key={s.key} className="rounded-xl border border-ink-100 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-100 text-[12px] font-bold text-brand-700">
                  {idx + 1}
                </span>
                <span className="text-[12px] font-semibold text-ink-800">{STEP_COPY[s.key]?.fn ?? s.label}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                s.status === 'ok' ? 'bg-emerald-50 text-emerald-700' :
                  s.status === 'skip' ? 'bg-ink-50 text-ink-400' : 'bg-amber-50 text-amber-700'
              }`}>
                {s.status} · {s.ms}ms
              </span>
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-ink-500">{STEP_COPY[s.key]?.desc}</div>
            <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-ink-400">输入: {s.input}</div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-700">结果: {s.output}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
