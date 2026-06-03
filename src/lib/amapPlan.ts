import { PERSONA_MAP } from '../data/personas';
import { parseIntent, finalizeConstraints } from '../engine/agent/parseIntent';
import { inferPersona } from '../engine/agent/inferPersona';
import { detectConflict } from '../engine/agent/detectConflict';
import { scorePOIs } from '../engine/scorePOIs';
import { validateRoute, violationsFromChecks } from '../engine/validateRoute';
import { explainRoute } from '../engine/explainRoute';
import { haversineM } from '../engine/geo';
import type {
  AgentTraceStep,
  AgentStageKey,
  Category,
  Constraints,
  LegMode,
  Persona,
  PlanResult,
  POI,
  Route,
  RouteStop,
  SceneTag,
} from '../types';

interface CityGate {
  city: string;
  input: string;
}

interface AmapPoiResult {
  name: string;
  address?: string;
  location?: string;
  type?: string;
  source?: string;
}

interface AmapPoiResponse {
  status: 'ok' | 'not_configured' | 'upstream_error' | 'adapter_error' | 'bad_request';
  configured?: boolean;
  results?: AmapPoiResult[];
}

interface AmapRouteResponse {
  status: 'ok' | 'not_configured' | 'upstream_error' | 'adapter_error' | 'bad_request';
  configured?: boolean;
  result?: {
    distance?: number;
    duration?: number;
    source?: string;
  };
}

const LABELS: Record<AgentStageKey, string> = {
  parseIntent: '意图抽取',
  inferPersona: '画像推断',
  detectConflict: '冲突检测',
  retrieveCandidates: '高德 POI 召回',
  scorePOIs: '本地规则评分',
  planRoute: '路线组合',
  validateConstraints: '约束校验',
  repairIfNeeded: '自动修复',
  explainRoute: '解释生成',
};

const KNOWN_CITY_NAMES = ['杭州', '北京', '深圳', '广州', '南京', '苏州', '成都', '重庆', '武汉', '西安'];

function getAmapCityName(city: string, raw: string): string {
  return KNOWN_CITY_NAMES.find((name) => city.includes(name) || raw.includes(name)) ?? city.split('/')[0] ?? '上海';
}

function getAreaKeyword(raw: string, city: string): string {
  const areaWords = ['余杭', '西湖', '拱墅', '萧山', '滨江', '三里屯', '国贸', '海淀', '南山', '福田', '天河', '新街口', '姑苏', '太古里'];
  return areaWords.find((word) => raw.includes(word)) ?? city.split('/')[1] ?? '';
}

function queryKeywords(raw: string): string[] {
  const words = new Set<string>();
  if (/吃饭|晚饭|午饭|美食|餐|好吃/.test(raw)) words.add('美食');
  if (/咖啡|茶|下午茶|接电话|安静|坐/.test(raw)) words.add('咖啡');
  if (/博物馆|美术馆|文化|文艺|历史|展|逛逛|citywalk/.test(raw)) words.add('景点');
  if (/拍照|出片|打卡|citywalk|逛逛/.test(raw)) words.add('公园');
  if (/购物|商场|买/.test(raw)) words.add('商场');
  if (/玩|朋友|聚会|热闹/.test(raw)) words.add('娱乐');
  if (!words.size) ['景点', '美食', '咖啡', '商场'].forEach((word) => words.add(word));
  return [...words].slice(0, 5);
}

