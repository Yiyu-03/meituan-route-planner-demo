import type { PlanResult, Persona } from '../types';
import { runPipeline } from '../engine/pipeline';
import { PERSONA_MAP, PERSONAS } from '../data/personas';

// ------------------------------------------------------------
// 评测 case:每条断言一组性质。
// 重点 case 是「同输入×不同画像 → 路线不同」,直接证明非预制。
// ------------------------------------------------------------

export interface EvalCase {
  id: string;
  title: string;
  input: string;
  personaId: string;
  asserts: { name: string; fn: (r: PlanResult) => boolean; desc: string }[];
}

const A = {
  minStops: (n: number) => (r: PlanResult) => (r.routes[0]?.stops.length ?? 0) >= n,
  hasCategory: (cat: string) => (r: PlanResult) =>
    r.routes[0]?.coverage.includes(cat as any) ?? false,
  coverGte: (n: number) => (r: PlanResult) => (r.routes[0]?.coverage.length ?? 0) >= n,
  allScored: () => (r: PlanResult) =>
    r.routes[0]?.stops.every((s) => s.scored.score > 0) ?? false,
  budgetWithinOrFlagged: () => (r: PlanResult) => {
    const route = r.routes[0];
    if (!route) return false;
    const b = r.constraints.budgetPerCapita;
    if (b == null) return true;
    if (route.totalCost <= b * 1.15) return true;
    // 超了必须被 fail/warn 标记
    return route.checks.some((c) => c.key === 'budget' && c.status !== 'pass');
  },
  noBadOpen: () => (r: PlanResult) => {
    const route = r.routes[0];
    if (!route) return false;
    const openCheck = route.checks.find((c) => c.key === 'open');
    // 允许 warn,但不允许 fail(硬冲突)
    return openCheck?.status !== 'fail';
  },
  avoidRespected: (tag: string) => (r: PlanResult) => {
    const route = r.routes[0];
    if (!route) return false;
    // avoid 的 tag 不应作为任一 POI 的主标签出现
    return route.stops.every((s) => !s.scored.poi.sceneTags.slice(0, 2).includes(tag as any));
  },
  hasReasons: () => (r: PlanResult) =>
    r.routes[0]?.stops.every((s) => s.scored.reasons.length > 0) ?? false,
  hasAlternatives: () => (r: PlanResult) => r.routes.length >= 2,
  hasAgentTrace: () => (r: PlanResult) => (r.agentTrace?.length ?? 0) >= 9,
  hasDataSources: () => (r: PlanResult) =>
    r.candidates.length > 0 && r.candidates.every((c) => !!c.poi.source && c.poi.confidence > 0 && !!c.poi.freshness),
  inferredPersona: (id: string) => (r: PlanResult) => r.personaInference?.personaId === id,
  resolvedPersona: (id: string) => (r: PlanResult) => r.personaId === id,
  conflictShown: () => (r: PlanResult) => r.conflict?.hasConflict === true,
  endsBefore: (h: number) => (r: PlanResult) => {
    const route = r.routes[0];
    if (!route) return false;
    // 允许 warn,但用于检查家庭场景大致早收尾
    return route.endTime <= h + 1.0;
  },
};

