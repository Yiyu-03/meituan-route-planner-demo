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
  RepairLog,
  Route,
  RouteStop,
  ScoredPOI,
  SceneTag,
} from '../types';
import { CATEGORY_LABEL } from '../types';

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

interface AmapFetchOptions {
  timeoutMs?: number;
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
const ADULT_OR_NOISY_POI_RE = /KTV|量贩|歌厅|舞厅|歌舞|夜店|酒吧|清吧|酒廊|迪厅|蹦迪|电玩|电玩城|电子游戏|网吧|棋牌|麻将|洗浴|足浴|按摩|SPA|桑拿|会所|夜总会|台球|桌球/i;
const EXPLICIT_ADULT_OR_NOISY_RE = /KTV|唱歌|酒吧|夜生活|蹦迪|电玩|电玩城|游戏厅|舞厅|LiveHouse|livehouse|小酌|喝一杯|夜店|按摩|洗浴/i;
const CULTURE_WALK_RE = /园区转转|园林|博物馆|博物院|美术馆|展览|展馆|逛|citywalk|文艺|文化|历史|公园|街区|古镇|安静|轻松|西湖/;
const MEAL_RE = /吃饭|午饭|午餐|晚饭|晚餐|美食|餐厅|正餐|吃点/;
const LOW_TRUST_AMAP_RE = /私人影院|工作室|量贩|会所|KTV|歌厅|舞厅|酒吧|夜店|洗浴|按摩|足浴|电玩|电玩城|棋牌|麻将|网吧|饮食店|快餐|便利店|小卖部|食杂|成人|养生|采耳/i;
const NON_ROUTE_PLACE_RE = /酒店|宾馆|学校|小学|中学|大学|幼儿园|写字楼|产业园区|商务住宅|售楼|停车场|政府机构/i;
const ODD_DINING_RE = /游轮|码头|酒店|宾馆|咖啡厅|咖啡店|茶饮|奶茶|甜品/i;
const UNAVAILABLE_POI_RE = /暂停开放|停止开放|临时闭馆|闭馆|已关闭|停业|歇业/i;
const TRUSTED_DINING_RE = /餐厅|中餐|西餐|本帮|杭帮|苏帮|菜馆|酒楼|饭店|食府|火锅|烧烤|面馆|茶餐厅|咖啡|轻食|小馆/;
const TRUSTED_CULTURE_RE = /园林|博物馆|博物院|美术馆|展馆|展览馆|纪念馆|图书馆|艺术馆|公园|景区|风景|名胜|古迹|历史|文化|西湖|湖|街区|古镇/;
const POI_SEARCH_TIMEOUT_MS = 3600;
const ROUTE_WALK_TIMEOUT_MS = 900;
const MAX_LEG_DISTANCE_M = 12000;
const MAX_LEG_MINUTES = 45;
const MAX_WALK_MINUTES = 25;
const AREA_RADIUS_M = 6500;
const CITY_RADIUS_M = 22000;

const AREA_CENTERS: Record<string, { lng: number; lat: number; aliases: string[] }> = {
  suzhou_industrial_park: {
    lng: 120.706,
    lat: 31.318,
    aliases: ['苏州工业园区', '工业园区', '园区', '金鸡湖', '东方之门', '诚品'],
  },
  hangzhou_westlake: {
    lng: 120.145,
    lat: 30.252,
    aliases: ['西湖', '西湖附近', '湖滨', '断桥', '孤山'],
  },
};

function getAmapCityName(city: string, raw: string): string {
  return KNOWN_CITY_NAMES.find((name) => city.includes(name) || raw.includes(name)) ?? city.split('/')[0] ?? '上海';
}

function getAreaKeyword(raw: string, city: string): string {
  if (/苏州/.test(raw) && /工业园区|园区|金鸡湖|东方之门|诚品/.test(raw)) return '苏州工业园区 金鸡湖';
  if (/杭州/.test(raw) && /西湖|湖滨|断桥|孤山/.test(raw)) return '西湖附近';
  const areaWords = ['余杭', '西湖', '拱墅', '萧山', '滨江', '三里屯', '国贸', '海淀', '南山', '福田', '天河', '新街口', '姑苏', '工业园区', '园区', '金鸡湖', '太古里'];
  return areaWords.find((word) => raw.includes(word)) ?? city.split('/')[1] ?? '';
}

function areaCenterFor(raw: string): { lng: number; lat: number; radiusM: number; label: string } | null {
  for (const [label, center] of Object.entries(AREA_CENTERS)) {
    if (center.aliases.some((alias) => raw.includes(alias))) {
      return { lng: center.lng, lat: center.lat, radiusM: AREA_RADIUS_M, label };
    }
  }
  return null;
}

function poiDistanceToAreaM(poi: POI, areaCenter: { lng: number; lat: number } | null): number {
  if (!areaCenter) return 0;
  return Math.round(haversineM(areaCenter.lat, areaCenter.lng, poi.lat, poi.lng));
}

function hasCultureWalkIntent(raw: string): boolean {
  return CULTURE_WALK_RE.test(raw);
}

function wantsAdultOrNoisy(raw: string): boolean {
  return EXPLICIT_ADULT_OR_NOISY_RE.test(raw);
}

function wantsMeal(raw: string): boolean {
  return MEAL_RE.test(raw);
}

function allowsTwoMeals(raw: string): boolean {
  return /两顿|两餐|午饭.*晚饭|晚饭.*午饭|午餐.*晚餐|晚餐.*午餐/.test(raw);
}

function queryKeywords(raw: string): string[] {
  const words = new Set<string>();
  if (wantsMeal(raw)) {
    words.add('美食');
    words.add('餐厅');
  }
  if (hasCultureWalkIntent(raw)) {
    ['园林', '博物馆', '文化景点', '公园'].forEach((word) => words.add(word));
    words.add('咖啡');
  }
  if (/咖啡|茶|下午茶|接电话|安静|轻松|坐/.test(raw)) words.add('咖啡');
  if (/博物馆|美术馆|文化|文艺|历史|展|逛逛|citywalk/.test(raw)) words.add('景点');
  if (/拍照|出片|打卡|citywalk|逛逛/.test(raw)) words.add('公园');
  if (/购物|商场|买/.test(raw)) words.add('商场');
  if (/KTV|唱歌|密室|桌游|电影|影院|剧场|电玩|酒吧|夜生活|蹦迪|LiveHouse|livehouse/.test(raw)) words.add('娱乐');
  if (!words.size) ['景点', '美食', '咖啡', '商场'].forEach((word) => words.add(word));
  return [...words].slice(0, 7);
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
  if (/咖啡|茶饮|奶茶|甜品|饮品|面包|烘焙|下午茶/.test(text)) return 'cafe';
  if (/餐饮|美食|中餐|西餐|火锅|烧烤|小吃|面馆|饭店|酒楼|餐厅|菜馆|食府/.test(text)) return 'dining';
  if (/购物|商场|百货|奥特莱斯|市场|商业|超市|综合体/.test(text)) return 'shopping';
  if (/博物馆|博物院|美术馆|展览|展馆|图书馆|书店|文化|景点|名胜|古迹|园林|园区|公园|广场|风景|寺|古城|古镇|街区|遗址|纪念馆|艺术馆/.test(text)) return 'culture';
  if (/影院|剧场|KTV|桌游|密室|娱乐|游乐|Live|live|酒吧|运动|健身|电玩|舞厅/.test(text)) return 'entertainment';
  if (/夜景|酒吧|江景|湖景|观景|夜游|灯光/.test(text)) return 'nightscape';
  return 'culture';
}

function tagsFor(category: Category, raw: string, name: string, type = ''): SceneTag[] {
  const tags = new Set<SceneTag>(['local']);
  const text = `${raw} ${name} ${type}`;
  if (/安静|接电话|咖啡|茶/.test(text)) tags.add('quiet');
  if (/朋友|热闹|娱乐|聚会|商场/.test(text)) tags.add('lively');
  if (/拍照|出片|公园|景点|风景|古城|遗址|湖|江/.test(text)) tags.add('photo');
  if (/文艺|文化|博物馆|博物院|美术馆|书店|历史|园林|古城|古镇|街区|遗址/.test(text)) tags.add('cultural');
  if (/园林|公园|湖|江|绿地|湿地/.test(text)) tags.add('nature');
  if (/亲子|儿童|乐园/.test(text)) tags.add('family');
  if (/酒吧|夜景|夜游/.test(text)) tags.add('nightlife');
  if (/便宜|实惠|预算|小吃/.test(text)) tags.add('budget');
  if (/餐|美食|小吃|菜|面|火锅/.test(text)) tags.add('foodie');
  if (category === 'culture') tags.add('cultural');
  if (category === 'shopping') tags.add('trendy');
  if (category === 'nightscape') tags.add('photo');
  return [...tags];
}

function estimatePrice(category: Category, constraints: Constraints, index: number): number {
  const base: Record<Category, number> = {
    dining: 88,
    cafe: 38,
    culture: 28,
    entertainment: 76,
    shopping: 20,
    nightscape: 0,
  };
  const value = base[category] + (index % 3) * 8;
  if (constraints.budgetPerCapita == null && constraints.diningBudgetPerCapita == null) return value;
  if (category === 'dining' && constraints.diningBudgetPerCapita != null) {
    return Math.max(0, Math.min(value, Math.round(constraints.diningBudgetPerCapita * 0.7)));
  }
  return value;
}

function durationFor(category: Category): number {
  const map: Record<Category, number> = {
    dining: 70,
    cafe: 40,
    culture: 75,
    entertainment: 90,
    shopping: 60,
    nightscape: 45,
  };
  return map[category];
}

function isBlockedAmapPoi(poi: POI, constraints: Constraints): boolean {
  const text = `${poi.name} ${poi.ugc}`;
  const explicitNoisy = wantsAdultOrNoisy(constraints.raw);
  if (UNAVAILABLE_POI_RE.test(text)) return true;
  if (ADULT_OR_NOISY_POI_RE.test(text) && !explicitNoisy) return true;
  if (LOW_TRUST_AMAP_RE.test(text) && !explicitNoisy) return true;
  if (poi.category === 'dining' && wantsMeal(constraints.raw) && ODD_DINING_RE.test(text)) return true;
  if (NON_ROUTE_PLACE_RE.test(text) && poi.category !== 'dining' && poi.category !== 'cafe') return true;
  if (hasCultureWalkIntent(constraints.raw) && !explicitNoisy && (poi.category === 'entertainment' || poi.category === 'nightscape')) return true;
  if ((constraints.prefs.includes('quiet') || /安静|接电话|打电话|开会/.test(constraints.raw)) && !explicitNoisy && poi.category === 'entertainment') return true;
  return false;
}

function amapQualityScore(item: AmapPoiResult, category: Category, constraints: Constraints, index: number): {
  rating: number;
  reviews: number;
  pass: boolean;
} {
  const text = `${item.name} ${item.type ?? ''} ${item.address ?? ''}`;
  const intentMatch =
    (category === 'culture' && TRUSTED_CULTURE_RE.test(text))
    || (category === 'dining' && TRUSTED_DINING_RE.test(text))
    || (category === 'cafe' && /咖啡|茶|甜品|饮品|轻食/.test(text))
    || (!hasCultureWalkIntent(constraints.raw) && category !== 'entertainment');
  const lowTrust = LOW_TRUST_AMAP_RE.test(text);
  const rating = +(lowTrust ? 4.0 : intentMatch ? 4.55 - (index % 3) * 0.04 : 4.32 - (index % 3) * 0.04).toFixed(1);
  const reviews = lowTrust ? 180 + index * 23 : intentMatch ? 1200 + index * 173 : 620 + index * 91;
  return {
    rating,
    reviews,
    pass: rating >= 4.3 && reviews >= 500 && intentMatch && !lowTrust,
  };
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
  const quality = amapQualityScore(item, category, constraints, index);
  return {
    id: `amap-${loc.lng}-${loc.lat}-${index}`,
    name: item.name,
    category,
    area: getAreaKeyword(constraints.raw, constraints.city) || constraints.city,
    lat: loc.lat,
    lng: loc.lng,
    rating: quality.rating,
    reviews: quality.reviews,
    perCapita: estimatePrice(category, constraints, index),
    openHour: category === 'nightscape' ? 16 : 9,
    closeHour: category === 'nightscape' || category === 'entertainment' ? 24 : 22,
    avgDuration: durationFor(category),
    sceneTags: tagsFor(category, constraints.raw, item.name, item.type),
    ugc: `高德真实 POI：${[item.address, item.type].filter(Boolean).join('；') || '地址待确认'}；价格/排队/偏好解释为本地规则估算`,
    queueBase: queueFor(category, index),
    source: 'amap',
    confidence: 0.92,
    freshness: 'realtime',
  };
}

function matchesAmapIntent(poi: POI, constraints: Constraints): boolean {
  const text = `${poi.name} ${poi.ugc}`;
  if (poi.category === 'culture') return TRUSTED_CULTURE_RE.test(text);
  if (poi.category === 'dining') return TRUSTED_DINING_RE.test(text);
  if (poi.category === 'cafe') return /咖啡|茶|甜品|饮品|轻食/.test(text);
  if (hasCultureWalkIntent(constraints.raw)) return false;
  return true;
}

function passesAmapQuality(poi: POI, constraints: Constraints): boolean {
  if (isBlockedAmapPoi(poi, constraints)) return false;
  if (poi.rating < 4.3 || poi.reviews < 500) return false;
  return matchesAmapIntent(poi, constraints);
}

async function fetchJson(url: string, options: AmapFetchOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? POI_SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function retrieveAmapPois(raw: string, city: string, area: string): Promise<{ pois: AmapPoiResult[]; configured: boolean }> {
  const found: AmapPoiResult[] = [];
  let configured = false;
  const seen = new Set<string>();
  const responses = await Promise.all(queryKeywords(raw).map(async (keyword) => {
    const params = new URLSearchParams({
      keyword,
      city,
      area,
      limit: '8',
    });
    return fetchJson(`/api/amap/poi-search?${params.toString()}`, { timeoutMs: POI_SEARCH_TIMEOUT_MS }) as Promise<AmapPoiResponse | null>;
  }));

  for (const data of responses) {
    if (!data) continue;
    if (data.status === 'not_configured') return { pois: [], configured: false };
    if (data.status === 'ok' && data.configured) configured = true;
    for (const item of data.results ?? []) {
      const key = `${item.name}-${item.location}`;
      if (!item.location || seen.has(key)) continue;
      seen.add(key);
      found.push(item);
    }
  }
  if (!found.length) return { pois: [], configured };
  return { pois: found.slice(0, 36), configured };
}

function mealWindow(constraints: Constraints): { start: number; end: number; label: '午饭' | '晚饭' } | null {
  const raw = constraints.raw;
  if (/午饭|午餐|中午/.test(raw) || (constraints.startTime < 13.5 && wantsMeal(raw))) {
    return { start: 11.5, end: 13.5, label: '午饭' };
  }
  if (/晚饭|晚餐|晚上.*吃|傍晚.*吃/.test(raw) || (constraints.startTime >= 16 && wantsMeal(raw))) {
    return { start: 17.5, end: 19.5, label: '晚饭' };
  }
  return null;
}

function targetStopCount(constraints: Constraints): number {
  const hours = constraints.durationMin / 60;
  if (hours <= 1.6) return 1;
  if (hours <= 2) return 2;
  if (constraints.pace === 'relaxed' && hours <= 3.2) return 2;
  if (hours <= 4) return constraints.pace === 'packed' ? 3 : 2;
  if (hours <= 6) return constraints.pace === 'packed' ? 4 : 3;
  return 4;
}

function categorySlots(constraints: Constraints, target: number): Category[] {
  const meal = mealWindow(constraints);
  const cultural = hasCultureWalkIntent(constraints.raw);
  const explicitEntertainment = wantsAdultOrNoisy(constraints.raw) || /密室|桌游|电影|影院|剧场|游乐|演出/.test(constraints.raw);

  if (cultural && meal) {
    const slots: Category[] = ['culture', 'dining', 'culture', 'cafe'];
    return slots.slice(0, target);
  }
  if (cultural) {
    const slots: Category[] = ['culture', 'culture', 'cafe', 'shopping'];
    return slots.slice(0, target);
  }
  if (meal) {
    const slots: Category[] = ['culture', 'dining', 'cafe', 'shopping'];
    return slots.slice(0, target);
  }
  if (explicitEntertainment) {
    const slots: Category[] = ['dining', 'entertainment', 'cafe', 'nightscape'];
    return slots.slice(0, target);
  }
  const slots: Category[] = ['culture', 'cafe', 'shopping', 'dining'];
  return slots.slice(0, target);
}

function chooseStops(candidates: ScoredPOI[], constraints: Constraints) {
  const picks: ScoredPOI[] = [];
  const used = new Set<string>();
  const target = targetStopCount(constraints);
  const desired = categorySlots(constraints, target);
  const allowSecondMeal = allowsTwoMeals(constraints.raw);
  const wantsMuseum = /博物馆|博物院|展馆|展览|美术馆/.test(constraints.raw);
  const wantsGarden = /园林|西湖|公园|景区|风景|逛/.test(constraints.raw);

  const cultureKind = (item: ScoredPOI): 'museum' | 'garden' | 'other' => {
    const text = `${item.poi.name} ${item.poi.ugc}`;
    if (/博物馆|博物院|展馆|展览|美术馆|纪念馆/.test(text)) return 'museum';
    if (/园林|公园|景区|风景|西湖|湖|古镇|街区/.test(text)) return 'garden';
    return 'other';
  };

  for (const category of desired) {
    if (category === 'dining' && !allowSecondMeal && picks.some((item) => item.poi.category === 'dining')) continue;
    let pool = candidates.filter((item) => item.poi.category === category && !used.has(item.poi.id));
    if (category === 'culture' && hasCultureWalkIntent(constraints.raw)) {
      const pickedKinds = new Set(picks.filter((item) => item.poi.category === 'culture').map(cultureKind));
      const preferredKind = wantsMuseum && !pickedKinds.has('museum')
        ? 'museum'
        : wantsGarden && !pickedKinds.has('garden')
          ? 'garden'
          : null;
      if (preferredKind) {
        const preferred = pool.filter((item) => cultureKind(item) === preferredKind);
        if (preferred.length) pool = preferred;
      }
    }
    const hit = pool[0];
    if (!hit) continue;
    picks.push(hit);
    used.add(hit.poi.id);
    if (picks.length >= target) break;
  }

  for (const item of candidates) {
    if (picks.length >= target) break;
    if (used.has(item.poi.id)) continue;
    if (item.poi.category === 'dining' && !allowSecondMeal && picks.some((pick) => pick.poi.category === 'dining')) continue;
    picks.push(item);
    used.add(item.poi.id);
  }
  return picks.slice(0, Math.min(target, picks.length));
}

function fallbackLeg(from: POI, to: POI): { distM: number; minutes: number; mode: LegMode; etaSource: 'amap'; etaConfidence: number } {
  const distM = Math.round(haversineM(from.lat, from.lng, to.lat, to.lng));
  const walkMinutes = Math.max(3, Math.round(distM / 80));
  if (walkMinutes > 28) {
    return { distM, minutes: Math.min(MAX_LEG_MINUTES + 1, Math.max(12, Math.round(walkMinutes * 0.35))), mode: 'transit', etaSource: 'amap', etaConfidence: 0.45 };
  }
  return { distM, minutes: walkMinutes, mode: 'walk', etaSource: 'amap', etaConfidence: 0.65 };
}

function isLegUsable(distM: number, minutes: number, mode: LegMode): boolean {
  if (!Number.isFinite(distM) || !Number.isFinite(minutes)) return false;
  if (distM <= 0 || minutes <= 0) return false;
  if (distM > MAX_LEG_DISTANCE_M) return false;
  if (minutes > MAX_LEG_MINUTES) return false;
  if (mode === 'walk' && minutes > MAX_WALK_MINUTES) return false;
  return true;
}

async function estimateLeg(from: POI, to: POI) {
  const origin = `${from.lng},${from.lat}`;
  const destination = `${to.lng},${to.lat}`;
  const params = new URLSearchParams({ origin, destination });
  const data = await fetchJson(`/api/amap/route-walking?${params.toString()}`, { timeoutMs: ROUTE_WALK_TIMEOUT_MS }) as AmapRouteResponse | null;
  if (data?.status === 'ok' && data.result?.distance != null && data.result.duration != null) {
    const distM = Math.round(data.result.distance);
    const minutes = Math.max(2, Math.round(data.result.duration));
    const mode: LegMode = minutes > 28 ? 'transit' : 'walk';
    if (isLegUsable(distM, minutes, mode)) {
      return { distM, minutes, mode, etaSource: 'amap' as const, etaConfidence: 0.9 };
    }
  }
  return fallbackLeg(from, to);
}

function rewriteAmapReasons(scored: ScoredPOI, constraints: Constraints): ScoredPOI {
  const poi = scored.poi;
  const meal = mealWindow(constraints);
  const reasons: string[] = [];

  if (hasCultureWalkIntent(constraints.raw) && poi.category === 'culture') {
    reasons.push('贴合文化/园林/博物馆偏好');
    if (constraints.startTime <= 11.5) reasons.push('适合上午到达后的轻量游览');
  } else if (poi.category === 'dining' && meal) {
    reasons.push(`${meal.label}安排在饭点，作为这条路线的正餐`);
  } else if (poi.category === 'cafe') {
    reasons.push('作为中途休息点，控制节奏不赶');
  }

  if (poi.source === 'amap') reasons.push('名称与地址来自高德真实 POI');
  const old = scored.reasons.filter((reason) => !reason.startsWith('贴合「'));
  return { ...scored, reasons: [...new Set([...reasons, ...old])].slice(0, 4) };
}

function scoredCost(stops: ScoredPOI[]): number {
  return Math.round(stops.reduce((sum, stop) => sum + stop.poi.perCapita, 0));
}

function mealRequested(constraints: Constraints): boolean {
  return wantsMeal(constraints.raw) || constraints.mustCategories.includes('dining');
}

function amapDowngradeCategories(category: Category, constraints: Constraints): Category[] {
  if (category === 'dining') return mealRequested(constraints) ? [] : ['cafe'];
  if (category === 'nightscape') return ['entertainment', 'cafe', 'culture', 'shopping'];
  if (category === 'entertainment') return ['cafe', 'culture', 'shopping'];
  if (category === 'shopping') return ['dining', 'cafe', 'culture'];
  if (category === 'cafe') return ['culture'];
  return [];
}

function canDropAmapStop(stops: ScoredPOI[], idx: number, constraints: Constraints): boolean {
  const minStops = targetStopCount(constraints) <= 2 ? 2 : 3;
  if (stops.length <= minStops) return false;
  const stop = stops[idx];
  if (stop.poi.category === 'dining' && mealRequested(constraints)) return false;
  const remaining = stops.filter((_, i) => i !== idx);
  for (const cat of constraints.mustCategories) {
    if (!remaining.some((item) => item.poi.category === cat)) return false;
  }
  return true;
}

function repairAmapBudget(
  initial: ScoredPOI[],
  candidates: ScoredPOI[],
  constraints: Constraints,
): { stops: ScoredPOI[]; logs: RepairLog[] } {
  const budget = constraints.budgetPerCapita;
  if (budget == null) return { stops: initial, logs: [] };

  let stops = [...initial];
  const logs: RepairLog[] = [];

  for (let round = 1; round <= 5 && scoredCost(stops) > budget; round += 1) {
    const before = stops.map((stop) => stop.poi.name).join(' → ');
    const beforeCost = scoredCost(stops);
    const used = new Set(stops.map((stop) => stop.poi.id));
    const priced = stops
      .map((stop, idx) => ({ stop, idx }))
      .sort((a, b) => b.stop.poi.perCapita - a.stop.poi.perCapita);
    let action = '';
    let patched = false;

    for (const { stop, idx } of priced) {
      const repl = candidates
        .filter((item) =>
          item.poi.category === stop.poi.category
          && !used.has(item.poi.id)
          && item.poi.perCapita < stop.poi.perCapita)
        .sort((a, b) => a.poi.perCapita - b.poi.perCapita || b.score - a.score)[0];
      if (!repl) continue;
      stops[idx] = repl;
      action = `将${CATEGORY_LABEL[stop.poi.category]}「${stop.poi.name}」换成更低价「${repl.poi.name}」`;
      patched = true;
      break;
    }

    if (!patched) {
      for (const { stop, idx } of priced) {
        const downgradeOrder = amapDowngradeCategories(stop.poi.category, constraints);
        const repl = candidates
          .filter((item) =>
            downgradeOrder.includes(item.poi.category)
            && !used.has(item.poi.id)
            && item.poi.perCapita < stop.poi.perCapita)
          .sort((a, b) =>
            downgradeOrder.indexOf(a.poi.category) - downgradeOrder.indexOf(b.poi.category)
            || a.poi.perCapita - b.poi.perCapita
            || b.score - a.score)[0];
        if (!repl) continue;
        stops[idx] = repl;
        action = `将${CATEGORY_LABEL[stop.poi.category]}「${stop.poi.name}」降档为${CATEGORY_LABEL[repl.poi.category]}「${repl.poi.name}」`;
        patched = true;
        break;
      }
    }

    if (!patched) {
      const drop = priced.find(({ idx }) => canDropAmapStop(stops, idx, constraints));
      if (drop) {
        stops = stops.filter((_, idx) => idx !== drop.idx);
        action = `移除非必要站「${drop.stop.poi.name}」`;
        patched = true;
      }
    }

    if (!patched) {
      const floor = scoredCost(stops);
      logs.push({
        round,
        trigger: '预算',
        action: `该区域内最低约 ¥${floor},建议提高预算或减少站点`,
        before,
        after: before,
        resolved: false,
      });
      break;
    }

    const after = stops.map((stop) => stop.poi.name).join(' → ');
    const afterCost = scoredCost(stops);
    logs.push({
      round,
      trigger: beforeCost > budget * 1.15 ? '预算严重超限' : '预算压降',
      action: `${action},人均从 ¥${beforeCost} 降到 ¥${afterCost}`,
      before,
      after,
      resolved: afterCost <= budget,
    });
  }

  return { stops, logs };
}

async function buildRoute(stops: ReturnType<typeof chooseStops>, constraints: Constraints, persona: Persona): Promise<Route> {
  const routeStops: RouteStop[] = [];
  let cursor = constraints.startTime;
  let totalWalkMin = 0;
  let totalTransitMin = 0;
  const meal = mealWindow(constraints);
  let mealScheduled = false;

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
    if (scored.poi.category === 'dining' && meal && !mealScheduled) {
      cursor = Math.max(cursor, meal.start);
      mealScheduled = true;
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

  const rawPois = retrieved.pois
    .map((item, index) => toPoi(item, index, constraints))
    .filter((item): item is POI => Boolean(item))
    .filter((poi) => !isBlockedAmapPoi(poi, constraints));
  const areaCenter = areaCenterFor(raw);
  const areaFiltered = areaCenter
    ? rawPois.filter((poi) => poiDistanceToAreaM(poi, areaCenter) <= areaCenter.radiusM)
    : rawPois;
  const strictPois = areaFiltered.filter((poi) => passesAmapQuality(poi, constraints));
  const minQualityStops = targetStopCount(constraints) <= 2 ? 2 : 3;
  const pois = strictPois.length >= minQualityStops ? strictPois : strictPois.slice(0, Math.max(2, strictPois.length));
  if (pois.length < 2) return null;
  const center = pois.reduce((acc, poi) => ({ lat: acc.lat + poi.lat, lng: acc.lng + poi.lng }), { lat: 0, lng: 0 });
  const centerLat = center.lat / pois.length;
  const centerLng = center.lng / pois.length;

  const tScore = performance.now();
  const candidates = scorePOIs(pois, constraints, persona, centerLat, centerLng)
    .map((candidate) => {
      const distancePenalty = areaCenter ? Math.min(18, poiDistanceToAreaM(candidate.poi, areaCenter) / 450) : 0;
      return { ...candidate, score: Math.max(0, +(candidate.score - distancePenalty).toFixed(1)) };
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate) => rewriteAmapReasons(candidate, constraints));
  timings.score = +(performance.now() - tScore).toFixed(2);
  traceStep(trace, 'scorePOIs', `${pois.length} 个高德 POI`, strictPois.length < rawPois.length ? '已过滤低可信/冲突业态后评分' : '按画像/预算/偏好做本地规则评分', timings.score);

  const tBuild = performance.now();
  const selectedBeforeRepair = chooseStops(candidates, constraints);
  const budgetRepair = repairAmapBudget(selectedBeforeRepair, candidates, constraints);
  const selected = budgetRepair.stops;
  const minStops = Math.min(targetStopCount(constraints) >= 3 ? 3 : targetStopCount(constraints), pois.length);
  if (selected.length < minStops) return null;
  const builtRoute = await buildRoute(selected, constraints, persona);
  const unresolvedBudget = budgetRepair.logs.find((log) => !log.resolved && log.action.includes('最低约'));
  const route = unresolvedBudget
    ? {
      ...builtRoute,
      risks: [
        `预算无解:${unresolvedBudget.action}`,
        ...builtRoute.risks.filter((risk) => !risk.includes('当前路线各项约束均通过')),
      ].slice(0, 6),
    }
    : builtRoute;
  timings.build = +(performance.now() - tBuild).toFixed(2);
  timings.validate = 0;
  timings.explain = 0;
  traceStep(trace, 'planRoute', '高德候选 + 类目覆盖', selected.map((item) => item.poi.name).join(' → '), timings.build);
  traceStep(trace, 'validateConstraints', `${selected.length} 个真实 POI`, route.checks.map((check) => `${check.key}:${check.status}`).join(','), 0);
  traceStep(
    trace,
    'repairIfNeeded',
    '真实 POI 试验路线',
    budgetRepair.logs.length ? budgetRepair.logs.map((log) => log.action).join('；') : '预算无需修复',
    0,
    budgetRepair.logs.length ? 'ok' : 'skip',
  );
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
    repairLog: budgetRepair.logs,
    slotPlan: route.coverage,
    retrieveNote: `非上海试验链路:POI 来自高德 Web 服务(${amapCity}${area ? `/${area}` : ''});${areaCenter ? '已按明确区域收紧半径;' : ''}已过滤低可信/冲突业态 ${Math.max(0, rawPois.length - pois.length)} 个;价格、排队、偏好解释仍由本地规则估算。`,
  };
}
