import type { Constraints, POI, Route, SceneTag } from '../types';
import { SCENE_LABEL } from '../types';
import { AREA_MAP } from '../data/areas';
import { anchorAreas } from '../engine/parseConstraints';

export function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatAreas(c: Constraints): string {
  const keys = anchorAreas(c);
  if (!keys.length) return c.city.split('@')[0] || '上海';
  return keys.map((key) => AREA_MAP[key]?.name ?? key).join('、');
}

export function formatTags(tags: SceneTag[]): string[] {
  return tags.map((tag) => SCENE_LABEL[tag] ?? tag);
}

function timeOfDayLabel(h: number): string {
  if (h < 11) return '上午';
  if (h < 13.5) return '中午';
  if (h < 17) return '下午';
  if (h < 19) return '傍晚';
  return '晚上';
}

function partyLabel(party: number): string {
  if (party <= 1) return '独自出行';
  if (party === 2) return '两人出行';
  if (party <= 4) return `${party}人小聚`;
  return `${party}人聚会`;
}

export function formatConstraintSummary(c: Constraints): string {
  const bits = [timeOfDayLabel(c.startTime), formatAreas(c), partyLabel(c.party)];
  if (c.budgetPerCapita != null) {
    bits.push(c.budgetSource === 'soft' ? `软预算≤¥${c.budgetPerCapita}` : `人均≤¥${c.budgetPerCapita}`);
  } else if (c.diningBudgetPerCapita != null) {
    bits.push(`正餐≤¥${c.diningBudgetPerCapita}`);
  }
  if (c.prefs.length) bits.push(`想要${formatTags(c.prefs).slice(0, 3).join('、')}`);
  if (c.avoid.length) bits.push(`避开${formatTags(c.avoid).join('、')}`);
  return bits.join(' · ');
}

export type BudgetTone = 'ok' | 'warn' | 'over';

export interface BudgetVerdict {
  tone: BudgetTone;
  display: string;
  label: string;
  overByPct: number;
}

export function budgetVerdict(totalCost: number, budget: number | null): BudgetVerdict {
  if (budget == null) {
    return { tone: 'ok', display: `人均 ¥${totalCost}`, label: '未设预算', overByPct: 0 };
  }
  const ratio = totalCost / budget;
  if (ratio <= 1) {
    return { tone: 'ok', display: `¥${totalCost} / ¥${budget} ✓`, label: '预算内', overByPct: 0 };
  }
  const overByPct = Math.round((ratio - 1) * 100);
  if (ratio <= 1.15) {
    return {
      tone: 'warn',
      display: `¥${totalCost} / ¥${budget} · 略超 ${overByPct}%`,
      label: `略超 ${overByPct}%`,
      overByPct,
    };
  }
  return {
    tone: 'over',
    display: `¥${totalCost} / ¥${budget} · 超 ${overByPct}%`,
    label: `超 ${overByPct}%`,
    overByPct,
  };
}

export interface RouteBudgetVerdict extends BudgetVerdict {
  scope: 'total' | 'dining' | 'none';
  budget: number | null;
  mealCost?: number | null;
}

export function routeBudgetVerdict(route: Route, c: Constraints): RouteBudgetVerdict {
  if (c.budgetPerCapita != null) {
    return { ...budgetVerdict(route.totalCost, c.budgetPerCapita), scope: 'total', budget: c.budgetPerCapita };
  }
  if (c.diningBudgetPerCapita != null) {
    const meal = route.stops.find((stop) => stop.scored.poi.category === 'dining');
    if (!meal) {
      return {
        tone: 'warn',
        display: `午饭预算 ≤¥${c.diningBudgetPerCapita}`,
        label: '未安排正餐',
        overByPct: 0,
        scope: 'dining',
        budget: c.diningBudgetPerCapita,
        mealCost: null,
      };
    }
    const mealCost = meal.scored.poi.perCapita;
    const ratio = mealCost / c.diningBudgetPerCapita;
    if (ratio <= 1) {
      return {
        tone: 'ok',
        display: `午饭 ¥${mealCost} / ¥${c.diningBudgetPerCapita} ✓`,
        label: '午饭预算内',
        overByPct: 0,
        scope: 'dining',
        budget: c.diningBudgetPerCapita,
        mealCost,
      };
    }
    const overByPct = Math.round((ratio - 1) * 100);
    return {
      tone: ratio <= 1.15 ? 'warn' : 'over',
      display: `午饭 ¥${mealCost} / ¥${c.diningBudgetPerCapita} · 超 ${overByPct}%`,
      label: ratio <= 1.15 ? `午饭略超 ${overByPct}%` : `午饭超 ${overByPct}%`,
      overByPct,
      scope: 'dining',
      budget: c.diningBudgetPerCapita,
      mealCost,
    };
  }
  return { ...budgetVerdict(route.totalCost, null), scope: 'none', budget: null };
}

