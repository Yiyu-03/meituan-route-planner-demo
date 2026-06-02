import type { Route, Constraints, Persona } from '../types';
import { checkSummary } from './validateRoute';

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

    const finalScore = +(r.score + checkScore + paceScore + compactScore).toFixed(1);
    return { ...r, score: finalScore };
  });

  scored.sort((a, b) => b.score - a.score);
  // 重新编号(route-0 永远是 top)
  return scored.map((r, i) => ({ ...r, id: `route-${i}` }));
}
