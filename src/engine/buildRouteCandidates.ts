import type {
  ScoredPOI, Constraints, Persona, Category, Route, RouteStop,
} from '../types';
import { distBetween, travelEstimate } from './geo';
import { buildMapLeg } from '../data/mapData';
import { slotTemplateFor } from '../data/slotPlans';
import { anchorAreas } from './parseConstraints';

// ------------------------------------------------------------
// ④ buildRouteCandidates
// 关键反「穷举」「模板」设计:
//   1) slot plan(类目序列)由 时间/时长/pace/persona 动态推导,
//      而不是写死「文化→咖啡→正餐→夜景」。
//   2) 每个 slot 只从该类目 top-K 候选里取,候选集很小。
//   3) beam search(宽度 BEAM)做组合,按 "累计分 - 距离惩罚 - 时段冲突" 剪枝,
//      产出若干条结构不同的候选路线,绝不枚举全部组合。
// ------------------------------------------------------------

const BEAM = 6;          // beam 宽度
const TOPK_PER_SLOT = 7; // 每个 slot 取候选 top-K
const OUTPUT = 6;        // 最多产出候选路线数

/** 动态生成 slot plan(类目序列) */
export function planSlots(c: Constraints, persona: Persona): Category[] {
  const start = c.startTime;
  const durH = c.durationMin / 60;
  const end = start + durH;
  const slots = slotTemplateFor(c, persona);

  // 期望 POI 数量:时长越长越多,pace=relaxed 减一档,packed 加一档
  let n = durH <= 2.5 ? 3 : durH <= 4 ? 4 : 5;
  if (c.pace === 'relaxed') n = Math.max(3, n - 1);
  if (c.pace === 'packed') n = Math.min(5, n + 1);
  if (c.budgetPerCapita != null && c.budgetPerCapita <= 320) n = Math.min(n, 4);
  if (c.budgetPerCapita != null && c.budgetPerCapita <= 180) n = Math.min(n, 3);

  const isMeal = (h: number) => (h >= 11 && h <= 13.5) || (h >= 17 && h <= 20.5);
  const latestEnd = Math.min(persona.latestEnd, end + 0.25);
  const hasNight = end >= 19 && latestEnd >= 19.5;

  // 后处理:确保至少跨 3 个不同类目(类目多样性)
  ensureDiversity(slots, persona, hasNight, isMeal(start) || isMeal(end));

  // 把餐饮尽量挪到饭点位置(按 slot 时刻排序约束):
  reorderMealToMealtime(slots, start, durH);

  return slots.slice(0, n);
}

function pickByPriority(persona: Persona, cands: Category[]): Category {
  let best = cands[0];
  let bestW = -Infinity;
  for (const cat of cands) {
    const w = persona.categoryPriority[cat] ?? 0;
    if (w > bestW) { bestW = w; best = cat; }
  }
  return best;
}

function ensureDiversity(
  slots: Category[], persona: Persona, hasNight: boolean, hasMeal: boolean,
) {
  const uniq = new Set(slots);
  if (uniq.size >= 3) return;
  const fillers: Category[] = hasNight
    ? ['culture', 'dining', 'nightscape', 'cafe', 'entertainment']
    : ['culture', 'dining', 'cafe', 'entertainment', 'shopping'];
  for (let i = 0; i < slots.length && new Set(slots).size < 3; i++) {
    for (const f of fillers) {
      if (!slots.includes(f)) { slots[i] = f; break; }
    }
  }
}

function reorderMealToMealtime(slots: Category[], start: number, durH: number) {
  const n = slots.length;
  const mealIdx = slots.indexOf('dining');
  if (mealIdx < 0) return;
  // 期望饭点 slot 索引
  for (let i = 0; i < n; i++) {
    const t = start + (durH * (i + 0.5)) / n;
    if ((t >= 11 && t <= 13.5) || (t >= 17 && t <= 20)) {
      // 把 dining 换到这个位置
      if (i !== mealIdx) {
        const tmp = slots[i];
        slots[i] = 'dining';
        slots[mealIdx] = tmp;
      }
      break;
    }
  }
}

/** 取每个 slot 类目的 top-K 候选 */
function topKForSlots(
  slots: Category[], scored: ScoredPOI[], c: Constraints,
): Map<number, ScoredPOI[]> {
  const byCat = new Map<Category, ScoredPOI[]>();
  for (const s of scored) {
    const arr = byCat.get(s.poi.category) ?? [];
    arr.push(s);
    byCat.set(s.poi.category, arr);
  }
  const anchors = new Set(anchorAreas(c));
  const result = new Map<number, ScoredPOI[]>();
  slots.forEach((cat, idx) => {
    const catPool = byCat.get(cat) ?? [];
    const anchorPool = anchors.size
      ? catPool.filter((item) => anchors.has(item.poi.area)).slice(0, 3)
      : [];
    const seen = new Set<string>();
    const pool = [...anchorPool, ...catPool]
      .filter((item) => {
        if (seen.has(item.poi.id)) return false;
        seen.add(item.poi.id);
        return true;
      })
      .slice(0, TOPK_PER_SLOT + anchorPool.length);
    result.set(idx, pool);
  });
  return result;
}

