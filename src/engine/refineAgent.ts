import type {
  Category,
  Constraints,
  Persona,
  RefineAgentSummary,
  RefineIntentJSON,
  RefineIntentSlots,
  RefinePrimaryIntent,
  Route,
  ScoredPOI,
  SceneTag,
} from '../types';
import { applyRefine } from './replan';
import { distBetween } from './geo';
import { materializeRoute } from './buildRouteCandidates';
import { revalidateRoute } from './pipeline';
import { repairIfNeeded } from './agent/repairRoute';

interface IntentRule {
  intent: RefinePrimaryIntent;
  patterns: RegExp[];
  confidence: number;
  reason: string;
  slotHints?: (raw: string) => RefineIntentSlots;
}

interface RefineAgentInput {
  rawInput: string;
  currentRoute: Route;
  constraints: Constraints;
  persona: Persona;
  candidates: ScoredPOI[];
  originalRequest?: string;
  useLLM?: boolean;
}

export interface RefineAgentResult {
  route: Route;
  constraints: Constraints;
  changed: string[];
  intent: RefineIntentJSON;
  message: string;
  tool: string;
  executed: boolean;
  repairApplied: boolean;
  fallbackUsed: boolean;
  elapsedMs: number;
  summary: RefineAgentSummary;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'lowerBudget',
    patterns: [/预算.*(?:降到|改成|控制在|不超过)\s*\d{2,4}/, /(?:降到|控制在|不超过)\s*\d{2,4}/, /便宜一点|便宜点|省钱|低预算|更便宜|实惠/],
    confidence: 0.9,
    reason: '用户在调整预算或要求更便宜，属于预算压降',
    slotHints: (raw) => ({ budget: extractBudget(raw) }),
  },
  {
    intent: 'changeArea',
    patterns: [/就在.+附近/, /围绕.+附近/, /.+附近就好/, /换到.+附近/, /改到.+附近/, /金鸡湖|西湖附近|大学路|外滩附近|静安寺附近|园区附近/],
    confidence: 0.86,
    reason: '用户指定了更明确的区域锚点，需要重新约束路线半径',
    slotHints: (raw) => ({ area: extractArea(raw) }),
  },
  {
    intent: 'reduceTravel',
    patterns: [/车程太久|车程太长|路程太久|路程太长|太远|离太远|不想坐太久车|少打车|少坐车|近一点|近点|距离短|少跑/],
    confidence: 0.92,
    reason: '用户要求减少车程/距离，属于压缩移动时间',
  },
  {
    intent: 'addFoodOrDrink',
    patterns: [/想喝奶茶|加.*奶茶|奶茶/, /想喝咖啡|加.*咖啡|咖啡/, /想喝茶|茶饮|甜品|下午茶|喝点/],
    confidence: 0.9,
    reason: '用户想加入饮品或休息点，需要搜索附近茶饮/咖啡候选',
    slotHints: (raw) => ({ category: extractDrinkCategory(raw) }),
  },
  {
    intent: 'replaceFood',
    patterns: [/换家更好吃|换.*餐厅|换.*吃|餐厅.*换|饭店.*换|正餐.*换/],
    confidence: 0.88,
    reason: '用户想替换正餐节点',
    slotHints: () => ({ category: '餐饮' }),
  },
  {
    intent: 'addStop',
    patterns: [/多逛几个地方|多逛|多玩|再加点|多安排|再来一个地方|加一个地方|不够逛/],
    confidence: 0.86,
    reason: '用户想增加站点，需要在剩余时间内补一个近距离 POI',
  },
  {
    intent: 'makeQuiet',
    patterns: [/安静一点|安静点|清净一点|别太吵|不要太吵|适合聊天|能休息/],
    confidence: 0.86,
    reason: '用户想降低噪声和拥挤感，需要偏向安静休息点',
    slotHints: () => ({ tone: '安静' }),
  },
  {
    intent: 'makePhotoFriendly',
    patterns: [/拍照|出片|打卡|好看一点|更好拍/],
    confidence: 0.82,
    reason: '用户想提高拍照/打卡属性',
    slotHints: () => ({ tone: '拍照友好' }),
  },
];

