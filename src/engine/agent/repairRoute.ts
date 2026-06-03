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

function routeCost(picks: ScoredPOI[]): number {
  return Math.round(picks.reduce((sum, pick) => sum + pick.poi.perCapita, 0));
}

function mealRequested(c: Constraints): boolean {
  return /吃饭|午饭|午餐|晚饭|晚餐|正餐|美食/.test(c.raw) || c.mustCategories.includes('dining');
}

function downgradeCategories(cat: string, c: Constraints): string[] {
  if (cat === 'dining') return mealRequested(c) ? [] : ['cafe'];
  if (cat === 'nightscape') return ['entertainment', 'cafe', 'culture', 'shopping'];
  if (cat === 'entertainment') return ['cafe', 'culture', 'shopping'];
  if (cat === 'shopping') return ['dining', 'cafe', 'culture'];
  if (cat === 'cafe') return ['culture'];
  return [];
}

function canDropStop(picks: ScoredPOI[], idx: number, c: Constraints): boolean {
  const stop = picks[idx];
  const minStops = c.pace === 'relaxed' && c.durationMin <= 180 ? 2 : 3;
  if (picks.length <= minStops) return false;
  if (stop.poi.category === 'dining' && mealRequested(c)) return false;
  const remaining = picks.filter((_, i) => i !== idx);
  for (const cat of c.mustCategories) {
    if (!remaining.some((pick) => pick.poi.category === cat)) return false;
  }
  return true;
}

function cheapestRouteCost(picks: ScoredPOI[], allScored: ScoredPOI[], c: Constraints): number {
  let estimate = routeCost(picks);
  for (const pick of picks) {
    const sameCat = allScored
      .filter((item) => item.poi.category === pick.poi.category && item.poi.id !== pick.poi.id)
      .sort((a, b) => a.poi.perCapita - b.poi.perCapita)[0];
    if (sameCat && sameCat.poi.perCapita < pick.poi.perCapita) {
      estimate -= pick.poi.perCapita - sameCat.poi.perCapita;
    }
  }
  let reduced = [...picks];
  while (reduced.some((_, idx) => canDropStop(reduced, idx, c))) {
    const drop = reduced
      .map((pick, idx) => ({ pick, idx }))
      .filter(({ idx }) => canDropStop(reduced, idx, c))
      .sort((a, b) => b.pick.poi.perCapita - a.pick.poi.perCapita)[0];
    if (!drop) break;
    reduced = reduced.filter((_, idx) => idx !== drop.idx);
  }
  estimate = Math.min(estimate, routeCost(reduced));
  return Math.round(estimate);
}

function openAtReplacementSlot(route: Route, idx: number, candidate: ScoredPOI): boolean {
  const arrive = route.stops[idx]?.arrive;
  if (arrive == null) return true;
  return arrive >= candidate.poi.openHour - 0.01
    && arrive + candidate.poi.avgDuration / 60 <= candidate.poi.closeHour + 0.01;
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
    const budgetIssue = constraints.budgetPerCapita != null && current.totalCost > constraints.budgetPerCapita
      ? current.checks.find((c) => c.key === 'budget')
      : undefined;
    const issue = budgetIssue ?? current.checks.find((c) => c.status === 'fail');
    if (!issue) break;

    const before = routeNames(current);
    let picks = current.stops.map((s) => s.scored);
    let action = '';

    if (issue.key === 'budget') {
      const sortedByPrice = picks
        .map((pick, idx) => ({ pick, idx }))
        .sort((a, b) => b.pick.poi.perCapita - a.pick.poi.perCapita);
      let patch:
        | { idx: number; old: ScoredPOI; repl?: ScoredPOI; mode: 'same' | 'downgrade' | 'drop' }
        | null = null;

      for (const { pick, idx } of sortedByPrice) {
        const repl = replacementPool(current, allScored, pick.poi.category)
          .filter((s) => s.poi.perCapita < pick.poi.perCapita && openAtReplacementSlot(current, idx, s))
          .sort((a, b) => a.poi.perCapita - b.poi.perCapita || b.score - a.score)[0];
        if (repl) {
          patch = { idx, old: pick, repl, mode: 'same' };
          break;
        }
      }

      if (!patch) {
        for (const { pick, idx } of sortedByPrice) {
          const used = new Set(picks.map((item) => item.poi.id));
          const downgradeOrder = downgradeCategories(pick.poi.category, constraints);
          const repl = allScored
            .filter((s) =>
              downgradeOrder.includes(s.poi.category)
              && !used.has(s.poi.id)
              && s.poi.perCapita < pick.poi.perCapita
              && openAtReplacementSlot(current, idx, s))
            .sort((a, b) =>
              downgradeOrder.indexOf(a.poi.category) - downgradeOrder.indexOf(b.poi.category)
              || a.poi.perCapita - b.poi.perCapita
              || b.score - a.score)[0];
          if (repl) {
            patch = { idx, old: pick, repl, mode: 'downgrade' };
            break;
          }
        }
      }

      if (!patch) {
        const drop = sortedByPrice.find(({ idx }) => canDropStop(picks, idx, constraints));
        if (drop) patch = { idx: drop.idx, old: drop.pick, mode: 'drop' };
      }

      if (!patch) {
        const floor = cheapestRouteCost(picks, allScored, constraints);
        logs.push({
          round,
          trigger: issue.label,
          action: `该区域内最低约 ¥${floor},建议提高预算或减少站点`,
          before,
          after: before,
          resolved: false,
        });
        break;
      }

      if (patch.mode === 'drop') {
        picks = picks.filter((_, idx) => idx !== patch!.idx);
        action = `预算超限,移除非必要站「${patch.old.poi.name}」`;
      } else if (patch.repl) {
        picks[patch.idx] = patch.repl;
        action = patch.mode === 'same'
          ? `预算超限,将${CATEGORY_LABEL[patch.old.poi.category]}「${patch.old.poi.name}」换成更低价「${patch.repl.poi.name}」`
          : `预算超限,将${CATEGORY_LABEL[patch.old.poi.category]}「${patch.old.poi.name}」降档为${CATEGORY_LABEL[patch.repl.poi.category]}「${patch.repl.poi.name}」`;
      }
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
