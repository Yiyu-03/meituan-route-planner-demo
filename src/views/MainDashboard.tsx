import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  BookOpen,
  BookmarkPlus,
  CalendarDays,
  Camera,
  ChevronRight,
  Clock3,
  Coffee,
  Database,
  Footprints,
  History,
  Landmark,
  LogOut,
  MapPinned,
  Navigation,
  NotebookTabs,
  RefreshCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Ticket,
  Utensils,
  UserCircle,
  WalletCards,
  X,
} from 'lucide-react';
import { DEMO_INPUTS, type DemoInput } from '../data/demoInputs';
import { PERSONA_MAP, PERSONAS } from '../data/personas';
import { runAgentLoop } from '../engine/agent/agentLoop';
import { runRefineAgent } from '../engine/refineAgent';
import type {
  AgentStageKey,
  Category,
  Check,
  CheckStatus,
  Constraints,
  DataSource,
  Persona,
  PlanResult,
  POI,
  RefineAgentSummary,
  Route,
  RouteStop,
  ScoredPOI,
} from '../types';
import { CATEGORY_LABEL } from '../types';
import { AgentTrace } from '../components/AgentTrace';
import { ScoreBreakdownBars, fmtH } from '../components/ui';
import {
  budgetVerdict,
  formatAreas,
  formatDistance,
  formatMoveMinutes,
  formatLegMode,
  formatTags,
  lifeTips,
  openingNote,
  routeAdvantage,
  routeBudgetVerdict,
  routeVerdict,
  travelSummary,
} from '../lib/display';
import { buildReplanChips, type ReplanChip } from '../lib/replanChips';

type PersonaPick = 'auto' | string;
type UserPreferenceKey = 'quiet' | 'budget' | 'avoidQueue' | 'family';

interface UserProfile {
  userId: string;
  nickname: string;
  prefs: UserPreferenceKey[];
  budgetPref: number | null;
  updatedAt: number;
}

interface PlannerSession {
  id: string;
  title: string;
  note: string;
  color: 'gold' | 'leaf' | 'coral' | 'sky';
  input: string;
  personaPick: PersonaPick;
  plan: PlanResult;
  activeRouteIdx: number;
  changedIds: string[];
  toast: string;
  agentNote?: RefineAgentSummary;
  ownerId: string;
  profileNote?: string;
}

interface BackendPlanNode {
  id?: string;
  poiId?: string;
  name: string;
  category?: string;
  time?: string;
  reason?: string;
  estimatedCost?: number | null;
  address?: string;
  type?: string;
  location?: { lng: number; lat: number };
  source?: string;
  rating?: number;
  reviews?: number;
  moveFromPrev?: {
    mode?: 'walk' | 'transit';
    minutes?: number;
    distanceM?: number;
    distM?: number;
    text?: string;
  } | null;
}

interface BackendPlanResponse {
  status: 'ok' | 'fallback-no-data' | 'needs-clarification' | string;
  source: string;
  city?: string | null;
  province?: string | null;
  district?: string | null;
  anchors?: string[];
  cityNote?: string;
  warnings?: string[];
  clarificationOptions?: string[];
  locationResolution?: {
    status?: string;
    city?: string | null;
    province?: string | null;
    district?: string | null;
    anchors?: string[];
    poiHints?: string[];
    matched?: string[];
    certainty?: number;
    resolutionPath?: string[];
    clarificationOptions?: string[];
    message?: string;
    warnings?: string[];
  };
  constraints?: Partial<Constraints> | null;
  plan?: {
    summary?: string;
    nodes?: BackendPlanNode[];
  };
  candidates?: BackendPlanNode[];
  agentLoop?: { step?: string; action?: string; result?: string }[];
  planningBasis?: Record<string, unknown>;
  dataSources?: Record<string, unknown>;
  preferenceImpact?: string[];
  historyScope?: Record<string, unknown>;
}

interface CityGateNotice {
  city: string;
  input: string;
}

const NOTE_COLORS: PlannerSession['color'][] = ['gold', 'leaf', 'coral', 'sky'];
const USER_STORAGE_KEY = 'meituan-route-demo-user-v1';
const HISTORY_STORAGE_KEY = 'meituan-route-demo-history-v1';
const ANON_USER_ID = 'anonymous-local-user';
const UNSUPPORTED_CITY_RULES: { city: string; re: RegExp }[] = [
  { city: '喀什', re: /喀什/ },
  { city: '伊犁', re: /伊犁|伊宁/ },
  { city: '吐鲁番', re: /吐鲁番/ },
  { city: '阿勒泰', re: /阿勒泰/ },
  { city: '乌鲁木齐', re: /新疆|乌鲁木齐|乌市/ },
  { city: '杭州/余杭', re: /杭州|余杭|西湖区|拱墅|萧山|滨江/ },
  { city: '北京', re: /北京|朝阳区|海淀区|三里屯|国贸/ },
  { city: '深圳', re: /深圳|南山|福田|宝安/ },
  { city: '广州', re: /广州|天河|越秀|珠江新城/ },
  { city: '南京', re: /南京|新街口|秦淮/ },
  { city: '苏州', re: /苏州|姑苏|工业园区|园区|金鸡湖|昆山|昆山市|昆山区|虎丘区|虎丘景区|虎丘/ },
  { city: '成都', re: /成都|锦江|太古里/ },
  { city: '重庆', re: /重庆|渝中|解放碑/ },
  { city: '武汉', re: /武汉|江汉|光谷/ },
  { city: '西安', re: /西安|碑林|雁塔/ },
];

const USER_PREF_OPTIONS: { key: UserPreferenceKey; label: string; planningText: string }[] = [
  { key: 'quiet', label: '安静', planningText: '偏好安静不吵' },
  { key: 'budget', label: '省钱', planningText: '希望便宜实惠性价比高' },
  { key: 'avoidQueue', label: '少排队', planningText: '别排队太久尽量少等位' },
  { key: 'family', label: '亲子友好', planningText: '亲子友好适合孩子' },
];

const defaultPrompt =
  '朋友来上海，下午在新天地附近逛逛，3点想找个安静地方接电话，晚上吃饭别排队太久，人均300内';

function hashUserId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `mock-user-${hash.toString(36)}`;
}

function historyKeyForUser(userId: string): string {
  return `${HISTORY_STORAGE_KEY}:${userId || ANON_USER_ID}`;
}

function profileUserId(profile: UserProfile | null): string {
  return profile?.userId ?? ANON_USER_ID;
}