const LLM_TIMEOUT_MS = 1800;
const MAX_AGENT_MS = 9500;
const MAX_LEG_MINUTES = 45;
const MAX_LEG_DISTANCE_M = 12000;
const MAX_WALK_MINUTES = 25;

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function extractBudget(raw: string): number | undefined {
  const match = raw.match(/(\d{2,4})/);
  return match ? Number(match[1]) : undefined;
}

function extractArea(raw: string): string | undefined {
  const explicit = raw.match(/(?:就在|围绕|换到|改到)?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?:附近|周边|一带|区域)/);
  if (explicit?.[1]) return explicit[1].replace(/^在/, '');
  const known = ['金鸡湖', '苏州园区', '工业园区', '西湖', '大学路', '外滩', '静安寺'];
  return known.find((area) => raw.includes(area));
}

function extractDrinkCategory(raw: string): string {
  if (/奶茶|茶饮|喝茶/.test(raw)) return '奶茶/茶饮';
  if (/甜品|下午茶/.test(raw)) return '甜品/下午茶';
  if (/咖啡/.test(raw)) return '咖啡';
  return '咖啡/茶饮';
}

function targetStopLabel(raw: string): string | undefined {
  return raw.match(/第[一二三四五六123456]站/)?.[0];
}

function normalizeIntent(candidate: Partial<RefineIntentJSON> | null, source: RefineIntentJSON['source']): RefineIntentJSON | null {
  if (!candidate || !candidate.primaryIntent) return null;
  const allowed: RefinePrimaryIntent[] = [
    'reduceTravel', 'addStop', 'addFoodOrDrink', 'replaceFood', 'lowerBudget',
    'makeQuiet', 'makePhotoFriendly', 'changeArea', 'unknown',
  ];
  if (!allowed.includes(candidate.primaryIntent)) return null;
  return {
    primaryIntent: candidate.primaryIntent,
    secondaryIntents: (candidate.secondaryIntents ?? []).filter((item): item is RefinePrimaryIntent => allowed.includes(item)),
    slots: candidate.slots ?? {},
    confidence: clampConfidence(candidate.confidence),
    reason: candidate.reason || '已解析为路线修改需求',
    source,
  };
}

export function parseLocalRefineIntent(rawText: string): RefineIntentJSON {
  const raw = rawText.trim();
  const hits = INTENT_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(raw)));
  const primary = hits[0];
  if (!primary) {
    return {
      primaryIntent: 'unknown',
      secondaryIntents: [],
      slots: { targetStop: targetStopLabel(raw) },
      confidence: 0.32,
      reason: '本地解析没有足够把握，需要更明确地说明要改预算、距离、餐饮、区域或节奏',
      source: 'local',
    };
  }
  const slots = {
    targetStop: targetStopLabel(raw),
    ...(primary.slotHints?.(raw) ?? {}),
  };
  return {
    primaryIntent: primary.intent,
    secondaryIntents: hits.slice(1).map((rule) => rule.intent),
    slots,
    confidence: primary.confidence,
    reason: primary.reason,
    source: 'local',
  };
}

async function resolveIntentWithLLM(input: RefineAgentInput): Promise<RefineIntentJSON | null> {
  if (input.useLLM === false || !('document' in globalThis) || typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch('/api/agent/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        originalRequest: input.originalRequest ?? input.constraints.raw,
        refineText: input.rawInput,
        route: input.currentRoute.stops.map((stop, idx) => ({
          index: idx + 1,
          name: stop.scored.poi.name,
          category: stop.scored.poi.category,
          area: stop.scored.poi.area,
        })),
      }),
    });
    const data = await response.json() as { status?: string; intent?: Partial<RefineIntentJSON> };
    if (data?.status !== 'ok') return null;
    const intent = normalizeIntent(data.intent ?? null, 'llm');
    if (!intent || intent.confidence < 0.55) return null;
    return intent;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function resolveRefineIntent(input: RefineAgentInput): Promise<RefineIntentJSON> {
  const llm = await resolveIntentWithLLM(input);
  if (llm) return llm;
  const local = parseLocalRefineIntent(input.rawInput);
  return { ...local, source: input.useLLM === false ? 'local' : 'fallback' };
}