export type RouteVerdictStatus = 'ready' | 'adjust' | 'blocked';

export interface RouteVerdict {
  status: RouteVerdictStatus;
  stamp: '拿来就走' | '建议调整' | '需调整';
  label: string;
  tone: 'green' | 'amber' | 'red';
  hardFailures: string[];
  warnings: string[];
}

const HARD_MAX_LEG_MINUTES = 45;
const HARD_MAX_LEG_DISTANCE_M = 12000;
const HARD_MAX_WALK_MINUTES = 25;
const HARD_MAX_TOTAL_MOVE_MINUTES = 100;

export function routeVerdict(route: Route, c?: Constraints): RouteVerdict {
  const hardFailures: string[] = [];
  const warnings: string[] = [];

  if (!route.stops.length) hardFailures.push('路线没有可用站点');

  for (const stop of route.stops) {
    const leg = stop.legFromPrev;
    if (!leg) continue;
    if (leg.minutes > HARD_MAX_LEG_MINUTES) hardFailures.push(`${stop.scored.poi.name} 前一段 ${leg.minutes} 分钟`);
    if (leg.distM > HARD_MAX_LEG_DISTANCE_M) hardFailures.push(`${stop.scored.poi.name} 前一段 ${(leg.distM / 1000).toFixed(1)}km`);
    if (leg.mode === 'walk' && leg.minutes > HARD_MAX_WALK_MINUTES) hardFailures.push(`${stop.scored.poi.name} 前一段步行 ${leg.minutes} 分钟`);
  }

  const totalMove = route.totalWalkMin + route.totalTransitMin;
  if (totalMove >= HARD_MAX_TOTAL_MOVE_MINUTES) hardFailures.push(`总移动约 ${totalMove} 分钟`);

  if (c) {
    const plannedEnd = c.startTime + c.durationMin / 60;
    if (route.endTime > plannedEnd + 0.5) hardFailures.push(`预计 ${fmtHour(route.endTime)} 结束,明显超出 ${fmtHour(plannedEnd)}`);
    if (route.endTime - c.startTime > 10) hardFailures.push(`行程跨度超过 10 小时`);

    const budget = routeBudgetVerdict(route, c);
    if (budget.tone === 'over') hardFailures.push(budget.label);
    if (budget.tone === 'warn') warnings.push(budget.label);
  }

  for (const check of route.checks) {
    if (check.status === 'fail') hardFailures.push(`${check.label}:${check.detail}`);
    if (check.status === 'warn') warnings.push(`${check.label}:${check.detail}`);
  }

  const dedupedHard = [...new Set(hardFailures)];
  const dedupedWarn = [...new Set(warnings)];

  if (dedupedHard.length) {
    return {
      status: 'blocked',
      stamp: '需调整',
      label: '需调整',
      tone: 'red',
      hardFailures: dedupedHard,
      warnings: dedupedWarn,
    };
  }
  if (dedupedWarn.length) {
    return {
      status: 'adjust',
      stamp: '建议调整',
      label: '有提醒',
      tone: 'amber',
      hardFailures: [],
      warnings: dedupedWarn,
    };
  }
  return {
    status: 'ready',
    stamp: '拿来就走',
    label: '行程宽松',
    tone: 'green',
    hardFailures: [],
    warnings: [],
  };
}

export interface RouteAdvantage {
  label: string;
  note: string;
}

function moveMin(route: Route): number {
  return route.totalWalkMin + route.totalTransitMin;
}