export const CASES: EvalCase[] = [
  {
    id: 'c1', title: '情侣·外滩夜晚', personaId: 'couple',
    input: '周六晚上和女朋友在外滩附近约会,想要安静一点有氛围,人均400左右,最好能看夜景,不要太吵',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '含夜景', fn: A.hasCategory('nightscape'), desc: '覆盖夜景类目' },
      { name: '预算达标/标记', fn: A.budgetWithinOrFlagged(), desc: '预算内或被标记' },
      { name: '营业无硬冲突', fn: A.noBadOpen(), desc: '无 fail 级营业冲突' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有 personalized_score' },
      { name: '有推荐理由', fn: A.hasReasons(), desc: '每站有推荐理由' },
      { name: '有备选', fn: A.hasAlternatives(), desc: '至少 1 条备选路线' },
    ],
  },
  {
    id: 'c2', title: '带娃·静安半天', personaId: 'family',
    input: '周日下午带4岁小孩在静安寺一带玩,要亲子友好不要太累,预算人均150,晚饭前要结束',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '覆盖≥3类', fn: A.coverGte(3), desc: '类目覆盖 ≥3' },
      { name: '无夜店', fn: A.avoidRespected('nightlife'), desc: '不含夜生活主标签 POI' },
      { name: '预算达标/标记', fn: A.budgetWithinOrFlagged(), desc: '预算内或被标记' },
      { name: '早收尾', fn: A.endsBefore(18.5), desc: '大致晚饭前结束' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有评分' },
    ],
  },
  {
    id: 'c3', title: '朋友·大学路热闹', personaId: 'friends',
    input: '五个朋友周五晚上在大学路聚会,想热闹好玩,吃点好的再玩一玩,人均200以内,可以玩到挺晚',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '含餐饮', fn: A.hasCategory('dining'), desc: '覆盖餐饮' },
      { name: '预算达标/标记', fn: A.budgetWithinOrFlagged(), desc: '预算内或被标记' },
      { name: '营业无硬冲突', fn: A.noBadOpen(), desc: '无 fail 级营业冲突' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有评分' },
      { name: '有备选', fn: A.hasAlternatives(), desc: '至少 1 条备选路线' },
    ],
  },
  {
    id: 'c4', title: '独逛·武康路', personaId: 'solo',
    input: '一个人下午想在武康路衡复一带citywalk,喜欢文艺安静能拍照的地方,预算不高人均100',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '覆盖≥3类', fn: A.coverGte(3), desc: '类目覆盖 ≥3' },
      { name: '预算达标/标记', fn: A.budgetWithinOrFlagged(), desc: '预算内或被标记' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有评分' },
      { name: '有推荐理由', fn: A.hasReasons(), desc: '每站有推荐理由' },
      { name: 'Agent Trace', fn: A.hasAgentTrace(), desc: '9段 Agent Loop 全部记录' },
      { name: '数据源完整', fn: A.hasDataSources(), desc: 'POI 有 source/confidence/freshness' },
    ],
  },
  {
    id: 'c5', title: '情侣·新天地下午到晚上', personaId: 'couple',
    input: '和对象新天地从下午逛到晚上,想要精致浪漫,看个演出再吃饭,人均500没问题',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '覆盖≥3类', fn: A.coverGte(3), desc: '类目覆盖 ≥3' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有评分' },
      { name: '有备选', fn: A.hasAlternatives(), desc: '至少 1 条备选路线' },
    ],
  },
  {
    id: 'c6', title: '带娃·陆家嘴亲子', personaId: 'family',
    input: '带孩子去陆家嘴,想看科技馆和登高看景,中午吃饭,人均200,晚上7点前回家',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '含餐饮', fn: A.hasCategory('dining'), desc: '覆盖餐饮' },
      { name: '无夜店', fn: A.avoidRespected('nightlife'), desc: '不含夜生活主标签 POI' },
      { name: '早收尾', fn: A.endsBefore(19), desc: '大致 19 点前结束' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有评分' },
    ],
  },
  {
    id: 'c7', title: '独逛·豫园老城厢', personaId: 'solo',
    input: '自己一个人白天去豫园老城厢逛逛,想看园林和老上海的东西,顺便吃点本地小吃,不要太贵',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '含文化', fn: A.hasCategory('culture'), desc: '覆盖文化类目' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有评分' },
      { name: '有推荐理由', fn: A.hasReasons(), desc: '每站有推荐理由' },
    ],
  },
  {
    id: 'c8', title: '朋友·徐家汇玩一天', personaId: 'friends',
    input: '周末几个同学在徐家汇玩一天,想看电影玩密室,中间吃饭,人均180,别太赶',
    asserts: [
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
      { name: '含餐饮', fn: A.hasCategory('dining'), desc: '覆盖餐饮' },
      { name: '覆盖≥3类', fn: A.coverGte(3), desc: '类目覆盖 ≥3' },
      { name: '每站有评分', fn: A.allScored(), desc: '所有 POI 有评分' },
    ],
  },
  {
    id: 'c9', title: '冲突修复·文本优先', personaId: 'couple',
    input: '一个人下午想在武康路衡复一带citywalk,喜欢文艺安静能拍照的地方,预算不高人均100',
    asserts: [
      { name: '识别独自', fn: A.inferredPersona('solo'), desc: '文本强信号推断为独自闲逛' },
      { name: '冲突展示', fn: A.conflictShown(), desc: '手选情侣与文本独自产生冲突' },
      { name: '按文本优先', fn: A.resolvedPersona('solo'), desc: '高置信文本优先覆盖手选画像' },
      { name: 'Agent Trace', fn: A.hasAgentTrace(), desc: '9段 Agent Loop 全部记录' },
      { name: '≥3 POI', fn: A.minStops(3), desc: '路线至少 3 个 POI' },
    ],
  },
];