function routeValidationStatus(route: Route): 'pass' | 'warn' | 'fail' {
  if (route.checks.some((check) => check.status === 'fail')) return 'fail';
  if (route.checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

function hardMovementOk(route: Route): boolean {
  return route.stops.every((stop) => {
    const leg = stop.legFromPrev;
    if (!leg) return true;
    if (leg.minutes > MAX_LEG_MINUTES) return false;
    if (leg.distM > MAX_LEG_DISTANCE_M) return false;
    if (leg.mode === 'walk' && leg.minutes > MAX_WALK_MINUTES) return false;
    return true;
  }) && route.totalWalkMin + route.totalTransitMin < 100;
}

function minStops(c: Constraints): number {
  return c.pace === 'relaxed' && c.durationMin <= 240 ? 2 : 3;
}

function mealRequested(c: Constraints): boolean {
  return /吃饭|午饭|午餐|晚饭|晚餐|正餐|美食/.test(c.raw) || c.mustCategories.includes('dining');
}

function canDrop(picks: ScoredPOI[], idx: number, c: Constraints): boolean {
  if (picks.length <= minStops(c)) return false;
  const stop = picks[idx];
  if (stop.poi.category === 'dining' && mealRequested(c)) return false;
  const remaining = picks.filter((_, i) => i !== idx);
  for (const cat of c.mustCategories) {
    if (!remaining.some((pick) => pick.poi.category === cat)) return false;
  }
  return true;
}

function rebuild(picks: ScoredPOI[], c: Constraints, persona: Persona, seq = 0): Route {
  return revalidateRoute(materializeRoute(picks, c, persona, seq), c, persona);
}

function routeEndLimit(c: Constraints): number {
  return c.startTime + c.durationMin / 60 + 0.25;
}

function safeCandidateRoute(picks: ScoredPOI[], c: Constraints, persona: Persona, seq = 0): Route | null {
  const route = rebuild(picks, c, persona, seq);
  if (route.endTime > routeEndLimit(c)) return null;
  if (!hardMovementOk(route)) return null;
  if (route.checks.some((check) => check.status === 'fail')) return null;
  return route;
}

function nearestToRouteM(candidate: ScoredPOI, route: Route): number {
  return Math.min(...route.stops.map((stop) => distBetween(stop.scored.poi, candidate.poi)));
}

function drinkKeywordMatch(candidate: ScoredPOI, category?: string): boolean {
  const text = `${candidate.poi.name} ${candidate.poi.ugc}`;
  if (!category) return true;
  if (/奶茶|茶饮/.test(category)) return /奶茶|茶饮|茶|饮品|轻食|咖啡/.test(text);
  if (/甜品|下午茶/.test(category)) return /甜品|下午茶|茶|咖啡|轻食/.test(text);
  if (/咖啡/.test(category)) return /咖啡|轻食|茶/.test(text);
  return true;
}

function addNearbyStop(
  route: Route,
  c: Constraints,
  persona: Persona,
  candidates: ScoredPOI[],
  filter: (candidate: ScoredPOI) => boolean,
): { route: Route; changed: string[]; executed: boolean; message: string } {
  const used = new Set(route.stops.map((stop) => stop.scored.poi.id));
  if (route.stops.length >= 5) {
    return { route, changed: [], executed: false, message: '当前站点已经偏多，先不继续加站，避免把路线排满。' };
  }
  const pool = candidates
    .filter((candidate) => !used.has(candidate.poi.id) && filter(candidate))
    .sort((a, b) =>
      nearestToRouteM(a, route) - nearestToRouteM(b, route)
      || b.score - a.score);

  for (const candidate of pool.slice(0, 12)) {
    const next = safeCandidateRoute([...route.stops.map((stop) => stop.scored), candidate], c, persona, 0);
    if (next) {
      return {
        route: next,
        changed: [candidate.poi.id],
        executed: true,
        message: `已加入近距离休息/游览点「${candidate.poi.name}」。`,
      };
    }
  }
  return { route, changed: [], executed: false, message: '已尝试搜索附近候选，但当前时间窗口或移动距离不适合再增加站点。' };
}

function replaceWithQuiet(
  route: Route,
  c: Constraints,
  persona: Persona,
  candidates: ScoredPOI[],
): { route: Route; changed: string[]; executed: boolean; message: string; constraints: Constraints } {
  const cons: Constraints = {
    ...c,
    prefs: [...new Set([...c.prefs, 'quiet' as SceneTag])],
    avoid: [...new Set([...c.avoid, 'nightlife' as SceneTag, 'lively' as SceneTag])],
  };
  const picks = route.stops.map((stop) => stop.scored);
  const used = new Set(picks.map((pick) => pick.poi.id));
  const targetIdx = picks.findIndex((pick) =>
    !pick.poi.sceneTags.includes('quiet')
    && pick.poi.category !== 'dining'
    && (pick.poi.category === 'entertainment' || pick.poi.category === 'nightscape' || pick.poi.category === 'shopping'));
  if (targetIdx >= 0) {
    const target = picks[targetIdx];
    const replacement = candidates
      .filter((candidate) =>
        !used.has(candidate.poi.id)
        && candidate.poi.sceneTags.includes('quiet')
        && candidate.poi.category !== 'nightscape'
        && nearestToRouteM(candidate, route) <= 2500)
      .sort((a, b) => b.score - a.score)[0];
    if (replacement) {
      const nextPicks = [...picks];
      nextPicks[targetIdx] = replacement;
      const next = safeCandidateRoute(nextPicks, cons, persona, 0);
      if (next) {
        return {
          route: next,
          changed: [replacement.poi.id],
          executed: true,
          constraints: cons,
          message: `已将偏吵的「${target.poi.name}」换成更安静的「${replacement.poi.name}」。`,
        };
      }
    }
  }
  const add = addNearbyStop(route, cons, persona, candidates, (candidate) =>
    candidate.poi.category === 'cafe' && candidate.poi.sceneTags.includes('quiet'));
  return {
    ...add,
    constraints: cons,
    message: add.executed ? add.message : '已理解为安静一点；当前路线本身较轻，暂未找到更安全的安静替换点。',
  };
}

function areaMatch(candidate: ScoredPOI, area?: string): boolean {
  if (!area) return false;
  const text = `${candidate.poi.name} ${candidate.poi.area} ${candidate.poi.ugc}`;
  return text.includes(area) || (area === '园区' && /苏州工业园区|金鸡湖/.test(text));
}

function changeArea(
  route: Route,
  c: Constraints,
  persona: Persona,
  candidates: ScoredPOI[],
  area?: string,
): { route: Route; changed: string[]; executed: boolean; message: string; constraints: Constraints } {
  const pool = candidates.filter((candidate) => areaMatch(candidate, area));
  if (pool.length < 2) {
    return {
      route,
      changed: [],
      executed: false,
      constraints: c,
      message: `已理解为区域收紧${area ? `到「${area}」` : ''}，但候选不足，先保留当前安全路线。`,
    };
  }
  const currentCats = route.stops.map((stop) => stop.scored.poi.category);
  const used = new Set<string>();
  const picks: ScoredPOI[] = [];
  for (const cat of currentCats) {
    const hit = pool
      .filter((candidate) => candidate.poi.category === cat && !used.has(candidate.poi.id))
      .sort((a, b) => b.score - a.score)[0];
    if (hit) {
      picks.push(hit);
      used.add(hit.poi.id);
    }
  }
  for (const candidate of pool.sort((a, b) => b.score - a.score)) {
    if (picks.length >= route.stops.length) break;
    if (used.has(candidate.poi.id)) continue;
    picks.push(candidate);
    used.add(candidate.poi.id);
  }
  const next = safeCandidateRoute(picks, c, persona, 0);
  if (!next) {
    return {
      route,
      changed: [],
      executed: false,
      constraints: c,
      message: `已尝试把路线收紧到「${area}」，但重排后不满足时间/距离闸门，先保留当前路线。`,
    };
  }
  return {
    route: next,
    changed: picks.map((pick) => pick.poi.id).filter((id) => !route.stops.some((stop) => stop.scored.poi.id === id)),
    executed: true,
    constraints: { ...c, raw: `${c.raw} ${area ?? ''}`.trim() },
    message: `已把路线优先收紧到「${area}」附近。`,
  };
}

function conservativeFallback(route: Route, c: Constraints, persona: Persona): Route {
  let picks = route.stops.map((stop) => stop.scored);
  let current = route;
  for (let round = 0; round < 4 && current.checks.some((check) => check.status === 'fail'); round += 1) {
    const mobilityFail = current.checks.find((check) => check.key === 'mobility' && check.status === 'fail');
    let dropIdx = -1;
    if (mobilityFail) {
      dropIdx = current.stops.findIndex((stop) => mobilityFail.detail.includes(stop.scored.poi.name));
    }
    if (dropIdx < 0) {
      dropIdx = current.stops
        .map((stop, idx) => ({ idx, cost: (stop.legFromPrev?.minutes ?? 0) + (idx > 0 ? 8 : 0), stop }))
        .filter(({ idx }) => canDrop(picks, idx, c))
        .sort((a, b) => b.cost - a.cost)[0]?.idx ?? -1;
    }
    if (dropIdx < 0 || !canDrop(picks, dropIdx, c)) break;
    picks = picks.filter((_, idx) => idx !== dropIdx);
    current = rebuild(picks, c, persona, round + 1);
  }
  return current;
}

function ensureSafeRoute(
  route: Route,
  c: Constraints,
  persona: Persona,
  candidates: ScoredPOI[],
): { route: Route; repairApplied: boolean; fallbackUsed: boolean } {
  let current = revalidateRoute(route, c, persona);
  if (!current.checks.some((check) => check.status === 'fail') && hardMovementOk(current)) {
    return { route: current, repairApplied: false, fallbackUsed: false };
  }

  const repaired = repairIfNeeded(current, c, persona, candidates).route;
  current = revalidateRoute(repaired, c, persona);
  if (!current.checks.some((check) => check.status === 'fail') && hardMovementOk(current)) {
    return { route: current, repairApplied: true, fallbackUsed: false };
  }

  const fallback = conservativeFallback(current, c, persona);
  return { route: fallback, repairApplied: true, fallbackUsed: true };
}

function prefixMessage(intent: RefineIntentJSON, body: string): string {
  const label: Record<RefinePrimaryIntent, string> = {
    reduceTravel: '你想减少车程',
    addStop: '你想多逛一个地方',
    addFoodOrDrink: `你想加${intent.slots.category ?? '饮品'}休息点`,
    replaceFood: '你想换餐厅',
    lowerBudget: '你想降低预算',
    makeQuiet: '你想安静一点',
    makePhotoFriendly: '你想更适合拍照',
    changeArea: `你想把路线收紧到${intent.slots.area ? `「${intent.slots.area}」` : '指定区域'}`,
    unknown: '这句修改还不够明确',
  };
  return `已理解：${label[intent.primaryIntent]}。${body}`;
}

export async function runRefineAgent(input: RefineAgentInput): Promise<RefineAgentResult> {
  const start = performance.now();
  const intent = await resolveRefineIntent(input);
  let route = input.currentRoute;
  let constraints = input.constraints;
  let changed: string[] = [];
  let executed = false;
  let tool = 'none';
  let body = '可以继续说“少走路 / 加咖啡 / 预算降到200 / 换餐厅 / 就在某区域附近”。';

  if (intent.primaryIntent === 'reduceTravel') {
    const result = applyRefine({ kind: 'reduceTravel', raw: input.rawInput, note: intent.reason }, route, constraints, input.persona, input.candidates);
    route = result.route;
    constraints = result.constraints;
    changed = result.changed;
    executed = true;
    tool = 'replan.reduceTravel';
    body = result.message;
  } else if (intent.primaryIntent === 'addStop') {
    const result = addNearbyStop(route, constraints, input.persona, input.candidates, (candidate) =>
      candidate.poi.category !== 'dining' && candidate.poi.category !== 'nightscape');
    route = result.route;
    changed = result.changed;
    executed = result.executed;
    tool = 'poi.searchNearby+route.insert';
    body = result.message;
  } else if (intent.primaryIntent === 'addFoodOrDrink') {
    const existingDrink = route.stops.find((stop) =>
      stop.scored.poi.category === 'cafe' && drinkKeywordMatch(stop.scored, intent.slots.category));
    if (existingDrink) {
      executed = true;
      tool = 'route.inspectExistingDrink';
      body = `当前路线已包含「${existingDrink.scored.poi.name}」作为饮品/休息点，先保留这条安全动线。`;
    } else {
      const result = addNearbyStop(route, constraints, input.persona, input.candidates, (candidate) =>
        candidate.poi.category === 'cafe' && drinkKeywordMatch(candidate, intent.slots.category));
      route = result.route;
      changed = result.changed;
      executed = result.executed;
      tool = 'poi.searchNearbyDrink+route.insert';
      body = result.executed
        ? result.message
        : `已尝试搜索附近${intent.slots.category ?? '茶饮/咖啡'}，但候选不足或加入后会超出时间/移动闸门，先不增加站点。`;
    }
  } else if (intent.primaryIntent === 'replaceFood') {
    const result = applyRefine({ kind: 'replaceCategory', category: 'dining', criterion: 'higherRating', raw: input.rawInput, note: intent.reason }, route, constraints, input.persona, input.candidates);
    route = result.route;
    constraints = result.constraints;
    changed = result.changed;
    executed = result.changed.length > 0;
    tool = 'replan.replaceFood';
    body = result.message;
  } else if (intent.primaryIntent === 'lowerBudget') {
    const budget = intent.slots.budget;
    const result = budget
      ? applyRefine({ kind: 'setBudget', budget, raw: input.rawInput, note: intent.reason }, route, constraints, input.persona, input.candidates)
      : applyRefine({ kind: 'replaceCategory', criterion: 'cheaper', raw: input.rawInput, note: intent.reason }, route, constraints, input.persona, input.candidates);
    route = result.route;
    constraints = result.constraints;
    changed = result.changed;
    executed = true;
    tool = 'replan.lowerBudget';
    body = result.message;
  } else if (intent.primaryIntent === 'makeQuiet') {
    const result = replaceWithQuiet(route, constraints, input.persona, input.candidates);
    route = result.route;
    constraints = result.constraints;
    changed = result.changed;
    executed = result.executed;
    tool = 'replan.makeQuiet';
    body = result.message;
  } else if (intent.primaryIntent === 'makePhotoFriendly') {
    const result = applyRefine({ kind: 'addPreference', pref: 'photo', raw: input.rawInput, note: intent.reason }, route, constraints, input.persona, input.candidates);
    route = result.route;
    constraints = result.constraints;
    changed = result.changed;
    executed = result.changed.length > 0;
    tool = 'replan.addPhotoPreference';
    body = result.message;
  } else if (intent.primaryIntent === 'changeArea') {
    const result = changeArea(route, constraints, input.persona, input.candidates, intent.slots.area);
    route = result.route;
    constraints = result.constraints;
    changed = result.changed;
    executed = result.executed;
    tool = 'replan.changeArea';
    body = result.message;
  }

  const guarded = ensureSafeRoute(route, constraints, input.persona, input.candidates);
  route = guarded.route;
  const status = routeValidationStatus(route);
  const elapsedMs = +(performance.now() - start).toFixed(2);
  const fallbackUsed = guarded.fallbackUsed || elapsedMs > MAX_AGENT_MS;
  const message = prefixMessage(intent, body);
  const summary: RefineAgentSummary = {
    primaryIntent: intent.primaryIntent,
    confidence: intent.confidence,
    slots: intent.slots,
    reason: intent.reason,
    source: intent.source ?? 'local',
    tool,
    executed,
    validationStatus: status,
    repairApplied: guarded.repairApplied,
    fallbackUsed,
    message,
  };

  return {
    route,
    constraints,
    changed,
    intent,
    message,
    tool,
    executed,
    repairApplied: guarded.repairApplied,
    fallbackUsed,
    elapsedMs,
    summary,
  };
}