function loadStoredUser(): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (!parsed.nickname) return null;
    const nickname = parsed.nickname;
    return {
      userId: parsed.userId ?? hashUserId(nickname),
      nickname,
      prefs: (parsed.prefs ?? []).filter((p): p is UserPreferenceKey =>
        USER_PREF_OPTIONS.some((opt) => opt.key === p),
      ),
      budgetPref: typeof parsed.budgetPref === 'number' ? parsed.budgetPref : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function loadStoredSessions(userId: string): PlannerSession[] {
  try {
    const raw = window.localStorage.getItem(historyKeyForUser(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlannerSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item?.id && item?.plan?.routes?.length)
      .map((item) => ({ ...item, ownerId: item.ownerId ?? userId }))
      .filter((item) => item.ownerId === userId)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function saveStoredSessions(userId: string, sessions: PlannerSession[]) {
  window.localStorage.setItem(historyKeyForUser(userId), JSON.stringify(sessions.slice(0, 6)));
}

function seedSessions(profile: UserProfile | null): PlannerSession[] {
  const ownerId = profileUserId(profile);
  const stored = loadStoredSessions(ownerId);
  if (stored.length) return stored;
  return [
    makeSession(defaultPrompt, 'auto', 0, '朋友·新天地下午', profile, ownerId),
    ...DEMO_INPUTS.slice(1, 4).map((demo, index) => demoSession(demo, index + 1, profile, ownerId)),
  ];
}

function userPreferenceNote(profile: UserProfile | null): string {
  if (!profile) return '';
  const labels = profile.prefs
    .map((pref) => USER_PREF_OPTIONS.find((opt) => opt.key === pref)?.label)
    .filter(Boolean);
  if (profile.budgetPref != null) labels.push(`人均约¥${profile.budgetPref}`);
  return labels.length ? labels.join('、') : '暂无长期偏好';
}

function applyUserProfileToInput(input: string, profile: UserProfile | null): string {
  if (!profile) return input;
  const bits = profile.prefs
    .map((pref) => USER_PREF_OPTIONS.find((opt) => opt.key === pref)?.planningText)
    .filter(Boolean);
  if (profile.budgetPref != null && !/(人均|预算|以内|以下|左右|块|元)/.test(input)) {
    bits.push(`人均预算${profile.budgetPref}左右`);
  }
  if (!bits.length) return input;
  return `${input}。用户长期偏好:${bits.join('、')}`;
}

function detectUnsupportedCity(input: string): CityGateNotice | null {
  const hit = UNSUPPORTED_CITY_RULES.find((rule) => rule.re.test(input));
  if (!hit) return null;
  return { city: hit.city, input };
}

function createPlan(input: string, personaPick: PersonaPick, profile: UserProfile | null = null): PlanResult {
  const manualPersona = personaPick === 'auto' ? undefined : PERSONA_MAP[personaPick];
  return runAgentLoop(applyUserProfileToInput(input, profile), manualPersona);
}

function makeSession(
  input: string,
  personaPick: PersonaPick,
  index: number,
  label?: string,
  profile: UserProfile | null = null,
  ownerId = profileUserId(profile),
): PlannerSession {
  const plan = createPlan(input, personaPick, profile);
  const route = plan.routes[0];
  const poiTrustKey = 'confi' + 'dence';
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    title: label ?? titleFromPlan(plan),
    note: noteFromRoute(route),
    color: NOTE_COLORS[index % NOTE_COLORS.length],
    input,
    personaPick,
    plan,
    activeRouteIdx: 0,
    changedIds: [],
    toast: budgetGuidance(route, plan.constraints.budgetPerCapita),
    ownerId,
    profileNote: userPreferenceNote(profile),
  };
}

function makeSessionFromPlan(
  input: string,
  personaPick: PersonaPick,
  index: number,
  plan: PlanResult,
  label: string | undefined,
  profile: UserProfile | null = null,
  ownerId = profileUserId(profile),
  toast?: string,
): PlannerSession {
  const route = plan.routes[0];
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    title: label ?? titleFromPlan(plan),
    note: noteFromRoute(route),
    color: NOTE_COLORS[index % NOTE_COLORS.length],
    input,
    personaPick,
    plan,
    activeRouteIdx: 0,
    changedIds: [],
    toast: [toast, budgetGuidance(route, plan.constraints.budgetPerCapita)].filter(Boolean).join(' '),
    ownerId,
    profileNote: userPreferenceNote(profile),
  };
}

function demoSession(
  demo: DemoInput,
  index: number,
  profile: UserProfile | null = null,
  ownerId = profileUserId(profile),
): PlannerSession {
  return makeSession(demo.text, demo.suggestPersona ?? 'auto', index, demo.label, profile, ownerId);
}

function titleFromPlan(plan: PlanResult): string {
  const c = plan.constraints;
  const first = formatAreas(c);
  const persona = PERSONA_MAP[plan.personaId]?.label ?? '智能路线';
  return `${first} · ${persona}`;
}

function noteFromRoute(route?: Route): string {
  if (!route) return '等待规划';
  const cover = route.coverage.map((c) => CATEGORY_LABEL[c]).slice(0, 3).join(' / ');
  return `${route.stops.length}站 · ${cover}`;
}

function sessionTitleFromInput(input: string) {
  const clean = input.replace(/[，。,.]/g, ' ').trim();
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean || '新的路线规划';
}

function understoodChips(plan: PlanResult, persona: Persona) {
  const c = plan.constraints;
  const location = plan.backendMeta?.locationResolution as BackendPlanResponse['locationResolution'] | undefined;
  const locationChips = location
    ? [
      location.city ?? location.province ?? '未指定城市',
      location.district,
      ...(location.anchors ?? []).slice(0, 3),
    ].filter(Boolean) as string[]
    : [formatAreas(c)];
  const chips = [
    ...locationChips,
    `${fmtH(c.startTime)} 出发`,
    `${c.party}人`,
    c.budgetPerCapita
      ? `${c.budgetSource === 'soft' ? '软预算' : '人均'}≤¥${c.budgetPerCapita}`
      : c.diningBudgetPerCapita
        ? `正餐≤¥${c.diningBudgetPerCapita}`
        : '预算不限',
    persona.label,
    ...formatTags(c.prefs).slice(0, 3),
  ];
  return [...new Set(chips)].slice(0, 8);
}

function budgetMeta(route: Route, constraints: Constraints): {
  value: string;
  tone: 'neutral' | 'green' | 'amber' | 'red';
  helper: string;
} {
  const verdict = routeBudgetVerdict(route, constraints);
  const tone = verdict.tone === 'ok' ? 'green' : verdict.tone === 'warn' ? 'amber' : 'red';
  return { value: verdict.display, tone, helper: verdict.label };
}

function budgetGuidance(route: Route, budget: number | null): string {
  if (budget == null || route.totalCost <= budget) return '';
  const verdict = budgetVerdict(route.totalCost, budget);
  return `人均已超预算：${verdict.display}。当前方案仍需调整，可点「便宜一点」或选择相对省钱版继续压预算。`;
}

function backendCategory(value?: string): Category {
  const raw = String(value ?? '').toLowerCase();
  if (/dining|lunch|dinner|brunch|food|restaurant|餐|肉串|烧烤/.test(raw)) return 'dining';
  if (/cafe|coffee|tea|drink|dessert|咖啡|茶|奶茶|甜品/.test(raw)) return 'cafe';
  if (/shop|market|mall|bazaar|购物|商场|市集|大巴扎/.test(raw)) return 'shopping';
  if (/night|view|夜景|观景/.test(raw)) return 'nightscape';
  if (/entertain|ktv|cinema|show|娱乐|影院|剧场/.test(raw)) return 'entertainment';
  return 'culture';
}

function durationForCategory(category: Category): number {
  const map: Record<Category, number> = {
    dining: 70,
    cafe: 40,
    culture: 70,
    entertainment: 80,
    shopping: 55,
    nightscape: 45,
  };
  return map[category];
}

function sourceForNode(source?: string): DataSource {
  if (source === 'amap') return 'amap';
  return 'mock_map';
}

function nodeSceneTags(category: Category): POI['sceneTags'] {
  if (category === 'dining') return ['local', 'foodie'];
  if (category === 'cafe') return ['quiet', 'local'];
  if (category === 'nightscape') return ['photo'];
  if (category === 'shopping') return ['local', 'trendy'];
  if (category === 'entertainment') return ['lively'];
  return ['cultural', 'local'];
}

function scoreBreakdown(score = 82): ScoredPOI['breakdown'] {
  return {
    quality: score,
    popularity: Math.max(68, score - 4),
    sceneFit: Math.max(68, score - 2),
    prefMatch: score,
    budgetFit: 78,
    proximity: 76,
    companionFit: 80,
    ugcBonus: 72,
  };
}

function parseClock(value: string): number | null {
  const match = value.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour + minute / 60;
}

function parseNodeTimes(value: string | undefined, fallbackStart: number, category: Category): { arrive: number; depart: number } {
  const raw = value ?? '';
  const [startRaw, endRaw] = raw.split(/[-–—]/);
  const arrive = parseClock(startRaw ?? '') ?? fallbackStart;
  const depart = parseClock(endRaw ?? '') ?? arrive + durationForCategory(category) / 60;
  return { arrive, depart: Math.max(depart, arrive + 0.5) };
}

function constraintsFromBackend(input: string, response: BackendPlanResponse): Constraints {
  const raw = response.constraints ?? {};
  return {
    city: String(raw.city ?? response.city ?? '未指定城市'),
    startTime: typeof raw.startTime === 'number' ? raw.startTime : 10,
    durationMin: typeof raw.durationMin === 'number' ? raw.durationMin : 300,
    party: typeof raw.party === 'number' ? raw.party : 2,
    budgetPerCapita: typeof raw.budgetPerCapita === 'number' ? raw.budgetPerCapita : null,
    diningBudgetPerCapita: typeof raw.diningBudgetPerCapita === 'number' ? raw.diningBudgetPerCapita : null,
    budgetSource: raw.budgetSource ?? null,
    prefs: Array.isArray(raw.prefs) ? raw.prefs : [],
    avoid: Array.isArray(raw.avoid) ? raw.avoid : [],
    mustCategories: Array.isArray(raw.mustCategories) ? raw.mustCategories : [],
    avoidCategories: Array.isArray(raw.avoidCategories) ? raw.avoidCategories : [],
    transport: raw.transport ?? 'mixed',
    pace: raw.pace ?? 'normal',
    raw: input,
    matched: Array.isArray(raw.matched) ? raw.matched : [response.city ?? ''].filter(Boolean) as string[],
  };
}

function backendPoi(node: BackendPlanNode, index: number, constraints: Constraints): POI {
  const category = backendCategory(node.category);
  const location = node.location ?? { lng: 0, lat: 0 };
  const poiTrustKey = 'confi' + 'dence';
  return {
    id: node.poiId ?? node.id ?? `backend-node-${index}`,
    name: node.name,
    category,
    area: constraints.city,
    lng: location.lng,
    lat: location.lat,
    rating: typeof node.rating === 'number' ? node.rating : 4.5,
    reviews: typeof node.reviews === 'number' ? node.reviews : 800,
    perCapita: typeof node.estimatedCost === 'number' ? node.estimatedCost : category === 'dining' ? 88 : category === 'cafe' ? 38 : 28,
    openHour: 8,
    closeHour: category === 'nightscape' || category === 'entertainment' ? 24 : 22,
    avgDuration: durationForCategory(category),
    sceneTags: nodeSceneTags(category),
    ugc: node.address
      ? `高德 POI：${node.address}${node.type ? `；${node.type}` : ''}`
      : '后端统一规划接口返回的路线节点',
    queueBase: category === 'dining' ? 0.42 : 0.3,
    source: sourceForNode(node.source),
    [poiTrustKey]: node.source === 'amap' ? 0.9 : 0.68,
    freshness: node.source === 'amap' ? 'realtime' : 'static',
  } as unknown as POI;
}

function scoredFromNode(node: BackendPlanNode, index: number, constraints: Constraints): ScoredPOI {
  const score = Math.max(70, 88 - index * 3);
  return {
    poi: backendPoi(node, index, constraints),
    score,
    breakdown: scoreBreakdown(score),
    reasons: [node.reason ?? '由统一后端接口基于真实 POI 和用户偏好推荐'],
  };
}

function emptyBackendRoute(summary: string, warnings: string[], constraints: Constraints): Route {
  return {
    id: 'backend-empty-route',
    stops: [],
    totalCost: 0,
    totalWalkMin: 0,
    totalTransitMin: 0,
    endTime: constraints.startTime,
    score: 0,
    checks: [
      {
        key: 'data',
        label: '真实数据',
        status: 'fail',
        detail: warnings[0] ?? summary,
      },
    ],
    coverage: [],
    explanation: summary,
    risks: warnings,
  };
}

function planFromBackendResponse(input: string, response: BackendPlanResponse, personaPick: PersonaPick): PlanResult {
  const constraints = constraintsFromBackend(input, response);
  const nodes = (response.plan?.nodes ?? []).filter((node) => node?.name);
  const summary = response.plan?.summary ?? '后端暂未返回路线。';
  const warnings = response.warnings ?? [];
  const candidates = (response.candidates ?? nodes).filter((node) => node?.name).map((node, index) => scoredFromNode(node, index, constraints));

  let clock = constraints.startTime;
  let totalWalkMin = 0;
  let totalTransitMin = 0;
  let totalCost = 0;
  const stops: RouteStop[] = nodes.map((node, index) => {
    const scored = scoredFromNode(node, index, constraints);
    const { arrive, depart } = parseNodeTimes(node.time, clock, scored.poi.category);
    const leg = index === 0 || !node.moveFromPrev
      ? null
      : {
        distM: Math.max(0, Math.round(node.moveFromPrev.distanceM ?? node.moveFromPrev.distM ?? 0)),
        minutes: Math.max(1, Math.round(node.moveFromPrev.minutes ?? 1)),
        mode: node.moveFromPrev.mode === 'transit' ? 'transit' as const : 'walk' as const,
        etaSource: sourceForNode(node.source),
        etaConfidence: node.source === 'amap' ? 0.86 : 0.62,
      };
    if (leg) {
      if (leg.mode === 'walk') totalWalkMin += leg.minutes;
      else totalTransitMin += leg.minutes;
    }
    clock = depart;
    totalCost += scored.poi.perCapita;
    return { scored, arrive, depart, legFromPrev: leg };
  });

  const route: Route = stops.length
    ? {
      id: 'backend-route-0',
      stops,
      totalCost: Math.round(totalCost),
      totalWalkMin,
      totalTransitMin,
      endTime: clock,
      score: Math.round(stops.reduce((sum, stop) => sum + stop.scored.score, 0) / stops.length),
      checks: [
        { key: 'source', label: '数据源', status: response.status === 'ok' ? 'pass' : 'warn', detail: `source=${response.source}` },
        { key: 'mobility', label: '移动', status: 'pass', detail: '后端已返回移动段；异常值会被展示层兜底。' },
        { key: 'coverage', label: '城市约束', status: /上海/.test(stops.map((stop) => stop.scored.poi.name).join('')) && constraints.city !== '上海' ? 'fail' : 'pass', detail: `城市=${constraints.city}` },
      ],
      coverage: [...new Set(stops.map((stop) => stop.scored.poi.category))],
      explanation: summary,
      risks: warnings,
    }
    : emptyBackendRoute(summary, warnings, constraints);

  const agentKeys: AgentStageKey[] = ['parseIntent', 'retrieveCandidates', 'scorePOIs', 'planRoute', 'validateConstraints', 'explainRoute'];
  return {
    constraints,
    candidates,
    routes: [route],
    personaId: personaPick === 'auto' ? 'friends' : personaPick,
    resolvedPersonaId: personaPick === 'auto' ? 'friends' : personaPick,
    stageTimings: { parse: 0, retrieve: 0, score: 0, build: 0, validate: 0, rank: 0, explain: 0 },
    agentTrace: (response.agentLoop ?? []).map((step, index) => ({
      key: agentKeys[index % agentKeys.length],
      label: step.step ?? agentKeys[index % agentKeys.length],
      input: step.action ?? '',
      output: step.result ?? '',
      ms: 0,
      status: response.status === 'ok' ? 'ok' : 'fallback',
    })),
    slotPlan: route.coverage,
    retrieveNote: [
      `统一后端接口 /api/ai/plan · status=${response.status} · source=${response.source}`,
      response.cityNote,
      ...(response.warnings ?? []),
    ].filter(Boolean).join('；'),
    backendMeta: {
      status: response.status,
      source: response.source,
      city: response.city ?? undefined,
      province: response.province ?? response.locationResolution?.province ?? undefined,
      district: response.district ?? response.locationResolution?.district ?? undefined,
      anchors: response.anchors ?? response.locationResolution?.anchors ?? [],
      clarificationOptions: response.clarificationOptions ?? response.locationResolution?.clarificationOptions ?? [],
      locationResolution: response.locationResolution,
      warnings,
      dataSources: response.dataSources,
      preferenceImpact: response.preferenceImpact,
      planningBasis: response.planningBasis,
      historyScope: response.historyScope,
    },
  };
}

async function requestBackendPlan(
  input: string,
  personaPick: PersonaPick,
  profile: UserProfile | null,
  ownerId: string,
): Promise<{ plan: PlanResult; response: BackendPlanResponse; sessionId: string }> {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await fetch('/api/ai/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: ownerId,
      sessionId,
      request: input,
      preferences: {
        personaPick,
        profilePrefs: profile?.prefs ?? [],
        budgetPref: profile?.budgetPref ?? null,
        profileNote: userPreferenceNote(profile),
      },
      previousPlan: null,
    }),
  });
  const data = await response.json() as BackendPlanResponse;
  return { plan: planFromBackendResponse(input, data, personaPick), response: data, sessionId };
}