interface PartialRoute {
  picks: ScoredPOI[];
  usedIds: Set<string>;
  scoreSum: number;
  penalty: number;
}

/**
 * 估算「在已选 picks 之后,下一个节点」的预计到达时刻(小时)。
 * 用于 beam search 阶段的时段可行性过滤 —— 这是路线感知营业时间的关键。
 * 简化:按已选节点顺序累计 停留 + 段间交通(粗略,顺序优化在 materialize 再做)。
 */
function estimateEta(picks: ScoredPOI[], c: Constraints, persona: Persona): number {
  let clock = c.startTime;
  for (let i = 0; i < picks.length; i++) {
    if (i > 0) {
      const d = distBetween(picks[i - 1].poi, picks[i].poi);
      clock += travelEstimate(d, persona.walkTolerance).minutes / 60;
    }
    clock = Math.max(clock, picks[i].poi.openHour) + picks[i].poi.avgDuration / 60;
  }
  // 加一段平均接驳(到下一个点)
  return clock + 0.2;
}

/**
 * 有效收尾时间 = min(画像期望, 用户计划结束时间)。
 * 用户在文本里说「7点前回家/晚饭前结束」会反推出更早的 durationMin,
 * 这里据此收紧,使路线不会安排到那之后的 POI。
 */
function effectiveLatestEnd(c: Constraints, persona: Persona): number {
  const planEnd = c.startTime + c.durationMin / 60;
  return Math.min(persona.latestEnd, planEnd + 0.25);
}

/**
 * beam search:逐 slot 扩展,维护宽度 BEAM 的最优部分路线。
 * 评估 = Σpersonalized_score − 距离惩罚 − 时段/重复惩罚
 */
export function buildRouteCandidates(
  scored: ScoredPOI[], c: Constraints, persona: Persona,
): { slots: Category[]; routes: Route[] } {
  const slots = planSlots(c, persona);
  const slotPools = topKForSlots(slots, scored, c);
  const latestEnd = effectiveLatestEnd(c, persona);
  const anchors = new Set(anchorAreas(c));

  let beams: PartialRoute[] = [{ picks: [], usedIds: new Set(), scoreSum: 0, penalty: 0 }];

  for (let i = 0; i < slots.length; i++) {
    const pool = slotPools.get(i) ?? [];
    const next: PartialRoute[] = [];

    for (const beam of beams) {
      // 若该 slot 没候选(类目空),跳过该 slot(容错)
      if (pool.length === 0) { next.push(beam); continue; }

      // 估算本 slot 的预计到达时刻(基于已选节点的累计时间)
      const eta = estimateEta(beam.picks, c, persona);

      // 时段可行性:剔除「到那个点已打烊」或「开门太晚来不及」的候选
      const feasible = pool.filter((cand) => {
        const { openHour, closeHour, avgDuration } = cand.poi;
        const arrive = Math.max(eta, openHour);
        // 到达时已过营业结束 → 不可行
        if (arrive >= closeHour - 0.01) return false;
        // 玩到结束会大幅超过收尾时间(留 0.5h 宽容)→ 不可行
        if (arrive + avgDuration / 60 > latestEnd + 0.5) return false;
        return true;
      });
      // 兜底:若全被过滤(罕见),退回原 pool 以保证有结果
      const usePool = feasible.length ? feasible : pool;

      for (const cand of usePool) {
        if (beam.usedIds.has(cand.poi.id)) continue;

        // 距离惩罚:与上一站的步行/交通时间
        let legPenalty = 0;
        const prev = beam.picks[beam.picks.length - 1];
        if (prev) {
          const d = distBetween(prev.poi, cand.poi);
          const t = travelEstimate(d, persona.walkTolerance);
          legPenalty = t.minutes * 0.25; // 每分钟移动 = 0.25 罚分
        }
        // 等待惩罚:若需等开门,轻罚(鼓励时段匹配的候选)
        const waitPenalty = Math.max(0, cand.poi.openHour - eta) * 6;

        const np: PartialRoute = {
          picks: [...beam.picks, cand],
          usedIds: new Set(beam.usedIds).add(cand.poi.id),
          scoreSum: beam.scoreSum + cand.score + (anchors.has(cand.poi.area) ? 12 : 0),
          penalty: beam.penalty + legPenalty + waitPenalty,
        };
        next.push(np);
      }
    }

    // 剪枝:按 (scoreSum - penalty) 取 top BEAM
    next.sort((a, b) => (b.scoreSum - b.penalty) - (a.scoreSum - a.penalty));
    // 去重:避免完全相同的 picks 集合
    const seen = new Set<string>();
    beams = [];
    for (const b of next) {
      const key = b.picks.map((p) => p.poi.id).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      beams.push(b);
      if (beams.length >= BEAM) break;
    }
  }

  // 把每条 beam 物化成 Route(排顺序 + 算时间轴),交给下游校验/排序
  const routes = beams
    .filter((b) => b.picks.length >= 3)
    .slice(0, OUTPUT)
    .map((b, idx) => materializeRoute(b.picks, c, persona, idx));

  return { slots, routes };
}

