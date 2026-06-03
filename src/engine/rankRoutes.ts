import type { Route, Constraints, Persona } from '../types';
import { checkSummary } from './validateRoute';
import { AREA_MAP } from '../data/areas';
import { haversineM } from './geo';
import { anchorAreas } from './parseConstraints';
import { routeVerdict } from '../lib/display';
import {
  hasExplicitFamilyIntent,
  isAdultNightlifePOI,
  isQuietIntent,
  isStrongFamilyPOI,
  wantsAdultNightlife,
  wantsNightView,
} from './semanticGuards';

// ------------------------------------------------------------
// ⑥ rankRoutes
// 综合排序分 = POI 平均个性化分
//   + 校验加分(pass×3, warn×-4, fail×-15)
//   + pace 匹配(节奏与时长匹配度)
//   + 紧凑度(总移动时间越少越好)
// 返回排序后的路线;[0] = 推荐,其余 = 备选。
// ------------------------------------------------------------

export function rankRoutes(
  routes: Route[], c: Constraints, persona: Persona,
): Route[] {
  const anchors = anchorAreas(c);

  const scored = routes.map((r) => {
    const sum = checkSummary(r.checks);
    const checkScore = sum.pass * 3 - sum.warn * 4 - sum.fail * 15;

    // 节奏匹配:计算实际时长 vs 计划时长
    const actualMin = (r.endTime - c.startTime) * 60;
    const planMin = c.durationMin;
    const overrun = actualMin - planMin;
    let paceScore = 0;
    if (c.pace === 'relaxed') {
      // 不喜欢赶:超时轻罚,过度紧凑(明显短于计划)也轻罚
      paceScore = -Math.abs(overrun) * 0.05;
    } else if (c.pace === 'packed') {
      // 喜欢多逛:接近/略超计划给正分
      paceScore = overrun >= -30 ? 4 : -4;
    } else {
      paceScore = -Math.max(0, overrun - 30) * 0.05;
    }

    // 紧凑度:移动时间越少越好
    const moveMin = r.totalWalkMin + r.totalTransitMin;
    const compactScore = -moveMin * 0.06;

    // 预算是用户最容易一眼质疑的约束:总人均超预算时必须比单点打分更重要。
    let budgetScore = 0;
    if (c.budgetPerCapita != null && c.budgetPerCapita > 0) {
      const ratio = r.totalCost / c.budgetPerCapita;
      if (ratio <= 1) {
        budgetScore = 3;
      } else {
        budgetScore = -(ratio - 1) * 38 * (0.8 + persona.budgetSensitivity);
      }
    }

    let anchorScore = 0;
    if (anchors.length) {
      const anchorSet = new Set(anchors);
      anchorScore += r.stops.some((stop) => anchorSet.has(stop.scored.poi.area)) ? 5 : -8;
      const avgDistance = r.stops.reduce((sum, stop) => {
        const nearest = Math.min(
          ...anchors.map((key) => haversineM(
            AREA_MAP[key].lat,
            AREA_MAP[key].lng,
            stop.scored.poi.lat,
            stop.scored.poi.lng,
          )),
        );
        return sum + nearest;
      }, 0) / Math.max(1, r.stops.length);
      anchorScore += avgDistance <= 1800 ? 2 : -Math.min(18, (avgDistance - 1800) / 250);
    }

    const semanticScore = semanticRouteScore(r, c, persona);
    const verdictPenalty = routeVerdict(r, c).status === 'blocked' ? -10000 : 0;

    const finalScore = +(r.score + checkScore + paceScore + compactScore + budgetScore + anchorScore + semanticScore + verdictPenalty).toFixed(1);
    return { ...r, score: finalScore };
  });

  scored.sort((a, b) => b.score - a.score);
  // 重新编号(route-0 永远是 top)
  return scored.map((r, i) => ({ ...r, id: `route-${i}` }));
}

function semanticRouteScore(route: Route, c: Constraints, persona: Persona): number {
  let score = 0;
  const explicitFamily = hasExplicitFamilyIntent(c);
  const adultNightWanted = wantsAdultNightlife(c);
  const quietMode = isQuietIntent(c);
  const nightViewWanted = wantsNightView(c);

  for (const stop of route.stops) {
    const poi = stop.scored.poi;
    if ((explicitFamily || persona.id === 'family') && isAdultNightlifePOI(poi) && !adultNightWanted) score -= 30;
    if (!explicitFamily && isStrongFamilyPOI(poi)) score -= persona.id === 'family' ? 10 : 22;
    if (persona.id === 'solo' && isAdultNightlifePOI(poi) && !adultNightWanted && !nightViewWanted) score -= 16;
    if (quietMode && isAdultNightlifePOI(poi) && !adultNightWanted) score -= nightViewWanted ? 8 : 20;
    if (quietMode && poi.category === 'entertainment' && !c.mustCategories.includes('entertainment')) score -= 8;
  }

  return score;
}