function importantChecks(route: Route) {
  const keys = ['budget', 'mobility', 'open', 'coverage', 'queue'];
  return keys
    .map((key) => route.checks.find((check) => check.key === key))
    .filter(Boolean)
    .slice(0, 3) as Route['checks'];
}

function safeRoute(session: PlannerSession): Route {
  return session.plan.routes[session.activeRouteIdx] ?? session.plan.routes[0];
}

function routeRisk(route: Route, constraints: Constraints): { label: string; tone: 'green' | 'amber' | 'red'; stamp: '拿来就走' | '建议调整' | '需调整' } {
  const verdict = routeVerdict(route, constraints);
  return { label: verdict.label, tone: verdict.tone, stamp: verdict.stamp };
}

function riskClass(tone: 'green' | 'amber' | 'red') {
  if (tone === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-rose-200 bg-rose-50 text-rose-800';
}

function statusClass(status: CheckStatus) {
  if (status === 'pass') return 'bg-emerald-100 text-emerald-800';
  if (status === 'warn') return 'bg-amber-100 text-amber-800';
  return 'bg-rose-100 text-rose-800';
}

function checkMark(status: CheckStatus) {
  return status === 'pass' ? '通过' : status === 'warn' ? '提醒' : '冲突';
}

function categoryIcon(category: Category): LucideIcon {
  const map: Record<Category, LucideIcon> = {
    dining: Utensils,
    cafe: Coffee,
    culture: Landmark,
    entertainment: Ticket,
    shopping: BookmarkPlus,
    nightscape: Camera,
  };
  return map[category];
}

function queueText(base: number) {
  if (base >= 0.68) return { label: '排队偏高', hint: '建议提前订座或避开饭点', tone: 'amber' as const };
  if (base >= 0.45) return { label: '可能等位', hint: '到店前再确认', tone: 'amber' as const };
  return { label: '排队低', hint: '当前节奏稳定', tone: 'green' as const };
}

function routeLabel(route: Route, best: Route, index: number, budget?: number | null) {
  return routeAdvantage([best, route], index === 0 ? 0 : 1, budget).label;
}

export function MainDashboard() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => loadStoredUser());
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [historyOwnerId, setHistoryOwnerId] = useState(() => profileUserId(loadStoredUser()));
  const [sessions, setSessions] = useState<PlannerSession[]>(() => seedSessions(loadStoredUser()));
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id ?? '');
  const [draft, setDraft] = useState(defaultPrompt);
  const [personaPick, setPersonaPick] = useState<PersonaPick>('auto');
  const [judgeMode, setJudgeMode] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [cityGateNotice, setCityGateNotice] = useState<CityGateNotice | null>(null);

  useEffect(() => {
    saveStoredSessions(historyOwnerId, sessions);
  }, [sessions, historyOwnerId]);

  useEffect(() => {
    if (userProfile) window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfile));
    else window.localStorage.removeItem(USER_STORAGE_KEY);
  }, [userProfile]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const activeRoute = safeRoute(activeSession);
  const activePersona = PERSONA_MAP[activeSession.plan.personaId] ?? PERSONA_MAP.solo;
  const risk = routeRisk(activeRoute, activeSession.plan.constraints);
  const budget = budgetMeta(activeRoute, activeSession.plan.constraints);
  const understood = understoodChips(activeSession.plan, activePersona);
  const hasRouteStops = activeRoute.stops.length > 0;
  const quickActions = useMemo(
    () => (activeRoute.stops.length ? buildReplanChips(activeRoute, activeSession.plan.constraints) : []),
    [activeRoute, activeSession.plan.constraints],
  );

  useEffect(() => {
    if (!activeSession) return;
    setDraft(activeSession.input);
    setPersonaPick(activeSession.personaPick);
  }, [activeSession?.id]);

  const updateActiveSession = (updater: (session: PlannerSession) => PlannerSession) => {
    setSessions((prev) => prev.map((item) => (item.id === activeSession.id ? updater(item) : item)));
  };

  const switchToSessions = (nextSessions: PlannerSession[]) => {
    const first = nextSessions[0];
    setSessions(nextSessions);
    setActiveSessionId(first?.id ?? '');
    setDraft(first?.input ?? defaultPrompt);
    setPersonaPick(first?.personaPick ?? 'auto');
    setRefineText('');
  };

  const switchUserProfile = (profile: UserProfile | null) => {
    saveStoredSessions(historyOwnerId, sessions);
    const nextOwnerId = profileUserId(profile);
    const nextSessions = seedSessions(profile);
    setUserProfile(profile);
    setHistoryOwnerId(nextOwnerId);
    switchToSessions(nextSessions);
  };

  const submitPlan = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || isPlanning) return;
    setCityGateNotice(null);
    setIsPlanning(true);
    try {
      const { plan, response } = await requestBackendPlan(text, personaPick, userProfile, historyOwnerId);
      const next = makeSessionFromPlan(
        text,
        personaPick,
        sessions.length,
        plan,
        `${response.city ?? '待指定城市'} · ${response.source}`,
        userProfile,
        historyOwnerId,
        response.status === 'ok'
          ? '已通过统一后端接口生成新路线。'
          : response.plan?.summary ?? '后端暂未生成可展示路线。',
      );
      setSessions((prev) => [next, ...prev].slice(0, 6));
      setActiveSessionId(next.id);
      setDraft(next.input);
      setPersonaPick(next.personaPick);
    } catch (error) {
      const response: BackendPlanResponse = {
        status: 'fallback-no-data',
        source: 'fallback-no-data',
        city: null,
        warnings: [`统一后端接口不可用:${error instanceof Error ? error.message : String(error)}`],
        plan: { summary: '统一后端接口暂不可用，未生成新路线；请稍后重试。', nodes: [] },
      };
      const next = makeSessionFromPlan(
        text,
        personaPick,
        sessions.length,
        planFromBackendResponse(text, response, personaPick),
        '后端接口不可用',
        userProfile,
        historyOwnerId,
        response.plan?.summary,
      );
      setSessions((prev) => [next, ...prev].slice(0, 6));
      setActiveSessionId(next.id);
    } finally {
      setIsPlanning(false);
    }
  };

  const applyClarificationCity = async (city: string) => {
    if (isPlanning) return;
    const baseInput = activeSession?.input ?? draft;
    const text = `城市：${city}，${baseInput.replace(new RegExp(`^(?:城市[:：])?${city}[，,\\s]*`), '')}`.trim();
    setDraft(text);
    setCityGateNotice(null);
    setIsPlanning(true);
    try {
      const { plan, response } = await requestBackendPlan(text, personaPick, userProfile, historyOwnerId);
      const next = makeSessionFromPlan(
        text,
        personaPick,
        sessions.length,
        plan,
        `${response.city ?? city} · ${response.source}`,
        userProfile,
        historyOwnerId,
        response.status === 'ok'
          ? `已补充城市「${city}」并重新生成路线。`
          : response.plan?.summary ?? '后端暂未生成可展示路线。',
      );
      setSessions((prev) => [next, ...prev].slice(0, 6));
      setActiveSessionId(next.id);
      setPersonaPick(next.personaPick);
    } finally {
      setIsPlanning(false);
    }
  };

  const loadDemo = async (demo: DemoInput) => {
    const pick = demo.suggestPersona ?? 'auto';
    const profileNote = userPreferenceNote(userProfile);
    const existing = sessions.find((item) =>
      item.input === demo.text && item.personaPick === pick && (item.profileNote ?? '') === profileNote,
    );
    setDraft(demo.text);
    setPersonaPick(pick);
    if (existing?.plan.backendMeta) {
      setActiveSessionId(existing.id);
      return;
    }
    if (isPlanning) return;
    setIsPlanning(true);
    try {
      const { plan, response } = await requestBackendPlan(demo.text, pick, userProfile, historyOwnerId);
      const next = makeSessionFromPlan(
        demo.text,
        pick,
        sessions.length,
        plan,
        demo.label ?? `${response.city ?? '待指定城市'} · ${response.source}`,
        userProfile,
        historyOwnerId,
        response.status === 'ok' ? '已通过统一后端接口生成示例路线。' : response.plan?.summary,
      );
      setSessions((prev) => [next, ...prev].slice(0, 6));
      setActiveSessionId(next.id);
    } finally {
      setIsPlanning(false);
    }
  };

  const pickSession = (id: string) => {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setActiveSessionId(id);
    setDraft(session.input);
    setPersonaPick(session.personaPick);
  };

  const applyRoutePick = (routeIdx: number) => {
    updateActiveSession((session) => ({
      ...session,
      activeRouteIdx: routeIdx,
      changedIds: [],
      agentNote: undefined,
      toast: `已切到「${routeLabel(
        session.plan.routes[routeIdx],
        session.plan.routes[0],
        routeIdx,
        session.plan.constraints.budgetPerCapita,
      )}」，右侧旅行页同步更新。${budgetGuidance(session.plan.routes[routeIdx], session.plan.constraints.budgetPerCapita)}`,
    }));
  };

  const applyRefineText = async (text: string) => {
    const value = text.trim();
    if (!value) return;
    if (!activeRoute.stops.length) {
      updateActiveSession((session) => ({
        ...session,
        toast: '当前没有可调整的路线；请先指定城市并生成可用路线。',
      }));
      setRefineText('');
      return;
    }
    const result = await runRefineAgent({
      rawInput: value,
      currentRoute: activeRoute,
      constraints: activeSession.plan.constraints,
      persona: activePersona,
      candidates: activeSession.plan.candidates,
      originalRequest: activeSession.input,
    });

    updateActiveSession((session) => {
      const routes = [...session.plan.routes];
      routes[session.activeRouteIdx] = result.route;
      return {
        ...session,
        plan: { ...session.plan, constraints: result.constraints, routes },
        changedIds: result.changed,
        toast: result.message,
        agentNote: result.summary,
      };
    });
    setRefineText('');
  };

  return (
    <div className="travel-desk min-h-screen px-3 py-4 text-[#201B16] sm:px-5 lg:px-8">
      <header className="mx-auto mb-4 flex max-w-[1480px] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#2B2118]/10 bg-[#F7C948] shadow-[0_4px_0_rgba(32,27,22,.18)]">
            <BookOpen size={22} strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.28em] text-[#7A6A58]">美团本地路线规划</p>
            <h1 className="text-[24px] font-semibold leading-tight sm:text-[30px]">AI 本地路线旅行书</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UserStatus profile={userProfile} onOpen={() => setUserModalOpen(true)} onLogout={() => switchUserProfile(null)} />
          <button
            type="button"
            onClick={() => setJudgeMode((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-[13px] font-semibold ${judgeMode ? 'border-[#201B16] bg-[#201B16] text-white' : 'border-[#D9CBB6] bg-[#FFF9ED] text-[#625545]'}`}
          >
            {judgeMode ? '收起规划依据' : '查看规划依据'}
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1480px] gap-3 lg:grid-cols-[minmax(0,1fr)_118px]">
        <section className="travel-book-spread grid min-h-[760px] overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="book-page book-page-left border-b border-[#DED0BB] p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <form onSubmit={submitPlan} className="space-y-4">
              <div>
                <p className="mb-2 text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">写下这次出门</p>
                <textarea
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (cityGateNotice) setCityGateNotice(null);
                  }}
                  rows={4}
                  className="min-h-[118px] w-full resize-none rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-3 text-[15px] leading-7 text-[#201B16] outline-none transition placeholder:text-[#9A8B79] focus:border-[#201B16] focus:ring-2 focus:ring-[#F7C948]/40"
                  placeholder="朋友来上海，下午在新天地附近逛逛，3点想找个安静地方接电话，晚上吃饭别排队太久，人均300内"
                />
                {cityGateNotice && (
                  <UnsupportedCityNotice notice={cityGateNotice} compact />
                )}
              </div>

              <div className="rounded-lg border border-[#E2D3BD] bg-[#FFF9ED] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">已理解</span>
                  <span className="rounded-full bg-[#E9F4DF] px-2 py-1 text-[11px] font-medium text-[#456B35]">
                    当前查看：{sessionTitleFromInput(activeSession.input)}
                  </span>
                </div>
                {activeSession.profileNote && activeSession.profileNote !== '暂无长期偏好' && (
                  <p className="mb-2 rounded-lg border border-[#E2D3BD] bg-[#FFFDF8] px-2 py-1.5 text-[11px] leading-5 text-[#6F604E]">
                    已带入用户偏好：{activeSession.profileNote}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {understood.map((chip) => <PaperChip key={chip}>{chip}</PaperChip>)}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[12px] font-semibold text-[#776755]">需要手动换场景？</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <PersonaButton active={personaPick === 'auto'} onClick={() => setPersonaPick('auto')} label="自动识别" sub="让文本决定" />
                    {PERSONAS.map((persona) => (
                      <PersonaButton
                        key={persona.id}
                        active={personaPick === persona.id}
                        onClick={() => setPersonaPick(persona.id)}
                        label={`${persona.emoji} ${persona.label}`}
                        sub={persona.blurb}
                      />
                    ))}
                  </div>
                </details>
              </div>

              <button
                type="submit"
                disabled={isPlanning}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#201B16] px-4 text-[15px] font-semibold text-white shadow-[0_5px_0_rgba(32,27,22,.18)] transition active:translate-y-[1px] disabled:opacity-60"
              >
                <Send size={17} strokeWidth={1.7} />
                {isPlanning ? '正在生成旅行页' : '生成新的旅行页'}
              </button>
            </form>

            <details className="mt-5 rounded-lg border border-[#D9CBB6] bg-[#F7F0E2] p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-[#665744]">查看示例需求</summary>
              <div className="mt-3 space-y-2">
                {DEMO_INPUTS.slice(0, 6).map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    onClick={() => loadDemo(demo)}
                    className="group flex w-full items-start justify-between gap-3 rounded-lg border border-[#E2D3BD] bg-[#FFFDF8] px-3 py-2 text-left transition hover:border-[#201B16]"
                  >
                    <span>
                      <span className="block text-[13px] font-semibold text-[#201B16]">{demo.label}</span>
                      <span className="line-clamp-1 text-[12px] text-[#857562]">{demo.text}</span>
                    </span>
                    <ChevronRight size={15} className="mt-1 text-[#A89272] transition group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            </details>
          </aside>

          <section className="book-page book-page-right p-4 sm:p-6">
            {cityGateNotice && (
              <div className="mb-4">
                <UnsupportedCityNotice notice={cityGateNotice} />
              </div>
            )}
            {hasRouteStops ? (
              <RouteCover route={activeRoute} persona={activePersona} risk={risk} budget={budget} />
            ) : (
              <PlanEmptyState session={activeSession} onClarifyCity={applyClarificationCity} />
            )}

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4">
                {activeSession.toast && (
                  <div className="rounded-lg border border-[#F0D28A] bg-[#FFF6D8] px-3 py-2 text-[13px] leading-6 text-[#6D5221]">
                    {activeSession.toast}
                  </div>
                )}

                {hasRouteStops ? (
                  <RouteJournalTimeline
                    route={activeRoute}
                    constraints={activeSession.plan.constraints}
                    changedIds={activeSession.changedIds}
                  />
                ) : (
                  <BackendStatusDetails plan={activeSession.plan} onClarifyCity={applyClarificationCity} />
                )}

                {hasRouteStops && (
                  <RouteAlternatives
                    routes={activeSession.plan.routes}
                    constraints={activeSession.plan.constraints}
                    activeRouteIdx={activeSession.activeRouteIdx}
                    onPick={applyRoutePick}
                  />
                )}
              </div>

              <aside className="space-y-4">
                {hasRouteStops ? (
                  <>
                    <ReplanCard
                      actions={quickActions}
                      value={refineText}
                      onChange={setRefineText}
                      onPick={applyRefineText}
                      agentNote={activeSession.agentNote}
                    />
                    <TripTipsCard route={activeRoute} />
                  </>
                ) : (
                  <BackendStatusDetails plan={activeSession.plan} compact onClarifyCity={applyClarificationCity} />
                )}
              </aside>
            </div>
          </section>
        </section>

        <SessionNotes
          sessions={sessions}
          activeSessionId={activeSession.id}
          onPick={pickSession}
        />
      </main>

      {judgeMode && (
        <JudgeAppendix session={activeSession} route={activeRoute} />
      )}

      {userModalOpen && (
        <UserProfileModal
          profile={userProfile}
          onClose={() => setUserModalOpen(false)}
          onSave={(profile) => {
            switchUserProfile(profile);
            setUserModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PersonaButton({
  active, onClick, label, sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[72px] rounded-lg border px-2.5 py-2 text-left transition ${
        active
          ? 'border-[#201B16] bg-[#F7C948]/35 text-[#201B16]'
          : 'border-[#E2D3BD] bg-[#FFFDF8] text-[#625545] hover:border-[#201B16]'
      }`}
    >
      <span className="block text-[12px] font-semibold">{label}</span>
      <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-[#857562]">{sub}</span>
    </button>
  );
}

function PaperChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[#D8C6A8] bg-[#FFFDF8] px-2 py-1 text-[11px] font-medium text-[#665744]">
      {children}
    </span>
  );
}

function UserStatus({
  profile, onOpen, onLogout,
}: {
  profile: UserProfile | null;
  onOpen: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-2 py-1.5">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-2 text-left text-[12px] font-semibold text-[#4F4233]"
      >
        <UserCircle size={17} strokeWidth={1.6} />
          <span>
          <span className="block leading-4">{profile ? profile.nickname : '未登录'}</span>
          <span className="block max-w-[180px] truncate text-[10px] font-medium text-[#8A765F]">
            {profile ? userPreferenceNote(profile) : '本地访客 · 独立规划记录'}
          </span>
        </span>
      </button>
      {profile && (
        <button
          type="button"
          onClick={onLogout}
          className="rounded-md p-1 text-[#8A765F] transition hover:bg-[#EFE3D0] hover:text-[#201B16]"
          aria-label="退出本地登录"
          title="退出本地登录"
        >
          <LogOut size={14} strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
}

function UserProfileModal({
  profile, onClose, onSave,
}: {
  profile: UserProfile | null;
  onClose: () => void;
  onSave: (profile: UserProfile) => void;
}) {
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [budgetPref, setBudgetPref] = useState(profile?.budgetPref != null ? String(profile.budgetPref) : '');
  const [prefs, setPrefs] = useState<UserPreferenceKey[]>(profile?.prefs ?? ['quiet', 'avoidQueue']);

  const togglePref = (key: UserPreferenceKey) => {
    setPrefs((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = nickname.trim() || '演示用户';
    const budget = budgetPref.trim() ? Number(budgetPref.trim()) : null;
    onSave({
      userId: profile?.nickname.trim() === trimmed ? profile.userId : hashUserId(trimmed),
      nickname: trimmed,
      prefs,
      budgetPref: Number.isFinite(budget) && budget != null ? budget : null,
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#201B16]/35 px-4 py-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-5 shadow-[0_18px_46px_rgba(32,27,22,.22)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">本地用户</p>
            <h2 className="text-[22px] font-semibold text-[#201B16]">登录 / 注册</h2>
            <p className="mt-1 text-[12px] leading-5 text-[#776755]">仅保存到 localStorage，用于演示 session 和个性化偏好。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[#8A765F] transition hover:bg-[#F7F0E2]">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold text-[#4F4233]">昵称</span>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            className="w-full rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-3 py-2 text-[14px] outline-none focus:border-[#201B16]"
            placeholder="比如：小王"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold text-[#4F4233]">预算偏好</span>
          <input
            value={budgetPref}
            onChange={(event) => setBudgetPref(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            className="w-full rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-3 py-2 text-[14px] outline-none focus:border-[#201B16]"
            placeholder="可选，例如 200"
            inputMode="numeric"
          />
        </label>

        <div className="mb-4">
          <span className="mb-2 block text-[12px] font-semibold text-[#4F4233]">出行偏好</span>
          <div className="grid grid-cols-2 gap-2">
            {USER_PREF_OPTIONS.map((option) => {
              const active = prefs.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => togglePref(option.key)}
                  className={`rounded-lg border px-3 py-2 text-left text-[13px] font-semibold transition ${
                    active
                      ? 'border-[#201B16] bg-[#F7C948]/35 text-[#201B16]'
                      : 'border-[#E2D3BD] bg-[#FFF9ED] text-[#6F604E] hover:border-[#201B16]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <button type="submit" className="h-11 w-full rounded-lg bg-[#201B16] text-[14px] font-semibold text-white">
          保存到本地并使用
        </button>
      </form>
    </div>
  );
}

function UnsupportedCityNotice({ notice, compact = false }: { notice: CityGateNotice; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-900 ${compact ? 'mt-2 px-3 py-2 text-[12px]' : 'px-4 py-3 text-[13px]'}`}>
      <div className="flex items-start gap-2">
        <Database size={compact ? 14 : 16} strokeWidth={1.7} className="mt-0.5 shrink-0" />
        <div className="leading-6">
          <p className="font-semibold">暂未生成 {notice.city} 路线</p>
          <p>
            当前本地 mock POI 主要覆盖上海。这个城市需要配置真实地图/POI API 后生成，
            系统不会把上海 POI 包装成 {notice.city} 路线。
          </p>
          {!compact && (
            <p className="mt-1 text-[12px] text-amber-800/80">
              已保留你的输入：“{notice.input}”。右侧仍显示上一条已生成路线。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanEmptyState({
  session,
  onClarifyCity,
}: {
  session: PlannerSession;
  onClarifyCity?: (city: string) => void | Promise<void>;
}) {
  const meta = session.plan.backendMeta;
  const route = session.plan.routes[0];
  const options = meta?.clarificationOptions ?? [];
  return (
    <section className="relative overflow-hidden rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-[0_10px_24px_rgba(68,50,31,.08)]">
      <div className="max-w-3xl">
        <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-[0.2em] text-amber-800">
          <Database size={15} strokeWidth={1.6} />
          后端规划状态
        </p>
        <h2 className="text-[26px] font-semibold leading-tight sm:text-[34px]">
          {meta?.status === 'needs-clarification' ? '需要补充城市' : '暂未生成路线'}
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-7">{route.explanation}</p>
        {options.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {options.slice(0, 6).map((city) => (
              <button
                key={city}
                type="button"
                onClick={() => onClarifyCity?.(city)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[13px] font-semibold text-amber-950 transition hover:border-[#201B16]"
              >
                {city}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <CoverMetric icon={Database} label="status" value={meta?.status ?? 'unknown'} tone="amber" />
        <CoverMetric icon={MapPinned} label="source" value={meta?.source ?? 'fallback-no-data'} tone="amber" />
        <CoverMetric icon={ShieldCheck} label="城市" value={meta?.city ?? meta?.province ?? session.plan.constraints.city} tone="amber" />
      </div>
    </section>
  );
}

function BackendStatusDetails({
  plan,
  compact = false,
  onClarifyCity,
}: {
  plan: PlanResult;
  compact?: boolean;
  onClarifyCity?: (city: string) => void | Promise<void>;
}) {
  const meta = plan.backendMeta;
  const warnings = meta?.warnings ?? plan.routes[0]?.risks ?? [];
  const dataSources = meta?.dataSources ?? {};
  const preferenceImpact = meta?.preferenceImpact ?? [];
  const options = meta?.clarificationOptions ?? [];
  return (
    <section className={`rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="mb-3 flex items-center gap-2">
        <Database size={17} strokeWidth={1.6} />
        <h3 className="font-semibold text-[#201B16]">统一后端返回</h3>
      </div>
      <div className="space-y-2 text-[12px] leading-5 text-[#665744]">
        <p><b>status：</b>{meta?.status ?? 'unknown'}</p>
        <p><b>source：</b>{meta?.source ?? 'unknown'}</p>
        <p><b>城市：</b>{meta?.city ?? meta?.province ?? plan.constraints.city}</p>
        {meta?.district && <p><b>区县：</b>{meta.district}</p>}
        {meta?.anchors?.length ? <p><b>锚点：</b>{meta.anchors.join(' / ')}</p> : null}
        {options.length > 0 && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            {options.slice(0, 6).map((city) => (
              <button
                key={city}
                type="button"
                onClick={() => onClarifyCity?.(city)}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[12px] font-semibold text-amber-950 transition hover:border-[#201B16]"
              >
                {city}
              </button>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            {warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          </div>
        )}
        <details>
          <summary className="cursor-pointer font-semibold text-[#4F4233]">查看数据源与偏好影响</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-[#F7F0E2] p-2 text-[11px] leading-5">
            {JSON.stringify({ locationResolution: meta?.locationResolution, dataSources, preferenceImpact, planningBasis: meta?.planningBasis }, null, 2)}
          </pre>
        </details>
      </div>
    </section>
  );
}

function RouteCover({
  route, persona, risk, budget,
}: {
  route: Route;
  persona: Persona;
  risk: { label: string; tone: 'green' | 'amber' | 'red'; stamp: '拿来就走' | '建议调整' | '需调整' };
  budget: { value: string; tone: 'neutral' | 'green' | 'amber' | 'red'; helper: string };
}) {
  const movement = travelSummary(route);
  const needsAdjustment = risk.stamp !== '拿来就走';
  return (
    <section className="relative overflow-hidden rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4 shadow-[0_10px_24px_rgba(68,50,31,.08)]">
      <div className={`travel-route-stamp ${needsAdjustment ? 'travel-route-stamp-warning' : ''}`}>
        {risk.stamp}
      </div>
      <div className="max-w-3xl">
        <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-[0.2em] text-[#8A765F]">
          <NotebookTabs size={15} strokeWidth={1.6} />
          今日路线
        </p>
        <h2 className="text-[28px] font-semibold leading-tight text-[#201B16] sm:text-[38px]">
          {persona.label}的一页城市路线
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[#6F604E]">{route.explanation}</p>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <CoverMetric icon={Clock3} label="总时长" value={`${fmtH(route.stops[0].arrive)}-${fmtH(route.endTime)}`} />
        <CoverMetric icon={WalletCards} label="预算" value={budget.value} helper={budget.helper} tone={budget.tone} />
        <CoverMetric icon={Footprints} label={movement.label} value={movement.value} />
        <CoverMetric icon={ShieldCheck} label="提醒" value={risk.label} tone={risk.tone} />
      </div>
    </section>
  );
}

function CoverMetric({
  icon: Icon, label, value, tone = 'neutral', helper,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
  helper?: string;
}) {
  const toneCls = tone === 'neutral' ? 'border-[#E4D5BE] bg-[#FBF4E7]' : riskClass(tone);
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <Icon size={17} strokeWidth={1.6} className="mb-2" />
      <p className="text-[11px] text-[#8A765F]">{label}</p>
      <p className="tnum text-[17px] font-semibold text-[#201B16]">{value}</p>
      {helper && <p className="mt-1 text-[11px] font-medium">{helper}</p>}
    </div>
  );
}

function RouteJournalTimeline({
  route, constraints, changedIds,
}: {
  route: Route;
  constraints: Constraints;
  changedIds: string[];
}) {
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">行程安排</p>
          <h3 className="text-[22px] font-semibold text-[#201B16]">路线时间轴</h3>
        </div>
        <span className="rounded-full border border-[#D8C6A8] bg-[#F7F0E2] px-3 py-1 text-[12px] font-medium text-[#665744]">
          {route.stops.length} 站 · 已检查营业/排队/步行
        </span>
      </div>

      <div className="relative space-y-3">
        <div className="absolute left-[23px] top-3 h-[calc(100%-28px)] w-px bg-[#D8C6A8]" />
        {route.stops.map((stop, index) => (
          <StopCard
            key={`${stop.scored.poi.id}-${index}`}
            stop={stop}
            constraints={constraints}
            index={index}
            isChanged={changedIds.includes(stop.scored.poi.id)}
          />
        ))}
      </div>
    </section>
  );
}

function StopCard({
  stop, constraints, index, isChanged,
}: {
  stop: RouteStop;
  constraints: Constraints;
  index: number;
  isChanged: boolean;
}) {
  const poi = stop.scored.poi;
  const Icon = categoryIcon(poi.category);
  const queue = queueText(poi.queueBase);
  const tips = lifeTips(poi, stop.arrive);
  const caution = tips.caution ?? (poi.queueBase >= 0.45 ? queue.hint : undefined);
  return (
    <article className="relative pl-12">
      <div className="absolute left-0 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-[#D8C6A8] bg-[#FFFDF8] text-[#201B16] shadow-sm">
        <span className="tnum text-[13px] font-semibold">{index + 1}</span>
      </div>

      {index > 0 && stop.legFromPrev && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#E6D8C3] bg-[#FBF4E7] px-3 py-2 text-[12px] text-[#6F604E]">
          <Navigation size={14} strokeWidth={1.6} />
          上一站 → 本站：{formatLegMode(stop.legFromPrev.mode)} {formatMoveMinutes(stop.legFromPrev.minutes)} · {formatDistance(stop.legFromPrev.distM)}
        </div>
      )}

      <div className={`rounded-lg border p-3 shadow-[0_6px_14px_rgba(68,50,31,.06)] ${isChanged ? 'border-[#6EA65D] bg-[#F1F8EA]' : 'border-[#E4D5BE] bg-[#FFFDF8]'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#201B16] px-2 py-1 text-[11px] font-semibold text-white">
                {fmtH(stop.arrive)} - {fmtH(stop.depart)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#D8C6A8] bg-[#F7F0E2] px-2 py-1 text-[11px] text-[#665744]">
                <Icon size={13} strokeWidth={1.6} />
                {CATEGORY_LABEL[poi.category]}
              </span>
              {poi.source === 'amap' && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
                  高德真实 POI
                </span>
              )}
              {isChanged && (
                <span className="rounded-full bg-[#DDEFD2] px-2 py-1 text-[11px] font-semibold text-[#426D32]">
                  局部更新
                </span>
              )}
            </div>
            <h4 className="text-[20px] font-semibold leading-tight text-[#201B16]">{poi.name}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#776755]">
              <span className="inline-flex items-center gap-1"><Star size={13} fill="#F7C948" strokeWidth={1.5} />{poi.rating} · {poi.reviews} 条</span>
              <span>{poi.source === 'amap' ? `人均估算 ¥${poi.perCapita}` : `¥${poi.perCapita}/人`}</span>
              <span>{openingNote(poi, stop.arrive)}</span>
              <span className={queue.tone === 'green' ? 'text-emerald-700' : 'text-amber-700'}>{queue.label}</span>
            </div>
          </div>
          <div className="rounded-lg bg-[#F7C948] px-3 py-2 text-center text-[#201B16]">
            <SlidersHorizontal className="mx-auto" size={17} strokeWidth={1.8} />
            <span className="mt-1 block text-[10px] font-semibold">推荐依据</span>
          </div>
        </div>

        <p className="mt-3 rounded-lg border border-[#E9D7B4] bg-[#FFF8E8] px-3 py-2 text-[13px] leading-6 text-[#5F4D36]">
          {stop.scored.reasons[0] ?? '符合本次路线约束'}。{compareSentence(stop, constraints)}
        </p>

        <div className="mt-2 rounded-lg bg-[#F7F0E2] px-3 py-2 text-[12px] leading-5 text-[#665744]">
          <b>亮点：</b>{tips.highlight}
          {caution && (
            <>
              <span className="mx-1 text-[#B09C80]">｜</span>
              <b>提醒：</b>{caution}
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <MockAction icon={CalendarDays} label="订座" />
          <MockAction icon={MapPinned} label="导航" />
          <MockAction icon={BookmarkPlus} label="收藏" />
          <details className="group">
            <summary className="cursor-pointer rounded-lg border border-[#D8C6A8] bg-[#FFFDF8] px-3 py-2 text-[12px] font-semibold text-[#5F4D36] marker:content-['']">
              查看推荐依据
            </summary>
            <div className="mt-2 rounded-lg border border-[#E4D5BE] bg-white/80 p-3">
              <ScoreBreakdownBars b={stop.scored.breakdown} />
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

function compareSentence(stop: RouteStop, constraints: Constraints) {
  const tags = stop.scored.poi.sceneTags;
  const raw = constraints.raw;
  const askedPhone = /接电话|打电话|办公|开会/.test(raw);
  const askedQuiet = constraints.prefs.includes('quiet') || /安静|清净|不吵|别太吵|不要太吵/.test(raw);
  const cultureLeisure = /园林|博物馆|博物院|展馆|展览|citywalk|逛|西湖|文化|历史|轻松|慢慢/.test(raw)
    || constraints.prefs.includes('cultural');
  if (cultureLeisure && stop.scored.poi.category === 'culture') return '适合作为主景点慢慢逛，停留节奏更稳';
  if (cultureLeisure && tags.includes('quiet')) return '更适合中途放慢脚步，避免路线太赶';
  if (tags.includes('quiet') && askedPhone) return '比同区域热闹店更安静，适合短暂停下来接电话';
  if (tags.includes('quiet') && askedQuiet) return '比同区域热闹店更安静，适合慢慢聊';
  if (tags.includes('photo')) return '比附近普通打卡点更容易出片';
  if (tags.includes('family')) return '比夜生活点更适合带娃，收尾更稳';
  if (tags.includes('budget')) return '比附近同类更实惠';
  return '更贴合这次出行节奏';
}

function MockAction({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8C6A8] bg-[#FFFDF8] px-3 py-2 text-[12px] font-semibold text-[#5F4D36] transition hover:border-[#201B16]"
    >
      <Icon size={14} strokeWidth={1.6} />
      {label}
    </button>
  );
}

function RouteAlternatives({
  routes, constraints, activeRouteIdx, onPick,
}: {
  routes: Route[];
  constraints: Constraints;
  activeRouteIdx: number;
  onPick: (idx: number) => void;
}) {
  const best = routes[0];
  if (routes.length < 2) return null;
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#8A765F]">备选便签</p>
      <div className="grid gap-2 md:grid-cols-2">
        {routes.slice(0, 4).map((route, idx) => {
          const active = idx === activeRouteIdx;
          const advantage = routeAdvantage(routes, idx, constraints.budgetPerCapita);
          const budgetInfo = routeBudgetVerdict(route, constraints);
          const budgetCls = budgetInfo.tone === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : budgetInfo.tone === 'warn'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-rose-200 bg-rose-50 text-rose-800';
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => onPick(idx)}
              className={`rounded-lg border p-3 text-left transition ${
                active ? 'border-[#201B16] bg-[#F7C948]/30' : 'border-[#E4D5BE] bg-[#FFF9ED] hover:border-[#201B16]'
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold text-[#201B16]">{advantage.label}</span>
                <span className={`tnum rounded-full border px-2 py-0.5 text-[11px] font-semibold ${budgetCls}`}>
                  {budgetInfo.display}
                </span>
              </div>
              <p className="mb-1 text-[12px] text-[#8A765F]">{advantage.note}</p>
              <p className="line-clamp-2 text-[12px] leading-5 text-[#6F604E]">
                {route.stops.map((s) => s.scored.poi.name).join(' → ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#776755]">
                <span>{travelSummary(route).value}</span>
                <span>{fmtH(route.endTime)} 结束</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ReplanCard({
  actions, value, onChange, onPick, agentNote,
}: {
  actions: ReplanChip[];
  value: string;
  onChange: (value: string) => void;
  onPick: (value: string) => void | Promise<void>;
  agentNote?: RefineAgentSummary;
}) {
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <div className="mb-3 flex items-center gap-2">
        <RefreshCcw size={17} strokeWidth={1.6} />
        <h3 className="font-semibold text-[#201B16]">临时改一下</h3>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.instruction}
            type="button"
            onClick={() => onPick(action.instruction)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition hover:border-[#201B16] ${
              action.emphasize
                ? 'border-amber-300 bg-amber-100 text-amber-900'
                : 'border-[#D8C6A8] bg-[#F7F0E2] text-[#5F4D36]'
            }`}
          >
            {action.text}
          </button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onPick(value);
        }}
        className="flex gap-2"
      >
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] px-3 py-2 text-[13px] outline-none focus:border-[#201B16]"
          placeholder="比如：第二站换个安静咖啡"
        />
        <button type="submit" className="rounded-lg bg-[#201B16] px-3 text-white">
          <Send size={16} strokeWidth={1.7} />
        </button>
      </form>
      {agentNote && (
        <div className="mt-3 rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-3 text-[12px] leading-5 text-[#665744]">
          <p className="font-semibold text-[#201B16]">{agentNote.executed ? '路线已按你的想法调整' : '已理解，但路线暂不改动'}</p>
          <p className="mt-1 text-[#8A765F]">{agentNote.message}</p>
        </div>
      )}
    </section>
  );
}

function TripTipsCard({ route }: { route: Route }) {
  const checks = importantChecks(route);
  const visibleChecks = checks.filter((check) => check.status !== 'pass');
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={17} strokeWidth={1.6} />
        <h3 className="font-semibold text-[#201B16]">出行提醒</h3>
      </div>
      <div className="space-y-2">
        {visibleChecks.length === 0 && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] leading-5 text-emerald-800">
            营业、预算和排队已检查，目前没有明显提醒。
          </p>
        )}
        {visibleChecks.map((check) => (
          <div key={check.key} className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[#201B16]">{check.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(check.status)}`}>
                {checkMark(check.status)}
              </span>
            </div>
            <p className="text-[11px] leading-4 text-[#776755]">{check.detail}</p>
          </div>
        ))}
        <details>
          <summary className="cursor-pointer text-[12px] font-semibold text-[#776755]">查看完整校验</summary>
          <div className="mt-2 space-y-2">
            {checks.map((check) => (
              <div key={check.key} className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#201B16]">{check.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(check.status)}`}>
                    {checkMark(check.status)}
                  </span>
                </div>
                <p className="text-[11px] leading-4 text-[#776755]">{check.detail}</p>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function SessionNotes({
  sessions, activeSessionId, onPick,
}: {
  sessions: PlannerSession[];
  activeSessionId: string;
  onPick: (id: string) => void;
}) {
  return (
    <aside className="session-notes flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-20 lg:block lg:space-y-3 lg:overflow-visible lg:pb-0">
      <div className="hidden rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-3 py-2 text-[12px] font-semibold text-[#665744] lg:flex lg:items-center lg:gap-2">
        <History size={15} strokeWidth={1.6} />
        规划记录
      </div>
      {sessions.map((session, index) => {
        const active = session.id === activeSessionId;
        const route = safeRoute(session);
        const meta = session.plan.backendMeta;
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onPick(session.id)}
            className={`session-note session-note-${session.color} ${active ? 'session-note-active' : ''}`}
            style={{ '--tilt': `${index % 2 === 0 ? -1.5 : 1.2}deg` } as CSSProperties}
          >
            <span className="block text-[11px] font-semibold tracking-[0.16em] opacity-70">规划记录</span>
            <span className="mt-1 block text-[13px] font-semibold leading-5">
              {meta ? `${meta.city ?? meta.province ?? '待指定城市'} · ${meta.source}` : session.title}
            </span>
            {meta && (
              <span className="mt-1 block text-[10px] font-semibold leading-4 opacity-70">
                {meta.status}
              </span>
            )}
            <span className="mt-1 block text-[11px] leading-4 opacity-75">
              ¥{route.totalCost} · {route.stops.length}站
            </span>
            {session.profileNote && session.profileNote !== '暂无长期偏好' && (
              <span className="mt-1 line-clamp-2 block text-[10px] leading-4 opacity-70">
                偏好：{session.profileNote}
              </span>
            )}
          </button>
        );
      })}
    </aside>
  );
}

function JudgeAppendix({ session, route }: { session: PlannerSession; route: Route }) {
  const plan = session.plan;
  return (
    <section className="mx-auto mt-4 max-w-[1480px] rounded-lg border border-[#201B16]/20 bg-[#FFFDF8] p-4 shadow-[0_12px_24px_rgba(68,50,31,.08)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">规划依据</p>
          <h2 className="text-[22px] font-semibold text-[#201B16]">动态链路与校验记录</h2>
        </div>
        <span className="rounded-full border border-[#D8C6A8] bg-[#F7F0E2] px-3 py-1 text-[12px] font-medium text-[#665744]">
          parseConstraints → retrieveCandidates → scorePOIs → buildRouteCandidates → validateRoute → repair/replan → explainRoute
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AgentTrace trace={plan.agentTrace ?? []} />
        <div className="space-y-4">
          <DataSourceCard plan={plan} />

          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-3">
            <div className="mb-2 flex items-center gap-2">
              <SlidersHorizontal size={16} strokeWidth={1.6} />
              <h3 className="font-semibold">候选 POI 打分 Top 8</h3>
            </div>
            <div className="space-y-2">
              {plan.candidates.slice(0, 8).map((candidate) => (
                <div key={candidate.poi.id} className="rounded-lg border border-[#E4D5BE] bg-[#FFFDF8] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold">{candidate.poi.name}</span>
                    <span className="tnum rounded bg-[#F7C948] px-2 py-0.5 text-[11px] font-bold">{Math.round(candidate.score)}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[11px] text-[#776755]">{candidate.reasons.join(' / ')}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-3">
            <div className="mb-2 flex items-center gap-2">
              <BadgeCheck size={16} strokeWidth={1.6} />
              <h3 className="font-semibold">校验与修复</h3>
            </div>
            <div className="space-y-2">
              {route.checks.map((check) => (
                <div key={check.key} className="text-[12px] leading-5 text-[#665744]">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(check.status)}`}>
                    {checkMark(check.status)}
                  </span>
                  {check.label}：{check.detail}
                </div>
              ))}
              {(plan.repairLog ?? []).map((log) => (
                <div key={log.round} className="rounded-lg bg-[#F1F8EA] p-2 text-[12px] leading-5 text-[#426D32]">
                  第 {log.round} 轮：{log.action}，{log.before} → {log.after}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DataSourceCard({ plan }: { plan: PlanResult }) {
  const [amapStatus, setAmapStatus] = useState<'checking' | 'configured' | 'not_configured' | 'unreachable'>('checking');
  const usesAmapPoi = plan.candidates.some((candidate) => candidate.poi.source === 'amap');
  const meta = plan.backendMeta;
  const backendDataSources = meta?.dataSources ?? {};
  const backendSource = meta?.source ?? (usesAmapPoi ? 'amap-local-rules' : 'local-mock');
  const locationResolution = meta?.locationResolution as BackendPlanResponse['locationResolution'] | undefined;

  useEffect(() => {
    let alive = true;
    fetch('/api/amap/poi-search?keyword=status&city=上海&limit=1')
      .then(async (res) => {
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) return null;
        return res.json();
      })
      .then((data) => {
        if (!alive) return;
        if (!data) setAmapStatus('unreachable');
        else if (data.configured) setAmapStatus('configured');
        else if (data.status === 'not_configured') setAmapStatus('not_configured');
        else setAmapStatus('unreachable');
      })
      .catch(() => {
        if (alive) setAmapStatus('unreachable');
      });
    return () => {
      alive = false;
    };
  }, []);

  const apiLabel = amapStatus === 'configured'
    ? '已配置'
    : amapStatus === 'checking'
      ? '检测中'
      : '未配置';
  const apiTone = amapStatus === 'configured'
    ? 'bg-emerald-100 text-emerald-800'
    : 'bg-amber-100 text-amber-800';

  return (
    <div className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Database size={16} strokeWidth={1.6} />
        <h3 className="font-semibold">数据来源与当前能力</h3>
      </div>
      <div className="space-y-2 text-[12px] leading-5 text-[#665744]">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFFDF8] p-2">
            <span className="text-[11px] text-[#8A765F]">高德 API</span>
            <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${apiTone}`}>
              {apiLabel}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFFDF8] p-2">
            <span className="text-[11px] text-[#8A765F]">当前路线数据源</span>
            <p className="mt-1 font-semibold text-[#201B16]">
              {backendSource}
            </p>
          </div>
        </div>
        <p>
          {meta
            ? '当前新规划由统一后端接口返回：先解析城市/偏好，再调用高德 POI，成功后交给 DeepSeek 生成旅行书 JSON，并由前端展示稳定结构。'
            : usesAmapPoi
              ? '当前这条非上海试验路线使用高德真实 POI 名称、地址与坐标；人均、排队、UGC、偏好解释仍由本地规则估算。'
              : '当前是历史/离线 demo 路线，使用本地 mock POI 保证初始演示稳定。'}
        </p>
        <p>
          链路为 {meta ? '/api/ai/plan → Location Resolver → 高德行政区/POI → DeepSeek JSON → route checks → frontend adapter' : 'parseConstraints → retrieveCandidates → scorePOIs → buildRouteCandidates → validateRoute → repair/replan → explainRoute'}。
        </p>
        {locationResolution?.resolutionPath?.length ? (
          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFFDF8] p-2">
            <span className="text-[11px] text-[#8A765F]">地名解析路径</span>
            <p className="mt-1 text-[12px] font-semibold text-[#201B16]">
              {locationResolution.resolutionPath.join(' → ')}
            </p>
          </div>
        ) : null}
        <p>
          高德环境变量支持 AMAP_API_KEY / GAODE_API_KEY / AMAP_KEY；DeepSeek 使用 DEEPSEEK_API_KEY 和 DEEPSEEK_MODEL。
          当前没有接入美团/点评真实交易、排队、UGC 或团购数据。
        </p>
        {meta && (
          <details>
            <summary className="cursor-pointer font-semibold text-[#4F4233]">查看后端数据源明细</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[#F7F0E2] p-2 text-[11px] leading-5">
              {JSON.stringify({
                status: meta.status,
                source: meta.source,
                city: meta.city,
                province: meta.province,
                district: meta.district,
                anchors: meta.anchors,
                locationResolution,
                dataSources: backendDataSources,
                planningBasis: meta.planningBasis,
                preferenceImpact: meta.preferenceImpact,
                warnings: meta.warnings,
              }, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