/**
 * 把一组选中的 POI 物化成带时间轴的 Route:
 *  - 用最近邻 + 饭点约束做顺序优化(压缩步行)
 *  - 计算到达/离开时间、各段交通
 * 注:这里产出的 score 是临时(scoreSum 均值),真正排序在 rankRoutes。
 */
export function materializeRoute(
  picks: ScoredPOI[], c: Constraints, persona: Persona, seq: number,
): Route {
  const ordered = orderStops(picks, c);

  const stops: RouteStop[] = [];
  let clock = c.startTime;
  let totalWalk = 0;
  let totalTransit = 0;
  let cost = 0;

  ordered.forEach((sp, i) => {
    let leg: RouteStop['legFromPrev'] = null;
    if (i > 0) {
      const prev = ordered[i - 1].poi;
      const mapLeg = buildMapLeg(prev, sp.poi, persona.walkTolerance);
      const minutes = mapLeg.chosenMode === 'walk' ? mapLeg.walkingMinutes : mapLeg.transitMinutes;
      leg = {
        distM: mapLeg.distanceM,
        minutes,
        mode: mapLeg.chosenMode,
        etaSource: mapLeg.etaSource,
        etaConfidence: mapLeg.etaConfidence,
      };
      clock += minutes / 60;
      if (mapLeg.chosenMode === 'walk') totalWalk += minutes; else totalTransit += minutes;
    }
    // 若到达早于营业,等到开门
    const arrive = Math.max(clock, sp.poi.openHour);
    const depart = arrive + sp.poi.avgDuration / 60;
    clock = depart;
    cost += sp.poi.perCapita;
    stops.push({ scored: sp, arrive, depart, legFromPrev: leg });
  });

  const coverage = [...new Set(stops.map((s) => s.scored.poi.category))];
  const avgScore = picks.reduce((s, p) => s + p.score, 0) / picks.length;

  return {
    id: `route-${seq}`,
    stops,
    totalCost: Math.round(cost),
    totalWalkMin: totalWalk,
    totalTransitMin: totalTransit,
    endTime: clock,
    score: +avgScore.toFixed(1),
    checks: [],        // validateRoute 填充
    coverage,
    explanation: '',   // explainRoute 填充
    risks: [],         // explainRoute 填充
  };
}

/**
 * 顺序优化:最近邻贪心,但把 dining 钉在饭点附近、nightscape 钉在末尾。
 */
function orderStops(picks: ScoredPOI[], c: Constraints): ScoredPOI[] {
  const night = picks.filter((p) => p.poi.category === 'nightscape');
  const meals = picks.filter((p) => p.poi.category === 'dining');
  const rest = picks.filter(
    (p) => p.poi.category !== 'nightscape' && p.poi.category !== 'dining',
  );

  // 最近邻排 rest(从离地理起点最近的开始 —— 这里用第一个作起点近似)
  const nnOrder: ScoredPOI[] = [];
  const remaining = [...rest];
  if (remaining.length) {
    let curr = remaining.shift()!;
    nnOrder.push(curr);
    while (remaining.length) {
      let bestIdx = 0;
      let bestD = Infinity;
      remaining.forEach((cand, idx) => {
        const d = distBetween(curr.poi, cand.poi);
        if (d < bestD) { bestD = d; bestIdx = idx; }
      });
      curr = remaining.splice(bestIdx, 1)[0];
      nnOrder.push(curr);
    }
  }

  // 组装:晚开始的活动(夜景)放最后,正餐插在中间靠饭点
  const startNight = c.startTime >= 18;
  let result: ScoredPOI[];
  if (startNight) {
    // 夜晚出发:餐 → 文化/休闲 → 夜景
    result = [...meals, ...nnOrder, ...night];
  } else {
    // 白天出发:休闲前半 → 餐(中段) → 休闲后半 → 夜景
    const mid = Math.floor(nnOrder.length / 2);
    result = [
      ...nnOrder.slice(0, mid),
      ...meals,
      ...nnOrder.slice(mid),
      ...night,
    ];
  }
  return result;
}