function avgRating(route: Route): number {
  if (!route.stops.length) return 0;
  return route.stops.reduce((sum, stop) => sum + stop.scored.poi.rating, 0) / route.stops.length;
}

function photoCount(route: Route): number {
  return route.stops.filter((stop) => stop.scored.poi.sceneTags.includes('photo')).length;
}

export function routeAdvantage(routes: Route[], index: number, budget?: number | null): RouteAdvantage {
  if (index === 0) return { label: '推荐方案', note: '综合时间、预算、偏好最均衡' };
  const route = routes[index];
  const base = routes[0];
  const minBy = (selector: (route: Route) => number) => routes.every((item) => selector(route) <= selector(item));
  const maxBy = (selector: (route: Route) => number) => routes.every((item) => selector(route) >= selector(item));
  const photoNum = photoCount(route);
  const budgetStatus = budget != null ? budgetVerdict(route.totalCost, budget) : null;
  const overBudget = budgetStatus != null && budgetStatus.tone !== 'ok';

  if (base && route.totalCost < base.totalCost && (budget != null || minBy((item) => item.totalCost))) {
    if (budgetStatus && overBudget) {
      return {
        label: '相对省钱版',
        note: `比推荐页少 ¥${base.totalCost - route.totalCost}/人，但仍${budgetStatus.label}`,
      };
    }
    return { label: '低预算版', note: `人均 ¥${route.totalCost}，比推荐页更省` };
  }

  if (overBudget && budgetStatus) {
    return { label: '需调整备选', note: `人均 ¥${route.totalCost}，${budgetStatus.label}，仅作参考` };
  }
  if (base && minBy(moveMin) && moveMin(route) < moveMin(base)) {
    return { label: '少走路版', note: `全程移动约 ${moveMin(route)} 分钟，比推荐页更省脚力` };
  }
  if (minBy((item) => item.totalCost)) {
    return { label: '低预算版', note: `人均 ¥${route.totalCost}，几条里最省` };
  }
  if (photoNum > 0 && maxBy(photoCount) && (!base || photoNum > photoCount(base))) {
    return { label: '拍照友好版', note: `含 ${photoNum} 个出片点` };
  }
  if (maxBy(avgRating)) return { label: '高评分版', note: `平均评分 ${avgRating(route).toFixed(1)}，口碑最稳` };
  return { label: '备选方案', note: '换一种动线组合' };
}

export interface LifeTips {
  highlight: string;
  caution?: string;
}

export function lifeTips(poi: POI, arriveHour?: number): LifeTips {
  const cautions: string[] = [];
  if (poi.queueBase >= 0.65) {
    cautions.push(arriveHour != null ? `排队偏多，建议 ${fmtHour(Math.max(poi.openHour, arriveHour - 0.5))} 前到` : '排队偏多，建议错峰');
  }
  if (arriveHour != null && poi.closeHour - arriveHour <= 1 && poi.closeHour - arriveHour > 0) {
    cautions.push(`${fmtHour(poi.closeHour)} 打烊，时间偏紧`);
  }
  return { highlight: poi.ugc, caution: cautions.join(' · ') || undefined };
}

export function openingNote(poi: POI, arriveHour?: number): string {
  const base = `营业至 ${fmtHour(poi.closeHour)}`;
  if (arriveHour == null) return base;
  return arriveHour < poi.closeHour ? `${base} · 你到店时还开` : `${base} · 注意可能已打烊`;
}

export function formatLegMode(mode: 'walk' | 'transit'): string {
  return mode === 'walk' ? '步行' : '车程';
}

export function formatDistance(meters: number): string {
  if (meters <= 0) return '相邻';
  return meters < 1000 ? `${meters}m` : `${(meters / 1000).toFixed(1)}km`;
}

export function formatMoveMinutes(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} 分钟`;
}

export function travelSummary(route: Route): { label: string; value: string } {
  const walk = route.totalWalkMin;
  const ride = route.totalTransitMin;
  if (walk > 0 && ride > 0) return { label: '移动', value: `步行 ${walk}min · 车程 ${ride}min` };
  if (walk > 0) return { label: '步行', value: `${walk} min` };
  if (ride > 0) return { label: '车程', value: `${ride} min` };
  return { label: '移动', value: '少步行' };
}
