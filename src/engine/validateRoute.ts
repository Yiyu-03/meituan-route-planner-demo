import type { Route, Constraints, Persona, Check, Violation } from '../types';
import { CATEGORY_LABEL } from '../types';

// ------------------------------------------------------------
// ⑤ validateRoute —— 7 项约束校验
// 每项产出 pass / warn / fail + 可读 detail,直接喂给前端校验面板。
// ------------------------------------------------------------

function fmtH(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const MAX_LEG_DISTANCE_M = 12000;
const MAX_LEG_MINUTES = 45;
const MAX_WALK_MINUTES = 25;

export function validateRoute(
  route: Route, c: Constraints, persona: Persona,
): Check[] {
  const checks: Check[] = [];

  // 1) 营业时间:每站到达/离开是否在营业区间内
  let openFail = 0; let openWarn = 0;
  const openDetails: string[] = [];
  for (const s of route.stops) {
    const { openHour, closeHour, name } = s.scored.poi;
    if (s.arrive < openHour - 0.01) {
      openFail++; openDetails.push(`${name} 未开门(${fmtH(openHour)} 营业)`);
    } else if (s.depart > closeHour + 0.01) {
      // 离开晚于打烊
      if (s.arrive < closeHour) { openWarn++; openDetails.push(`${name} 游玩跨越打烊(${fmtH(closeHour)})`); }
      else { openFail++; openDetails.push(`${name} 已打烊(${fmtH(closeHour)})`); }
    }
  }
  checks.push({
    key: 'open',
    label: '营业时间',
    status: openFail ? 'fail' : openWarn ? 'warn' : 'pass',
    detail: openFail || openWarn ? openDetails.join(';') : '全程均在营业时间内',
  });

  // 2) 预算:人均合计 vs 预算
  if (c.budgetPerCapita != null) {
    const ratio = route.totalCost / c.budgetPerCapita;
    let status: Check['status'] = 'pass';
    if (ratio > 1.15) status = 'fail';
    else if (ratio > 1.0) status = 'warn';
    checks.push({
      key: 'budget',
      label: '预算',
      status,
      detail: `人均合计 ¥${route.totalCost} / 预算 ¥${c.budgetPerCapita}(${Math.round(ratio * 100)}%)`,
    });
  } else {
    checks.push({
      key: 'budget', label: '预算', status: 'pass',
      detail: `未设预算 · 人均合计 ¥${route.totalCost}`,
    });
  }

  // 3) 交通时间:总交通(地铁/打车)占比
  const transitRatio = route.totalTransitMin / Math.max(1, route.totalWalkMin + route.totalTransitMin);
  const mobilityProblems = route.stops
    .filter((s) => {
      const leg = s.legFromPrev;
      if (!leg) return false;
      if (leg.distM > MAX_LEG_DISTANCE_M) return true;
      if (leg.minutes > MAX_LEG_MINUTES) return true;
      if (leg.mode === 'walk' && leg.minutes > MAX_WALK_MINUTES) return true;
      return false;
    })
    .map((s) => {
      const leg = s.legFromPrev!;
      return `${s.scored.poi.name} 前一段 ${leg.minutes} 分钟/${(leg.distM / 1000).toFixed(1)}km`;
    });
  const totalMove = route.totalWalkMin + route.totalTransitMin;
  const durMin = Math.max(1, c.durationMin);
  checks.push({
    key: 'mobility',
    label: '移动距离',
    status: mobilityProblems.length ? 'fail' : totalMove > Math.min(90, durMin * 0.35) ? 'warn' : 'pass',
    detail: mobilityProblems.length
      ? `移动过长:${mobilityProblems.join(';')}`
      : `单段移动可控,总移动约 ${totalMove} 分钟`,
  });
  checks.push({
    key: 'transit',
    label: '交通时间',
    status: route.totalTransitMin > Math.min(70, durMin * 0.3) ? 'warn' : 'pass',
    detail: `地铁/打车约 ${route.totalTransitMin} 分钟,步行 ${route.totalWalkMin} 分钟`,
  });

  // 4) 步行距离:总步行分钟 vs 画像耐受
  const walkBudget = persona.walkTolerance * route.stops.length;
  checks.push({
    key: 'walk',
    label: '步行距离',
    status: route.totalWalkMin > walkBudget ? 'warn' : 'pass',
    detail: `累计步行约 ${route.totalWalkMin} 分钟(${persona.label}耐受约 ${walkBudget} 分钟)`,
  });

  // 5) 排队风险:高排队 POI 数量
  const queues = route.stops.filter((s) => s.scored.poi.queueBase >= 0.65);
  checks.push({
    key: 'queue',
    label: '排队风险',
    status: queues.length >= 2 ? 'warn' : 'pass',
    detail: queues.length
      ? `${queues.map((q) => q.scored.poi.name).join('、')} 排队压力较高,建议错峰`
      : '各站排队压力可控',
  });

  // 6) 类目覆盖:是否覆盖必去类目 + 是否 ≥3 类
  const cov = new Set(route.coverage);
  const missMust = c.mustCategories.filter((m) => !cov.has(m));
  checks.push({
    key: 'coverage',
    label: '类目覆盖',
    status: missMust.length ? 'warn' : cov.size >= 3 ? 'pass' : 'warn',
    detail: missMust.length
      ? `缺少你要求的类目:${missMust.map((m) => CATEGORY_LABEL[m]).join('、')}`
      : `覆盖 ${[...cov].map((x) => CATEGORY_LABEL[x]).join('、')}`,
  });

  // 7) POI 数量
  const minStops = c.pace === 'relaxed' && c.durationMin <= 240 ? 2 : 3;
  checks.push({
    key: 'count',
    label: 'POI 数量',
    status: route.stops.length >= minStops ? 'pass' : 'fail',
    detail: `${route.stops.length} 个 POI${route.stops.length >= minStops ? `(满足 ≥${minStops})` : `(不足 ${minStops} 个)`}`,
  });

  // 额外:结束时间是否超过画像期望
  const plannedEnd = c.startTime + c.durationMin / 60;
  if (route.endTime > plannedEnd + 0.5) {
    checks.push({
      key: 'schedule',
      label: '时间窗口',
      status: 'fail',
      detail: `预计 ${fmtH(route.endTime)} 结束,明显超出本次 ${fmtH(plannedEnd)} 左右的时间窗口`,
    });
  } else if (route.endTime > plannedEnd + 0.01) {
    checks.push({
      key: 'schedule',
      label: '时间窗口',
      status: 'warn',
      detail: `预计 ${fmtH(route.endTime)} 结束,略超出本次 ${fmtH(plannedEnd)} 左右的时间窗口`,
    });
  }

  if (route.endTime > persona.latestEnd + 0.01) {
    checks.push({
      key: 'endtime',
      label: '结束时间',
      status: 'warn',
      detail: `预计 ${fmtH(route.endTime)} 结束,晚于「${persona.label}」期望的 ${fmtH(persona.latestEnd)}`,
    });
  }

  return checks;
}

/** 校验汇总:用于排序加减分 */
export function checkSummary(checks: Check[]): { pass: number; warn: number; fail: number } {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };
}

export function violationsFromChecks(route: Route, checks: Check[]): Violation[] {
  return checks
    .filter((c) => c.status === 'warn' || c.status === 'fail')
    .map((c) => {
      let poiId: string | undefined;
      if (c.key === 'open') {
        const hit = route.stops.find((s) => c.detail.includes(s.scored.poi.name));
        poiId = hit?.scored.poi.id;
      }
      return {
        checkKey: c.key,
        severity: c.status as 'warn' | 'fail',
        poiId,
        detail: c.detail,
      };
    });
}
