import type { Constraints, Persona, PlanResult, StageKey, Route } from '../types';
import { runAgentLoop } from './agent/agentLoop';
import { validateRoute } from './validateRoute';
import { explainRoute } from './explainRoute';

// ------------------------------------------------------------
// pipeline:编排
// parse → retrieve → score → build → validate → rank → explain
// 每段后回调 onStage,前端据此点亮进度条(分阶段输出体验)。
// 全程纯计算,无网络,天然 <10s(实测 < 50ms)。
// ------------------------------------------------------------

export type StageCallback = (stage: StageKey, payload: unknown) => void;

export function runPipeline(
  raw: string,
  persona: Persona,
  onStage?: StageCallback,
): PlanResult {
  const agentToLegacy: Record<string, StageKey> = {
    parseIntent: 'parse',
    retrieveCandidates: 'retrieve',
    scorePOIs: 'score',
    planRoute: 'build',
    validateConstraints: 'validate',
    explainRoute: 'explain',
  };
  return runAgentLoop(raw, persona, (stage, payload) => {
    const legacy = agentToLegacy[stage];
    if (legacy) onStage?.(legacy, payload);
  });
}

/** 重新校验+解释一条被局部改过的路线(供 replan 复用) */
export function revalidateRoute(
  route: Route, constraints: Constraints, persona: Persona,
): Route {
  const checks = validateRoute(route, constraints, persona);
  const withChecks = { ...route, checks };
  const { explanation, risks } = explainRoute(withChecks, constraints, persona);
  return { ...withChecks, explanation, risks };
}