// ---- 跨画像差异 case:同输入,4 个画像,路线 POI 集合应不同 ----
export interface PersonaDiffCase {
  id: string;
  title: string;
  input: string;
}

export const PERSONA_DIFF_CASES: PersonaDiffCase[] = [
  { id: 'pd1', title: '同输入·外滩夜晚 × 4画像', input: '晚上在外滩附近活动,人均300,玩到大概十点' },
  { id: 'pd2', title: '同输入·徐家汇下午 × 4画像', input: '下午在徐家汇玩,人均200,吃个饭' },
  { id: 'pd3', title: '同输入·新天地傍晚 × 4画像', input: '傍晚在新天地,人均250' },
];

export interface CaseResult {
  id: string;
  title: string;
  asserts: { name: string; pass: boolean; desc: string }[];
  allPass: boolean;
  stops: string[];      // 推荐路线的 POI 名称
  routeCount: number;
}

export function runCase(c: EvalCase): CaseResult {
  const persona = PERSONA_MAP[c.personaId];
  const result = runPipeline(c.input, persona);
  const asserts = c.asserts.map((a) => ({
    name: a.name,
    pass: safe(() => a.fn(result)),
    desc: a.desc,
  }));
  return {
    id: c.id,
    title: c.title,
    asserts,
    allPass: asserts.every((a) => a.pass),
    stops: result.routes[0]?.stops.map((s) => s.scored.poi.name) ?? [],
    routeCount: result.routes.length,
  };
}

export interface PersonaDiffResult {
  id: string;
  title: string;
  perPersona: { persona: string; stops: string[] }[];
  distinct: boolean;   // 至少有两个画像的 POI 集合不同
  pairwiseDiff: number;// 不同对数 / 总对数
}

export function runPersonaDiff(c: PersonaDiffCase): PersonaDiffResult {
  const perPersona = PERSONAS.map((p) => {
    const r = runPipeline(c.input, p);
    return {
      persona: p.label,
      stops: r.routes[0]?.stops.map((s) => s.scored.poi.id) ?? [],
      names: r.routes[0]?.stops.map((s) => s.scored.poi.name) ?? [],
    };
  });

  // 两两比较 POI 集合
  let diffPairs = 0, total = 0;
  for (let i = 0; i < perPersona.length; i++) {
    for (let j = i + 1; j < perPersona.length; j++) {
      total++;
      const a = new Set(perPersona[i].stops);
      const b = perPersona[j].stops;
      const same = b.length === a.size && b.every((x) => a.has(x));
      if (!same) diffPairs++;
    }
  }

  return {
    id: c.id,
    title: c.title,
    perPersona: perPersona.map((p) => ({ persona: p.persona, stops: p.names })),
    distinct: diffPairs > 0,
    pairwiseDiff: +(diffPairs / total).toFixed(2),
  };
}

function safe(fn: () => boolean): boolean {
  try { return fn(); } catch { return false; }
}
