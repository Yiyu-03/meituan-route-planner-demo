import type {
  AgentStageKey, AgentTraceStep, Persona, PlanResult, Route, StageKey,
} from '../../types';
import { PERSONA_MAP } from '../../data/personas';
import { parseIntent, finalizeConstraints } from './parseIntent';
import { inferPersona } from './inferPersona';
import { detectConflict } from './detectConflict';
import { retrieveCandidates } from '../retrieveCandidates';
import { scorePOIs } from '../scorePOIs';
import { buildRouteCandidates } from '../buildRouteCandidates';
import { validateRoute, violationsFromChecks } from '../validateRoute';
import { rankRoutes } from '../rankRoutes';
import { explainRoute } from '../explainRoute';
import { repairIfNeeded } from './repairRoute';

export type AgentStageCallback = (stage: AgentStageKey, payload: unknown) => void;

const LABELS: Record<AgentStageKey, string> = {
  parseIntent: '意图抽取',
  inferPersona: '画像推断',
  detectConflict: '冲突检测',
  retrieveCandidates: '候选召回',
  scorePOIs: '个性化评分',
  planRoute: '路线组合',
  validateConstraints: '约束校验',
  repairIfNeeded: '自动修复',
  explainRoute: '解释生成',
};

function summarizePayload(payload: unknown): string {
  if (Array.isArray(payload)) return `${payload.length} 条`;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.message === 'string') return p.message;
    if (typeof p.note === 'string') return p.note;
    if (Array.isArray(p.matched) && typeof p.raw === 'string') {
      const hits = p.matched.slice(0, 6).join(' / ');
      return hits ? `命中约束:${hits}` : '未命中显式约束,使用默认出行参数';
    }
    if (typeof p.personaId === 'string' && typeof p.confidence === 'number') {
      return `${PERSONA_MAP[p.personaId]?.label ?? p.personaId} · ${Math.round(p.confidence * 100)}%`;
    }
    if ('routes' in p && Array.isArray(p.routes)) return `${p.routes.length} 条路线候选`;
    if ('candidates' in p && Array.isArray(p.candidates)) return `${p.candidates.length} 个 POI`;
  }
  return String(payload ?? '');
}

export function runAgentLoop(
  raw: string,
  manualPersona?: Persona,
  onStage?: AgentStageCallback,
): PlanResult {
  const trace: AgentTraceStep[] = [];
  const oldTimings = {
    parse: 0, retrieve: 0, score: 0, build: 0, validate: 0, rank: 0, explain: 0,
  } as Record<StageKey, number>;

  const step = <T>(
    key: AgentStageKey,
    input: string,
    fn: () => T,
    status: AgentTraceStep['status'] = 'ok',
  ): T => {
    const t0 = performance.now();
    const result = fn();
    const ms = +(performance.now() - t0).toFixed(2);
    trace.push({ key, label: LABELS[key], input, output: summarizePayload(result), ms, status });
    onStage?.(key, result);
    return result;
  };

  const intent = step('parseIntent', raw, () => parseIntent(raw));
  oldTimings.parse = trace[trace.length - 1]?.ms ?? 0;

  const personaInference = step('inferPersona', intent.matched.join(' / ') || raw, () => inferPersona(intent));
  const conflict = step('detectConflict', manualPersona?.label ?? '未手动指定', () =>
    detectConflict(personaInference, manualPersona?.id),
  );
  const persona = PERSONA_MAP[conflict.resolvedPersonaId] ?? manualPersona ?? PERSONA_MAP.solo;
  const constraints = finalizeConstraints(intent, persona);

  const retrieved = step('retrieveCandidates', constraints.city, () => retrieveCandidates(constraints));
  oldTimings.retrieve = trace[trace.length - 1]?.ms ?? 0;

  const candidates = step('scorePOIs', `${retrieved.candidates.length} 个候选`, () =>
    scorePOIs(retrieved.candidates, constraints, persona, retrieved.centerLat, retrieved.centerLng),
  );
  oldTimings.score = trace[trace.length - 1]?.ms ?? 0;

  const built = step('planRoute', 'topK候选 + slot模板 + beam search', () =>
    buildRouteCandidates(candidates, constraints, persona),
  );
  oldTimings.build = trace[trace.length - 1]?.ms ?? 0;

  const validated = step('validateConstraints', `${built.routes.length} 条路线`, () =>
    built.routes.map((r) => {
      const checks = validateRoute(r, constraints, persona);
      return { ...r, checks, violations: violationsFromChecks(r, checks) };
    }),
  );
  oldTimings.validate = trace[trace.length - 1]?.ms ?? 0;

  const ranked = rankRoutes(validated, constraints, persona);
  oldTimings.rank = 0;

  const repairResult = step('repairIfNeeded', ranked[0]?.checks.map((c) => `${c.key}:${c.status}`).join(',') ?? '无路线', () => {
    if (!ranked[0]) return { routes: ranked, repairLog: [] };
    const repaired = repairIfNeeded(ranked[0], constraints, persona, candidates);
    const candidatesAfterRepair: Route[] = [repaired.route, ...ranked.slice(1)];
    const fallbackIdx = candidatesAfterRepair.findIndex((route) => !route.checks.some((check) => check.status === 'fail'));
    const routes = (fallbackIdx > 0
      ? [candidatesAfterRepair[fallbackIdx], ...candidatesAfterRepair.filter((_, idx) => idx !== fallbackIdx)]
      : candidatesAfterRepair
    ).map((r, idx) => ({ ...r, id: `route-${idx}` }));
    return { routes, repairLog: repaired.logs };
  }, ranked[0]?.checks.some((c) => c.status === 'fail') ? 'ok' : 'skip');

  const explained = step('explainRoute', `${repairResult.routes.length} 条排序路线`, () =>
    repairResult.routes.map((r) => {
      const { explanation, risks } = explainRoute(r, constraints, persona);
      return { ...r, explanation, risks };
    }),
  );
  oldTimings.explain = trace[trace.length - 1]?.ms ?? 0;

  return {
    constraints,
    candidates,
    routes: explained,
    personaId: persona.id,
    resolvedPersonaId: persona.id,
    stageTimings: oldTimings,
    intent,
    personaInference,
    conflict,
    agentTrace: trace,
    repairLog: repairResult.repairLog,
    slotPlan: built.slots,
    retrieveNote: retrieved.note,
  };
}