function parseLocation(location?: string): { lng: number; lat: number } | null {
  if (!location) return null;
  const [lngRaw, latRaw] = location.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function inferCategory(name: string, type = ''): Category {
  const text = `${name} ${type}`;
  if (/餐饮|美食|中餐|西餐|火锅|烧烤|小吃|面馆|饭店|酒楼|餐厅|菜馆|食府/.test(text)) return 'dining';
  if (/咖啡|茶|奶茶|甜品|饮品|面包|烘焙/.test(text)) return 'cafe';
  if (/博物馆|美术馆|展览|图书馆|书店|文化|景点|名胜|古迹|公园|广场|风景|寺|古城|遗址/.test(text)) return 'culture';
  if (/影院|剧场|KTV|桌游|密室|娱乐|游乐|Live|酒吧|运动|健身/.test(text)) return 'entertainment';
  if (/商场|购物|百货|奥特莱斯|市场|商业|超市|综合体/.test(text)) return 'shopping';
  if (/夜景|酒吧|江景|湖景|观景|夜游|灯光/.test(text)) return 'nightscape';
  return 'culture';
}

function tagsFor(category: Category, raw: string, name: string, type = ''): SceneTag[] {
  const tags = new Set<SceneTag>(['local']);
  const text = `${raw} ${name} ${type}`;
  if (/安静|接电话|咖啡|茶/.test(text)) tags.add('quiet');
  if (/朋友|热闹|娱乐|聚会|商场/.test(text)) tags.add('lively');
  if (/拍照|出片|公园|景点|风景|古城|遗址|湖|江/.test(text)) tags.add('photo');
  if (/文艺|文化|博物馆|美术馆|书店|历史|古城|遗址/.test(text)) tags.add('cultural');
  if (/亲子|儿童|乐园/.test(text)) tags.add('family');
  if (/酒吧|夜景|夜游/.test(text)) tags.add('nightlife');
  if (/便宜|实惠|预算|小吃/.test(text)) tags.add('budget');
  if (/餐|美食|小吃|菜|面|火锅/.test(text)) tags.add('foodie');
  if (category === 'culture') tags.add('cultural');
  if (category === 'shopping') tags.add('trendy');
  if (category === 'nightscape') tags.add('photo');
  return [...tags];
}

function estimatePrice(category: Category, budget: number | null, index: number): number {
  const base: Record<Category, number> = {
    dining: 88,
    cafe: 38,
    culture: 28,
    entertainment: 76,
    shopping: 20,
    nightscape: 0,
  };
  const value = base[category] + (index % 3) * 8;
  if (budget == null) return value;
  return Math.max(0, Math.min(value, Math.round(budget * (category === 'dining' ? 0.55 : 0.35))));
}

function durationFor(category: Category): number {
  const map: Record<Category, number> = {
    dining: 75,
    cafe: 55,
    culture: 70,
    entertainment: 90,
    shopping: 60,
    nightscape: 45,
  };
  return map[category];
}

function queueFor(category: Category, index: number): number {
  const base: Record<Category, number> = {
    dining: 0.52,
    cafe: 0.34,
    culture: 0.28,
    entertainment: 0.4,
    shopping: 0.36,
    nightscape: 0.25,
  };
  return Math.min(0.72, base[category] + (index % 4) * 0.04);
}

function toPoi(item: AmapPoiResult, index: number, constraints: Constraints): POI | null {
  const loc = parseLocation(item.location);
  if (!loc || !item.name) return null;
  const category = inferCategory(item.name, item.type);
  return {
    id: `amap-${loc.lng}-${loc.lat}-${index}`,
    name: item.name,
    category,
    area: getAreaKeyword(constraints.raw, constraints.city) || constraints.city,
    lat: loc.lat,
    lng: loc.lng,
    rating: +(4.2 + (index % 5) * 0.08).toFixed(1),
    reviews: 800 + index * 137,
    perCapita: estimatePrice(category, constraints.budgetPerCapita, index),
    openHour: category === 'nightscape' ? 16 : 9,
    closeHour: category === 'nightscape' || category === 'entertainment' ? 24 : 22,
    avgDuration: durationFor(category),
    sceneTags: tagsFor(category, constraints.raw, item.name, item.type),
    ugc: `高德真实 POI：${item.address || item.type || '地址待确认'}；价格/排队/偏好解释为本地规则估算`,
    queueBase: queueFor(category, index),
    source: 'amap',
    confidence: 0.92,
    freshness: 'realtime',
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

async function retrieveAmapPois(raw: string, city: string, area: string): Promise<{ pois: AmapPoiResult[]; configured: boolean }> {
  const found: AmapPoiResult[] = [];
  let configured = false;
  const seen = new Set<string>();
  for (const keyword of queryKeywords(raw)) {
    const params = new URLSearchParams({
      keyword,
      city,
      area,
      limit: '8',
    });
    const data = await fetchJson(`/api/amap/poi-search?${params.toString()}`) as AmapPoiResponse | null;
    if (!data || data.status === 'not_configured') return { pois: [], configured: false };
    if (data.status === 'ok' && data.configured) configured = true;
    for (const item of data.results ?? []) {
      const key = `${item.name}-${item.location}`;
      if (!item.location || seen.has(key)) continue;
      seen.add(key);
      found.push(item);
    }
  }
  return { pois: found.slice(0, 24), configured };
}

function chooseStops(candidates: ReturnType<typeof scorePOIs>, constraints: Constraints) {
  const picks = [];
  const used = new Set<string>();
  const desired: Category[] = [
    ...constraints.mustCategories,
    'culture',
    'dining',
    'cafe',
    'shopping',
    'entertainment',
    'nightscape',
  ];
  for (const category of desired) {
    const hit = candidates.find((item) => item.poi.category === category && !used.has(item.poi.id));
    if (!hit) continue;
    picks.push(hit);
    used.add(hit.poi.id);
    if (picks.length >= 4) break;
  }
  for (const item of candidates) {
    if (picks.length >= 4) break;
    if (used.has(item.poi.id)) continue;
    picks.push(item);
    used.add(item.poi.id);
  }
  return picks.slice(0, Math.max(3, Math.min(4, picks.length)));
}

function fallbackLeg(from: POI, to: POI): { distM: number; minutes: number; mode: LegMode; etaSource: 'amap'; etaConfidence: number } {
  const distM = Math.round(haversineM(from.lat, from.lng, to.lat, to.lng));
  const walkMinutes = Math.max(3, Math.round(distM / 80));
  if (walkMinutes > 28) {
    return { distM, minutes: Math.max(12, Math.round(walkMinutes * 0.45)), mode: 'transit', etaSource: 'amap', etaConfidence: 0.55 };
  }
  return { distM, minutes: walkMinutes, mode: 'walk', etaSource: 'amap', etaConfidence: 0.65 };
}

async function estimateLeg(from: POI, to: POI) {
  const origin = `${from.lng},${from.lat}`;
  const destination = `${to.lng},${to.lat}`;
  const params = new URLSearchParams({ origin, destination });
  const data = await fetchJson(`/api/amap/route-walking?${params.toString()}`) as AmapRouteResponse | null;
  if (data?.status === 'ok' && data.result?.distance != null && data.result.duration != null) {
    const distM = Math.round(data.result.distance);
    const minutes = Math.max(2, Math.round(data.result.duration));
    const mode: LegMode = minutes > 28 ? 'transit' : 'walk';
    return { distM, minutes, mode, etaSource: 'amap' as const, etaConfidence: 0.9 };
  }
  return fallbackLeg(from, to);
}

async function buildRoute(stops: ReturnType<typeof chooseStops>, constraints: Constraints, persona: Persona): Promise<Route> {
  const routeStops: RouteStop[] = [];
  let cursor = constraints.startTime;
  let totalWalkMin = 0;
  let totalTransitMin = 0;

  for (let index = 0; index < stops.length; index += 1) {
    const scored = stops[index];
    let leg: RouteStop['legFromPrev'] = null;
    if (index > 0) {
      const prev = stops[index - 1].poi;
      const next = scored.poi;
      const estimated = await estimateLeg(prev, next);
      leg = estimated;
      cursor += estimated.minutes / 60;
      if (estimated.mode === 'walk') totalWalkMin += estimated.minutes;
      else totalTransitMin += estimated.minutes;
    }
    const arrive = cursor;
    const depart = arrive + scored.poi.avgDuration / 60;
    routeStops.push({ scored, arrive, depart, legFromPrev: leg });
    cursor = depart;
  }

  const route: Route = {
    id: 'amap-route-0',
    stops: routeStops,
    totalCost: Math.round(routeStops.reduce((sum, stop) => sum + stop.scored.poi.perCapita, 0)),
    totalWalkMin,
    totalTransitMin,
    endTime: cursor,
    score: +(routeStops.reduce((sum, stop) => sum + stop.scored.score, 0) / Math.max(1, routeStops.length)).toFixed(1),
    checks: [],
    coverage: [...new Set(routeStops.map((stop) => stop.scored.poi.category))],
    explanation: '',
    risks: [],
  };
  const checks = validateRoute(route, constraints, persona);
  const violations = violationsFromChecks(route, checks);
  const explained = explainRoute({ ...route, checks, violations }, constraints, persona);
  return {
    ...route,
    checks,
    violations,
    explanation: `高德真实 POI 试验路线 · ${explained.explanation}`,
    risks: [
      'POI 名称与地址来自高德真实 POI；人均、排队、UGC 与偏好解释仍为本地规则估算。',
      '当前未接入美团/点评真实交易、排队、团购或点评 UGC 数据。',
      ...explained.risks.filter((risk) => !risk.includes('当前路线各项约束均通过')),
    ].slice(0, 6),
  };
}

function traceStep(
  trace: AgentTraceStep[],
  key: AgentStageKey,
  input: string,
  output: string,
  ms: number,
  status: AgentTraceStep['status'] = 'ok',
) {
  trace.push({ key, label: LABELS[key], input, output, ms, status });
}

export async function buildAmapCityPlan(
  raw: string,
  gate: CityGate,
  manualPersona?: Persona,
): Promise<PlanResult | null> {
  const trace: AgentTraceStep[] = [];
  const timings = { parse: 0, retrieve: 0, score: 0, build: 0, validate: 0, rank: 0, explain: 0 };

  const tParse = performance.now();
  const intent = parseIntent(raw);
  intent.city = gate.city;
  intent.matched = [...new Set([gate.city, ...intent.matched])];
  timings.parse = +(performance.now() - tParse).toFixed(2);
  traceStep(trace, 'parseIntent', raw, `识别非上海城市:${gate.city}`, timings.parse);

  const personaInference = inferPersona(intent);
  traceStep(trace, 'inferPersona', intent.matched.join(' / ') || raw, `${PERSONA_MAP[personaInference.personaId]?.label ?? personaInference.personaId} · ${Math.round(personaInference.confidence * 100)}%`, 0);

  const conflict = detectConflict(personaInference, manualPersona?.id);
  const persona = PERSONA_MAP[conflict.resolvedPersonaId] ?? manualPersona ?? PERSONA_MAP.solo;
  traceStep(trace, 'detectConflict', manualPersona?.label ?? '未手动指定', conflict.message, 0, conflict.hasConflict ? 'fallback' : 'ok');

  const constraints = {
    ...finalizeConstraints(intent, persona),
    city: gate.city,
    raw,
  };
  const amapCity = getAmapCityName(gate.city, raw);
  const area = getAreaKeyword(raw, gate.city);

  const tRetrieve = performance.now();
  const retrieved = await retrieveAmapPois(raw, amapCity, area);
  timings.retrieve = +(performance.now() - tRetrieve).toFixed(2);
  if (!retrieved.configured || retrieved.pois.length < 3) return null;
  traceStep(trace, 'retrieveCandidates', `${amapCity}${area ? ` · ${area}` : ''}`, `高德返回 ${retrieved.pois.length} 个真实 POI`, timings.retrieve);

  const pois = retrieved.pois
    .map((item, index) => toPoi(item, index, constraints))
    .filter((item): item is POI => Boolean(item));
  if (pois.length < 3) return null;
  const center = pois.reduce((acc, poi) => ({ lat: acc.lat + poi.lat, lng: acc.lng + poi.lng }), { lat: 0, lng: 0 });
  const centerLat = center.lat / pois.length;
  const centerLng = center.lng / pois.length;

  const tScore = performance.now();
  const candidates = scorePOIs(pois, constraints, persona, centerLat, centerLng);
  timings.score = +(performance.now() - tScore).toFixed(2);
  traceStep(trace, 'scorePOIs', `${pois.length} 个高德 POI`, '按画像/预算/偏好做本地规则评分', timings.score);

  const tBuild = performance.now();
  const selected = chooseStops(candidates, constraints);
  if (selected.length < 3) return null;
  const route = await buildRoute(selected, constraints, persona);
  timings.build = +(performance.now() - tBuild).toFixed(2);
  timings.validate = 0;
  timings.explain = 0;
  traceStep(trace, 'planRoute', '高德候选 + 类目覆盖', selected.map((item) => item.poi.name).join(' → '), timings.build);
  traceStep(trace, 'validateConstraints', `${selected.length} 个真实 POI`, route.checks.map((check) => `${check.key}:${check.status}`).join(','), 0);
  traceStep(trace, 'repairIfNeeded', '真实 POI 试验路线', '不做自动修复,保留透明提示', 0, 'skip');
  traceStep(trace, 'explainRoute', route.id, '生成数据源说明与风险提示', 0);

  return {
    constraints,
    candidates,
    routes: [route],
    personaId: persona.id,
    resolvedPersonaId: persona.id,
    stageTimings: timings,
    intent,
    personaInference,
    conflict,
    agentTrace: trace,
    repairLog: [],
    slotPlan: route.coverage,
    retrieveNote: `非上海试验链路:POI 来自高德 Web 服务(${amapCity}${area ? `/${area}` : ''});价格、排队、偏好解释仍由本地规则估算。`,
  };
}
