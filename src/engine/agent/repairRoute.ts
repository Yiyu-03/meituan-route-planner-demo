import type { Constraints, Persona, RepairLog, Route, ScoredPOI } from '../../types';
import { CATEGORY_LABEL } from '../../types';
import { materializeRoute } from '../buildRouteCandidates';
import { validateRoute, violationsFromChecks } from '../validateRoute';
import { explainRoute } from '../explainRoute';

function rebuild(picks: ScoredPOI[], c: Constraints, persona: Persona, seq: number): Route {
  const route = materializeRoute(picks, c, persona, seq);
  const checks = validateRoute(route, c, persona);
  const withChecks = { ...route, checks, violations: violationsFromChecks(route, checks) };
  const { explanation, risks } = explainRoute(withChecks, c, persona);
  return { ...withChecks, explanation, risks };
}

function routeNames(route: Route): string {
  return route.stops.map((s) => s.scored.poi.name).join(' → ');
}

function replacementPool(route: Route, allScored: ScoredPOI[], cat: string) {
  const used = new Set(route.stops.map((s) => s.scored.poi.id));
  return allScored.filter((s) => s.poi.category === cat && !used.has(s.poi.id));
}

export function repairIfNeeded(
  route: Route,
  constraints: Constraints,
  persona: Persona,
  allScored: ScoredPOI[],
): { route: Route; logs: RepairLog[] } {
  let current = route;
  const logs: RepairLog[] = [];
  const maxRounds = Math.max(
    persona.replanProfile?.maxRepairRounds ?? 2,
    constraints.budgetPerCapita != null ? 5 : 2,
  );

  for (let round = 1; round <= maxRounds; round++) {
    const issue = current.checks.find((c) => c.status === 'fail');
    if (!issue) break;

    const before = routeNames(current);
    let picks = current.stops.map((s) => s.scored);
    let action = '';

    if (issue.key === 'budget') {
      const victimIdx = picks.reduce((maxIdx, p, i, arr) =>
        p.poi.perCapita > arr[maxIdx].poi.perCapita ? i : maxIdx, 0);
      const old = picks[victimIdx];
      const repl = replacementPool(current, allScored, old.poi.category)
        .filter((s) => s.poi.perCapita < old.poi.perCapita)
        .sort((a, b) => a.poi.perCapita - b.poi.perCapita || b.score - a.score)[0];
      if (!repl) {
        logs.push({ round, trigger: issue.label, action: '未找到更低价同类候选', before, after: before, resolved: false });
        break;
      }
      picks[victimIdx] = repl;
      action = `预算超限,将${CATEGORY_LABEL[old.poi.category]}「${old.poi.name}」换成更低价「${repl.poi.name}」`;
    } else if (issue.key === 'open') {
      const victim = current.stops.find((s) => issue.detail.includes(s.scored.poi.name));
      if (!victim) break;
      const idx = current.stops.findIndex((s) => s.scored.poi.id === victim.scored.poi.id);
      const arrive = victim.arrive;
      const repl = replacementPool(current, allScored, victim.scored.poi.category)
        .filter((s) => arrive >= s.poi.openHour && arrive + s.poi.avgDuration / 60 <= s.poi.closeHour)
        .sort((a, b) => b.score - a.score)[0];
      if (!repl) {
        logs.push({ round, trigger: issue.label, action: '未找到营业时间匹配的同类候选', before, after: before, resolved: false });
        break;
      }
      picks[idx] = repl;
      action = `营业时间冲突,将「${victim.scored.poi.name}」替换为同类且可营业的「${repl.poi.name}」`;
    } else if (issue.key === 'count') {
      const used = new Set(picks.map((s) => s.poi.id));
      const add = allScored.find((s) => !used.has(s.poi.id));
      if (!add) break;
      picks.push(add);
      action = `POI 数不足,补入高分候选「${add.poi.name}」`;
    } else {
      logs.push({ round, trigger: issue.label, action: '当前自动修复策略保留路线,交给用户局部调整', before, after: before, resolved: false });
      break;
    }

    current = rebuild(picks, constraints, persona, round);
    const after = routeNames(current);
    const resolved = !current.checks.some((c) => c.key === issue.key && c.status !== 'pass');
    logs.push({ round, trigger: issue.label, action, before, after, resolved });
  }

  return { route: current, logs };
}
