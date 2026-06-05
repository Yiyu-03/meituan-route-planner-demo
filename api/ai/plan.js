import { getAmapKey, resolveLocation } from '../lib/locationResolver.js';
import { createPlannerLogger, newRequestId } from '../lib/plannerLogger.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const AMAP_BASE_URL = 'https://restapi.amap.com/v3';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_TIMEOUT_MS = 6000;
const AMAP_POI_TIMEOUT_MS = 4500;
const AMAP_ROUTE_TIMEOUT_MS = 1600;
const HARD_MAX_LEG_MINUTES = 45;
const HARD_MAX_LEG_DISTANCE_M = 12000;
const HARD_MAX_TOTAL_MOVE_MINUTES = 100;
const TARGET_POI_COUNT = 16;

const SHANGHAI_POI_RE = /人民广场|上海博物馆|南京东路|外滩|田子坊|新天地|豫园|静安寺|陆家嘴/;
const BLOCKED_POI_RE = /KTV|量贩|歌厅|舞厅|夜店|酒吧|洗浴|按摩|足浴|会所|棋牌|麻将|网吧|酒店|宾馆|停车场|写字楼|小区|住宅|政府机构|学校|幼儿园|医院|门诊|诊所|药店|人力资源|人才市场|便民服务|派出所|法院|银行|ATM|加油站|公交站|地铁站|出入口|入口|售票处|朋友圈|四个朋友/i;
const NON_LOCATION_HINT_RE = /同性|都是男|都是女|男的|女的|朋友|同学|同事|家人|对象|预算|人均|上午|下午|晚上|打算|带他|带她|带TA|想去|想吃|逛逛|玩一下|以内|左右|出发|到达|小时|分钟/;
const GENERIC_POI_HINT_RE = /^(古镇|古街|老街|餐厅|中餐厅|特色小吃|景点|公园|商场|购物中心|博物馆|展览馆|历史文化|咖啡|茶饮|街区|夜景|景区|自然风光)$/;

function send(res, code, payload) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(code).json(payload);
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function asText(value, fallback = '') {
  if (Array.isArray(value)) {
    const item = value.find((entry) => typeof entry === 'string' && entry.trim());
    return item?.trim() || fallback;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatClock(hourValue) {
  const normalized = ((hourValue % 24) + 24) % 24;
  const hour = Math.floor(normalized);
  const minute = Math.round((normalized - hour) * 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function amapKey() {
  return getAmapKey();
}

function stripCitySuffix(name) {
  return asText(name).replace(/(市|地区|自治州|州|盟)$/, '');
}

function isUsefulLocationHint(value) {
  const text = asText(value);
  if (!text || text.length < 2) return false;
  if (NON_LOCATION_HINT_RE.test(text)) return false;
  return true;
}

function sanitizeLocationResolution(locationResolution) {
  const anchors = (locationResolution.anchors ?? []).filter(isUsefulLocationHint);
  const poiHints = (locationResolution.poiHints ?? []).filter(isUsefulLocationHint);
  return {
    ...locationResolution,
    anchors,
    poiHints,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonResponseWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => null);
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, timeoutMs, attempts = 1) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { response, data } = await fetchJsonResponseWithTimeout(url, {}, timeoutMs);
      if (!data) throw new Error(`empty JSON from upstream: ${response.status}`);
      if (data.infocode === '10021' || /EXCEEDED_THE_LIMIT/i.test(asText(data.info))) {
        await sleep(260 + attempt * 180);
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(180 + attempt * 220);
    }
  }
  throw lastError ?? new Error('upstream JSON request failed');
}

async function runBatched(items, batchSize, worker) {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(worker));
  }
}

function scopedHistory(userId, sessionId) {
  const safeUserId = asText(userId, 'anonymous');
  const safeSessionId = asText(sessionId, `session-${Date.now()}`);
  return {
    userId: safeUserId,
    sessionId: safeSessionId,
    key: `${safeUserId}:${safeSessionId}`,
  };
}

function requestText(body) {
  return asText(body.request ?? body.prompt ?? body.input);
}

function parseStartTime(raw) {
  const m = raw.match(/(?:(上午|早上|中午|下午|晚上|晚间|夜里)\s*)?(\d{1,2})(?:[:：](\d{2}))?\s*点?/);
  if (m) {
    let hour = Number(m[2]);
    const minute = Number(m[3] ?? 0);
    const period = m[1] ?? '';
    if (/下午|晚上|晚间|夜里/.test(period) && hour <= 11) hour += 12;
    if (/中午/.test(period) && hour < 11) hour += 12;
    if (!period && /下午|晚上/.test(raw) && hour <= 9) hour += 12;
    return hour + minute / 60;
  }
  if (/上午|早上/.test(raw)) return 10;
  if (/中午/.test(raw)) return 12;
  if (/下午/.test(raw)) return 14;
  if (/晚上|晚/.test(raw)) return 18.5;
  return 10;
}

function parseClockHint(rawHour, context = '') {
  let hour = Number(rawHour);
  if (!Number.isFinite(hour)) return null;
  if (/下午|晚上|晚间|夜里|晚饭后/.test(context) && hour <= 11) hour += 12;
  if (/中午/.test(context) && hour < 11) hour += 12;
  return hour;
}

function parseDuration(raw, startTime) {
  const matched = [];
  const explicitHour = raw.match(/(?:玩|逛|待|安排|规划)?\s*(\d+(?:\.\d+)?)\s*(?:个)?\s*小时/);
  if (explicitHour) {
    const hours = Number(explicitHour[1]);
    if (Number.isFinite(hours) && hours > 0) {
      const durationMin = Math.max(90, Math.min(720, Math.round(hours * 60)));
      matched.push(`时长${hours}小时`);
      return {
        durationMin,
        source: 'explicit_duration',
        targetEndTime: startTime + durationMin / 60,
        matched,
      };
    }
  }

  const endPattern = raw.match(/(?:到|逛到|玩到|安排到)\s*(上午|早上|中午|下午|晚上|晚间|夜里)?\s*(\d{1,2})(?:[:：](\d{2}))?\s*点/);
  if (endPattern) {
    let end = parseClockHint(endPattern[2], endPattern[1] ?? raw);
    if (end != null) {
      end += Number(endPattern[3] ?? 0) / 60;
      if (end <= startTime) end += 12;
      const durationMin = Math.max(90, Math.min(720, Math.round((end - startTime) * 60)));
      matched.push(`到${formatClock(end)}结束`);
      return { durationMin, source: 'explicit_end_time', targetEndTime: end, matched };
    }
  }

  if (/一天|整天|玩一天|一整天/.test(raw)) {
    matched.push('玩一天');
    return { durationMin: 480, source: 'full_day', targetEndTime: startTime + 8, matched };
  }
  if (/半天/.test(raw)) {
    matched.push('半天');
    return { durationMin: 240, source: 'half_day', targetEndTime: startTime + 4, matched };
  }
  if (/(下午|白天).*(晚上|夜)|逛到晚上|玩到晚上/.test(raw)) {
    matched.push('下午到晚上');
    const durationMin = Math.max(240, Math.round((20 - startTime) * 60));
    return { durationMin, source: 'day_to_evening', targetEndTime: startTime + durationMin / 60, matched };
  }
  if (/晚饭前/.test(raw)) {
    matched.push('晚饭前');
    const durationMin = Math.max(150, Math.round((18 - startTime) * 60));
    return { durationMin, source: 'before_dinner', targetEndTime: startTime + durationMin / 60, matched };
  }

  const durationMin = startTime >= 18 ? 240 : 300;
  return { durationMin, source: 'default', targetEndTime: startTime + durationMin / 60, matched };
}

function parseBudget(raw) {
  const dining = raw.match(/(?:预算|人均)\s*(\d{2,4})\s*(?:吃午饭|吃午餐|吃饭|吃正餐|吃brunch|brunch)/i)
    ?? raw.match(/(?:吃午饭|吃午餐|吃饭|吃正餐|brunch).*?(?:预算|人均)\s*(\d{2,4})/i);
  if (dining) return { budgetPerCapita: null, diningBudgetPerCapita: Number(dining[1]), budgetSource: 'explicit_dining' };
  const total = raw.match(/人均\s*(\d{2,4})/) ?? raw.match(/预算\s*(?:人均)?\s*(\d{2,4})/) ?? raw.match(/(\d{2,4})\s*(?:以内|以下|左右|元|块)/);
  if (total) return { budgetPerCapita: Number(total[1]), diningBudgetPerCapita: null, budgetSource: 'explicit_total' };
  return { budgetPerCapita: null, diningBudgetPerCapita: null, budgetSource: null };
}

function inferPersona(raw) {
  if (/情侣|约会|女朋友|男朋友|对象/.test(raw)) return 'couple';
  if (/家人|家庭|带娃|孩子|亲子/.test(raw)) return 'family';
  if (/一个人|独自|自己/.test(raw)) return 'solo';
  return 'friends';
}

function inferTags(raw) {
  const prefs = [];
  if (/安静|轻松|慢慢|不要太累|少走路/.test(raw)) prefs.push('quiet');
  if (/博物馆|文化|历史|展|展馆|园林/.test(raw)) prefs.push('cultural');
  if (/自然|公园|风光|草原|湖|山|雪山|峡谷/.test(raw)) prefs.push('nature');
  if (/拍照|出片|打卡|夜景/.test(raw)) prefs.push('photo');
  if (/便宜|不贵|预算|实惠/.test(raw)) prefs.push('budget');
  if (/brunch|美食|肉串|烧烤|吃/.test(raw)) prefs.push('foodie');
  return [...new Set(prefs)];
}

function inferCategories(raw) {
  const categories = [];
  if (/吃|美食|brunch|肉串|烧烤|餐厅|午饭|晚饭|咖啡/.test(raw)) categories.push('dining');
  if (/咖啡|奶茶|茶饮|下午茶/.test(raw)) categories.push('cafe');
  if (/博物馆|文化|历史|展|展馆|园林/.test(raw)) categories.push('culture');
  if (/自然|风光|公园|景区|草原|峡谷|雪山|湖/.test(raw)) categories.push('culture');
  if (/拍照|出片|夜景/.test(raw)) categories.push('nightscape');
  return [...new Set(categories)];
}

function buildConstraints(raw, locationResolution) {
  const budget = parseBudget(raw);
  const prefs = inferTags(raw);
  const mustCategories = inferCategories(raw);
  const startTime = parseStartTime(raw);
  const duration = parseDuration(raw, startTime);
  return {
    city: locationResolution.city,
    startTime,
    durationMin: duration.durationMin,
    durationSource: duration.source,
    targetEndTime: duration.targetEndTime,
    party: /一个人|独自|自己/.test(raw) ? 1 : /情侣|两个人/.test(raw) ? 2 : /家人|家庭|带娃/.test(raw) ? 3 : 2,
    budgetPerCapita: budget.budgetPerCapita,
    diningBudgetPerCapita: budget.diningBudgetPerCapita,
    budgetSource: budget.budgetSource,
    prefs,
    avoid: [],
    mustCategories,
    avoidCategories: [],
    transport: /少走路|近一点|不要太累/.test(raw) ? 'walk' : 'mixed',
    pace: /轻松|慢慢|不要太累/.test(raw) ? 'relaxed' : /多逛|多玩/.test(raw) ? 'packed' : 'normal',
    raw,
    matched: [...(locationResolution.matched ?? []), ...duration.matched, ...prefs, ...mustCategories].filter(Boolean),
  };
}

function keywordsFor(raw, constraints, locationResolution) {
  const words = new Set();
  const district = typeof locationResolution.district === 'string' ? locationResolution.district : '';
  if (district && /古镇|古街|老街/.test(raw)) words.add(`${district} 古镇`);
  if (district && /万象汇/.test(raw)) words.add(`${district} 万象汇`);
  if (district && /吃|美食|午饭|晚饭|餐厅/.test(raw)) words.add(`${district} 餐厅`);
  for (const hint of locationResolution.poiHints ?? []) {
    if (isUsefulLocationHint(hint)) words.add(hint);
  }
  for (const anchor of locationResolution.anchors ?? []) {
    if (isUsefulLocationHint(anchor) && anchor !== locationResolution.district && !/(省|市|区|县|旗)$/.test(anchor)) words.add(anchor);
  }
  if (/逛|玩|闲逛|citywalk|散步/.test(raw)) {
    const scope = district || constraints.city;
    words.add(`${scope} 景点`);
    words.add(`${scope} 公园`);
    words.add(`${scope} 博物馆`);
    words.add(`${scope} 商场`);
  }
  if (/吃|美食|午饭|晚饭|餐厅|肉串|烧烤/.test(raw)) {
    words.add(`${constraints.city} 餐厅`);
    if (/肉串|烧烤|烤串/.test(raw)) words.add(`${constraints.city} 烧烤`);
  }
  if (/博物馆|文化|历史|展|展馆/.test(raw)) words.add(`${constraints.city} 博物馆`);
  if (constraints.city === '乌鲁木齐') ['新疆维吾尔自治区博物馆', '新疆国际大巴扎', '红山公园'].forEach((item) => words.add(item));
  if (constraints.city === '喀什') ['喀什古城', '喀什地区博物馆'].forEach((item) => words.add(item));
  if (constraints.city === '伊犁') ['伊宁六星街', '伊犁州博物馆'].forEach((item) => words.add(item));
  if (constraints.city === '北京') ['海淀博物馆', '北京博物馆'].forEach((item) => words.add(item));
  if (constraints.city === '上海') ['上海博物馆', '人民广场', '本帮菜'].forEach((item) => words.add(item));

  if (/brunch|早午餐/i.test(raw)) ['早午餐', 'brunch', '咖啡', '西餐'].forEach((item) => words.add(item));
  if (/肉串|烧烤|烤串/.test(raw)) ['肉串', '烧烤', '新疆菜'].forEach((item) => words.add(item));
  if (/吃|美食|午饭|晚饭|餐厅/.test(raw)) ['餐厅', '中餐厅', '特色小吃'].forEach((item) => words.add(item));
  if (/咖啡|奶茶|茶饮|下午茶/.test(raw)) ['咖啡', '茶饮'].forEach((item) => words.add(item));
  if (/博物馆|文化|历史|展|展馆/.test(raw)) ['博物馆', '展览馆', '历史文化'].forEach((item) => words.add(item));
  if (/古镇|古街|老街/.test(raw)) ['古镇', '老街', '历史街区'].forEach((item) => words.add(item));
  if (/自然|风光|公园|景区|草原|峡谷|雪山|湖/.test(raw)) ['景区', '公园', '自然风光'].forEach((item) => words.add(item));
  if (/拍照|出片|打卡|夜景/.test(raw)) ['景点', '街区', '夜景'].forEach((item) => words.add(item));

  if (!words.size) ['景点', '餐厅', '咖啡', '博物馆'].forEach((item) => words.add(item));
  return [...words].slice(0, 8);
}

function parseLocation(location) {
  const [lngRaw, latRaw] = String(location || '').split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function categoryFor(text) {
  if (/咖啡|茶饮|奶茶|甜品|饮品|下午茶|面包|烘焙/.test(text)) return 'cafe';
  if (/餐饮|餐厅|中餐|西餐|美食|小吃|肉串|烧烤|火锅|菜馆|饭店|brunch|早午餐/i.test(text)) return 'dining';
  if (/夜景|观景|灯光|夜游/.test(text)) return 'nightscape';
  if (/购物|商场|市集|大巴扎|商业/.test(text)) return 'shopping';
  if (/影院|剧场|演出|娱乐|游乐|KTV|密室|桌游/.test(text)) return 'entertainment';
  return 'culture';
}

function isLowQualityPoiName(name, text) {
  if (/朋友圈|四个朋友|朋友之家|交友|婚恋|相亲/.test(name)) return true;
  if (/仅销售|批发|公司|工作室|摄影工作室|培训|托管|维修|门店|营业厅|服务中心|卫生院|卫生室|委员会|办事处/.test(text) && !/博物馆|景区|公园|古镇|餐饮|餐厅|咖啡|商场|购物中心/.test(text)) return true;
  return false;
}

function normalizeAmapPoi(item, index) {
  const loc = parseLocation(item.location);
  if (!loc || !item.name) return null;
  const text = `${item.name} ${item.type || ''} ${item.address || ''}`;
  if (/(省|市|区|县|旗)$/.test(item.name) && /地名地址信息|行政地名|普通地名|区县级地名/.test(text)) return null;
  if (BLOCKED_POI_RE.test(text)) return null;
  if (isLowQualityPoiName(item.name, text)) return null;
  return {
    id: `amap-${index}-${item.location}`,
    name: item.name,
    address: typeof item.address === 'string' ? item.address : '',
    area: typeof item.adname === 'string' ? item.adname : '',
    city: stripCitySuffix(item.cityname),
    province: asText(item.pname),
    type: item.type || '',
    category: categoryFor(text),
    location: loc,
    rating: 4.5,
    reviews: 800 + index * 37,
    estimatedCost: categoryFor(text) === 'dining' ? 88 + (index % 3) * 18 : categoryFor(text) === 'cafe' ? 38 : 30,
    source: 'amap',
  };
}

function isPoiInResolvedLocation(poi, constraints, locationResolution) {
  const expectedCity = stripCitySuffix(constraints.city);
  const poiCity = stripCitySuffix(poi.city);
  const poiProvince = asText(poi.province);
  if (poiCity && expectedCity && poiCity !== expectedCity) return false;
  if (!poiCity && locationResolution.province && poiProvince && poiProvince !== locationResolution.province) return false;
  const district = asText(locationResolution.district);
  if (district && poi.area && poi.area !== district) {
    const text = `${poi.name} ${poi.area ?? ''} ${poi.address ?? ''} ${poi.type ?? ''}`;
    const strongHints = [...(locationResolution.poiHints ?? []), ...(locationResolution.anchors ?? [])]
      .map((hint) => asText(hint))
      .filter((hint) => hint
        && hint !== expectedCity
        && hint !== district
        && hint !== `${expectedCity}${district}`
        && !GENERIC_POI_HINT_RE.test(hint)
        && !/(省|市|区|县|旗)$/.test(hint));
    if (!strongHints.some((hint) => text.includes(hint) || hint.includes(poi.name))) return false;
  }
  return true;
}

function scorePoiForPlan(poi, raw, locationResolution, index) {
  const text = `${poi.name} ${poi.area ?? ''} ${poi.address ?? ''} ${poi.type ?? ''}`;
  const keyword = asText(poi.keyword);
  let score = Math.max(0, 80 - index);
  if (locationResolution.district && poi.area === locationResolution.district) score += 70;
  if (locationResolution.district && text.includes(locationResolution.district)) score += 30;
  if (locationResolution.district && keyword.includes(locationResolution.district)) score += 12;
  if (locationResolution.district && poi.area && poi.area !== locationResolution.district) score -= 80;
  for (const hint of locationResolution.poiHints ?? []) {
    if (hint && poi.name.includes(hint)) score += 90;
    else if (hint && text.includes(hint)) score += 45;
    else if (hint && keyword.includes(hint)) score += 8;
  }
  if (/吃|美食|午饭|晚饭|餐厅/.test(raw) && poi.category === 'dining') score += 30;
  if (/古镇|古街|老街/.test(raw) && /古镇|古街|老街|历史文化/.test(text)) score += 35;
  if (/万象汇/.test(raw) && /万象汇/.test(text)) score += 80;
  if (/住宅|停车场|政府|学校|写字楼|普通地名|地名地址信息/.test(text)) score -= 100;
  return score;
}

function centerParam(center) {
  const lng = Number(center?.lng);
  const lat = Number(center?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '';
  return `${lng},${lat}`;
}

function poiSeenKey(poi) {
  return `${poi.name}-${poi.location.lng},${poi.location.lat}`;
}

function addAmapPoiCandidate({ item, keyword, pois, seen, constraints, locationResolution }) {
  const poi = normalizeAmapPoi(item, pois.length);
  if (!poi || !isPoiInResolvedLocation(poi, constraints, locationResolution)) return false;
  const seenKey = poiSeenKey(poi);
  if (seen.has(seenKey)) return false;
  poi.keyword = keyword;
  seen.add(seenKey);
  pois.push(poi);
  return true;
}

function rankedPoiList(pois, raw, locationResolution) {
  return pois
    .map((poi, index) => ({ poi, index, score: scorePoiForPlan(poi, raw, locationResolution, index) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.poi)
    .slice(0, 30);
}

function hasPoiMatch(pois, pattern) {
  return pois.some((poi) => pattern.test(`${poi.name} ${poi.address} ${poi.type}`));
}

async function searchAmapTextPois({ key, keywords, constraints, locationResolution, pois, seen, cityScope, citylimit }) {
  for (let index = 0; index < keywords.length; index += 2) {
    const batch = keywords.slice(index, index + 2);
    await Promise.all(batch.map(async (keyword) => {
      const params = new URLSearchParams({
        key,
        keywords: keyword,
        city: cityScope,
        citylimit,
        offset: '12',
        page: '1',
        extensions: 'base',
      });
      try {
        const data = await fetchJsonWithRetry(`${AMAP_BASE_URL}/place/text?${params.toString()}`, AMAP_POI_TIMEOUT_MS, 1);
        if (data.status !== '1') return;
        for (const item of data.pois ?? []) {
          addAmapPoiCandidate({ item, keyword, pois, seen, constraints, locationResolution });
        }
      } catch {
        // One slow keyword must not fail the whole planner.
      }
    }));
    if (pois.length >= TARGET_POI_COUNT) return;
  }
}

function aroundKeywordsFor(raw, constraints, locationResolution) {
  const words = new Set();
  for (const hint of locationResolution.poiHints ?? []) {
    if (isUsefulLocationHint(hint) && !/(省|市|区|县|旗)$/.test(hint)) words.add(hint);
  }
  if (/万象汇/.test(raw)) words.add('万象汇');
  if (/古镇|古街|老街/.test(raw)) words.add('古镇');
  if (/吃|美食|午饭|晚饭|餐厅|肉串|烧烤/.test(raw)) words.add('餐厅');
  if (/博物馆|文化|历史|展|展馆/.test(raw)) words.add('博物馆');
  if (/逛|玩|闲逛|citywalk|散步/.test(raw)) ['景点', '公园', '商场'].forEach((item) => words.add(item));
  if (!words.size) ['景点', '餐厅', '博物馆'].forEach((item) => words.add(item));
  if (constraints.city) words.add(`${constraints.city} 景点`);
  return [...words].slice(0, 6);
}

async function searchAmapAroundPois({ key, raw, constraints, locationResolution, pois, seen }) {
  const location = centerParam(locationResolution.center);
  if (!location) return;
  const keywords = aroundKeywordsFor(raw, constraints, locationResolution);
  for (let index = 0; index < keywords.length; index += 2) {
    const batch = keywords.slice(index, index + 2);
    await Promise.all(batch.map(async (keyword) => {
      const params = new URLSearchParams({
        key,
        location,
        keywords: keyword,
        radius: locationResolution.district ? '45000' : '60000',
        offset: '12',
        page: '1',
        extensions: 'base',
      });
      try {
        const data = await fetchJsonWithRetry(`${AMAP_BASE_URL}/place/around?${params.toString()}`, AMAP_POI_TIMEOUT_MS, 1);
        if (data.status !== '1') return;
        for (const item of data.pois ?? []) {
          addAmapPoiCandidate({ item, keyword, pois, seen, constraints, locationResolution });
        }
      } catch {
        // Around search is a fallback; keep the planner moving if it is slow.
      }
    }));
    if (pois.length >= TARGET_POI_COUNT) return;
  }
}

async function ensureExplicitPoiCoverage({ key, raw, constraints, locationResolution, pois, seen }) {
  const tasks = [];
  const district = asText(locationResolution.district);
  const city = asText(constraints.city);
  if (/万象汇/.test(raw) && !hasPoiMatch(pois, /万象汇/)) {
    tasks.push(...[`${district || city} 万象汇`, `${city} 吴江 万象汇`, '万象汇'].filter(Boolean));
  }
  if (/古镇|古街|老街/.test(raw) && !hasPoiMatch(pois, /古镇|古街|老街/)) {
    tasks.push(...[`${district || city} 古镇`, `${city} 古镇`, '古镇'].filter(Boolean));
  }
  const keywords = [...new Set(tasks)].slice(0, 4);
  if (!keywords.length) return;
  await searchAmapTextPois({
    key,
    keywords,
    constraints,
    locationResolution,
    pois,
    seen,
    cityScope: city,
    citylimit: city ? 'true' : 'false',
  });
  if (pois.length < TARGET_POI_COUNT) {
    await searchAmapAroundPois({ key, raw, constraints, locationResolution, pois, seen });
  }
}

async function fetchAmapPois(raw, constraints, locationResolution) {
  const key = amapKey();
  const keywords = keywordsFor(raw, constraints, locationResolution);
  if (!key) {
    return {
      configured: false,
      used: false,
      status: 'not_configured',
      keywords,
      pois: [],
      message: 'AMAP_API_KEY/GAODE_API_KEY/AMAP_KEY is not configured.',
    };
  }

  const seen = new Set();
  const pois = [];
  const adcodeScope = asText(locationResolution.adcode);
  const hasAdcodeScope = /^\d{6}$/.test(adcodeScope);
  const primaryScope = hasAdcodeScope ? adcodeScope : constraints.city;
  await searchAmapTextPois({
    key,
    keywords: keywords.slice(0, 6),
    constraints,
    locationResolution,
    pois,
    seen,
    cityScope: primaryScope,
    citylimit: primaryScope ? 'true' : 'false',
  });
  if (pois.length < 8) {
    await searchAmapAroundPois({ key, raw, constraints, locationResolution, pois, seen });
  }
  if (pois.length < 2 && hasAdcodeScope && constraints.city) {
    await searchAmapTextPois({
      key,
      keywords,
      constraints,
      locationResolution,
      pois,
      seen,
      cityScope: constraints.city,
      citylimit: 'true',
    });
  }
  await ensureExplicitPoiCoverage({ key, raw, constraints, locationResolution, pois, seen });
  const rankedPois = rankedPoiList(pois, raw, locationResolution);

  return {
    configured: true,
    used: pois.length > 0,
    status: pois.length ? 'ok' : 'empty',
    keywords,
    pois: rankedPois,
    message: pois.length ? `高德返回 ${pois.length} 个候选 POI` : '高德没有返回可用 POI',
  };
}

function extractJsonObject(content) {
  const text = asText(content);
  if (!text) throw new Error('empty model content');
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('model content is not JSON');
  }
}

async function callDeepSeek(raw, constraints, pois, previousPlan, preferences) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  if (!apiKey) {
    return { configured: false, used: false, model, status: 'not_configured', error: 'DEEPSEEK_API_KEY is not configured.' };
  }

  const prompt = {
    task: previousPlan ? 'replan-minimal-change' : 'new-plan',
    request: raw,
    constraints,
    preferences: preferences ?? {},
    previousPlan: previousPlan ?? null,
    poiCandidates: pois.slice(0, 18).map((poi) => ({
      poiId: poi.id,
      name: poi.name,
      category: poi.category,
      address: poi.address,
      area: poi.area,
      type: poi.type,
      estimatedCost: poi.estimatedCost,
      location: poi.location,
      source: 'amap',
    })),
    rules: [
      '只允许从 poiCandidates 中选择 POI，不要编造候选外地点。',
      '显式城市、区域、预算、活动兴趣优先于画像。',
      '同性朋友、都是男的、普通朋友不能理解成情侣/约会。',
      '如果 request 指定了时长，summary 和节点理由必须尊重 constraints.durationMin。',
      '节点 time 可以留空；最终时间轴由后端根据真实移动时间统一排布。',
      '不要输出任何上游 API 状态、模型故障、JSON 失败、key 配置等内部实现信息。',
      '输出严格 JSON，不要 Markdown。',
    ],
    outputShape: {
      summary: '中文旅行书摘要',
      nodes: [
        {
          poiId: 'amap-...',
          name: '必须来自候选 POI',
          category: 'dining|cafe|culture|entertainment|shopping|nightscape',
          time: '10:00-11:00',
          reason: '为什么适合本次需求',
          estimatedCost: 80,
        },
      ],
      agentLoop: [{ step: 'intent', action: '做了什么', result: '结果' }],
      planningBasis: {
        agentLoop: 'Agent Loop 如何工作',
        dataSource: '高德 POI 如何参与',
        mockServer: '是否使用 mock fallback',
        validator: '预算/移动/时间如何校验',
      },
      dataSources: {
        amap: 'used',
        deepseek: 'used',
        mock: 'not_used',
      },
      preferenceImpact: ['用户偏好如何影响路线'],
    },
  };

  try {
    const { response, data: payload } = await fetchJsonResponseWithTimeout(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是可控的本地路线规划 Agent coordinator。',
              '你基于给定高德 POI 候选生成旅行书 JSON。',
              '你不能编造候选外 POI，不能绕过城市和预算约束。',
            ].join('\n'),
          },
          { role: 'user', content: JSON.stringify(prompt) },
        ],
      }),
    }, DEEPSEEK_TIMEOUT_MS);
    if (!response.ok) {
      return { configured: true, used: false, model, status: 'upstream_error', error: `${response.status} ${response.statusText}` };
    }
    const parsed = extractJsonObject(payload?.choices?.[0]?.message?.content);
    return { configured: true, used: true, model, status: 'ok', parsed };
  } catch (error) {
    const firstError = error instanceof Error ? error.message : String(error);
    try {
      const compactPrompt = {
        request: raw,
        constraints: {
          city: constraints.city,
          district: constraints.district,
          startTime: constraints.startTime,
          durationMin: constraints.durationMin,
          budgetPerCapita: constraints.budgetPerCapita,
          prefs: constraints.prefs,
          mustCategories: constraints.mustCategories,
        },
        poiCandidates: pois.slice(0, 12).map((poi) => ({
          poiId: poi.id,
          name: poi.name,
          category: poi.category,
          area: poi.area,
          estimatedCost: poi.estimatedCost,
        })),
        rules: [
          '只从 poiCandidates 选择 2-5 个 POI。',
          '普通朋友不要写成情侣约会。',
          '只返回 JSON: {"summary":"...","nodes":[{"poiId":"...","reason":"...","estimatedCost":80}],"preferenceImpact":[]}',
        ],
      };
      const { response, data: payload } = await fetchJsonResponseWithTimeout(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.15,
          max_tokens: 1600,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是路线 JSON 选择器。只能返回严格 JSON。' },
            { role: 'user', content: JSON.stringify(compactPrompt) },
          ],
        }),
      }, Math.min(4500, DEEPSEEK_TIMEOUT_MS));
      if (!response.ok) {
        return { configured: true, used: false, model, status: 'upstream_error', error: `${response.status} ${response.statusText}` };
      }
      const parsed = extractJsonObject(payload?.choices?.[0]?.message?.content);
      return { configured: true, used: true, model, status: 'ok-retry', parsed };
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      return { configured: true, used: false, model, status: 'adapter_error', error: `${firstError}; retry:${retryMessage}` };
    }
  }
}

function matchPoi(node, pois) {
  const poiId = asText(node?.poiId ?? node?.id);
  if (poiId) {
    const byId = pois.find((poi) => poi.id === poiId);
    if (byId) return byId;
  }
  const name = asText(node?.name);
  if (!name) return null;
  return pois.find((poi) => poi.name === name)
    ?? pois.find((poi) => name.includes(poi.name) || poi.name.includes(name))
    ?? null;
}

function maxStopsForConstraints(constraints) {
  if (constraints.durationMin >= 540) return 6;
  if (constraints.durationMin >= 420) return 5;
  return 4;
}

function selectNodes(parsed, pois, constraints) {
  const rawNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : Array.isArray(parsed?.plan?.nodes) ? parsed.plan.nodes : [];
  const used = new Set();
  const selected = [];
  const maxStops = maxStopsForConstraints(constraints);
  for (const node of rawNodes) {
    const poi = matchPoi(node, pois);
    if (!poi || used.has(poi.id)) continue;
    used.add(poi.id);
    selected.push({
      id: poi.id,
      poiId: poi.id,
      name: poi.name,
      category: poi.category,
      time: asText(node?.time, ''),
      reason: sanitizePublicText(node?.reason, '根据真实地点候选和用户偏好选择。'),
      estimatedCost: node?.estimatedCost == null ? poi.estimatedCost : asNumber(node.estimatedCost, poi.estimatedCost),
      address: poi.address,
      type: poi.type,
      location: poi.location,
      source: 'amap',
      rating: poi.rating,
      reviews: poi.reviews,
    });
  }
  if (selected.length >= 2) return selected.slice(0, maxStops);
  return pois.slice(0, Math.min(maxStops, pois.length)).map((poi) => ({
    id: poi.id,
    poiId: poi.id,
    name: poi.name,
    category: poi.category,
    time: '',
    reason: '已使用高德真实候选做保守规划，可重试优化排序。',
    estimatedCost: poi.estimatedCost,
    address: poi.address,
    type: poi.type,
    location: poi.location,
    source: 'amap',
    rating: poi.rating,
    reviews: poi.reviews,
  }));
}

function nodeFromPoi(poi, reason) {
  return {
    id: poi.id,
    poiId: poi.id,
    name: poi.name,
    category: poi.category,
    time: '',
    reason,
    estimatedCost: poi.estimatedCost,
    address: poi.address,
    area: poi.area,
    type: poi.type,
    location: poi.location,
    source: 'amap',
    rating: poi.rating,
    reviews: poi.reviews,
  };
}

function orderedPoiHints(raw, hints) {
  return [...(hints ?? [])]
    .filter(Boolean)
    .sort((a, b) => {
      const ai = raw.indexOf(a);
      const bi = raw.indexOf(b);
      const ap = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
      const bp = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
      return ap - bp;
    });
}

function bestPoiForHint(hint, pois, district) {
  const clean = asText(hint);
  if (!clean) return null;
  const districtText = asText(district);
  const scored = pois.map((poi, index) => {
    const text = `${poi.name} ${poi.area ?? ''} ${poi.address ?? ''} ${poi.type ?? ''}`;
    let score = 0;
    if (poi.name === clean) score += 80;
    else if (poi.name.includes(clean) || clean.includes(poi.name)) score += 55;
    else if (text.includes(clean)) score += 34;
    if (districtText && poi.area === districtText) score += 35;
    if (districtText && text.includes(districtText)) score += 16;
    if (/风景名胜|旅游景点|古镇|历史文化|购物中心|商场|餐饮服务/.test(text)) score += 8;
    if (/住宅|停车场|政府|学校|写字楼|普通地名|地名地址信息/.test(text)) score -= 40;
    return { poi, score, index };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.poi ?? null;
}

function ensureHintCoverage(raw, nodes, pois, locationResolution, constraints) {
  const required = [];
  const used = new Set(nodes.map((node) => node.poiId ?? node.id));
  for (const hint of orderedPoiHints(raw, locationResolution.poiHints ?? [])) {
    if (nodes.some((node) => node.name.includes(hint) || hint.includes(node.name))) continue;
    const poi = bestPoiForHint(hint, pois, locationResolution.district);
    if (!poi || used.has(poi.id)) continue;
    used.add(poi.id);
    required.push(nodeFromPoi(poi, `用户明确提到「${hint}」，已从高德候选中补入。`));
  }
  if (!required.length) return nodes;
  return [...required, ...nodes.filter((node) => !required.some((requiredNode) => requiredNode.poiId === node.poiId))]
    .slice(0, maxStopsForConstraints(constraints));
}

function fallbackNodesFromPois(raw, pois, constraints) {
  const selected = [];
  const used = new Set();
  const maxStops = maxStopsForConstraints(constraints);
  const targetStops = constraints.durationMin >= 540 ? Math.min(4, maxStops) : maxStops;
  const distanceToSelected = (poi) => {
    if (!selected.length) return 0;
    return Math.min(...selected.map((node) => haversineM(poi.location, node.location)));
  };
  const pick = (predicate, reason, options = {}) => {
    let candidates = pois.filter((item) => !used.has(item.id) && predicate(item));
    if (selected.length && options.nearM) {
      const nearby = candidates.filter((item) => distanceToSelected(item) <= options.nearM);
      if (nearby.length) candidates = nearby;
    }
    if (options.preferNearest && selected.length) {
      candidates = candidates
        .map((poi, index) => ({ poi, index, distance: distanceToSelected(poi) }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .map((item) => item.poi);
    }
    const poi = candidates[0];
    if (!poi) return;
    used.add(poi.id);
    selected.push(nodeFromPoi(poi, reason));
  };

  if (/万象汇/.test(raw)) {
    pick((poi) => /万象汇/.test(`${poi.name} ${poi.address} ${poi.type}`), '用户明确提到万象汇，优先覆盖这个锚点。');
  }
  if (/吃|美食|午饭|晚饭|餐厅|肉串|烧烤/.test(raw)) {
    pick((poi) => poi.category === 'dining', '用户有明确用餐需求，优先选择当前区域附近的高德餐饮候选。', { nearM: 1800, preferNearest: true });
  }
  if (/古镇|古街|老街/.test(raw)) {
    pick((poi) => /古镇|古街|老街|历史文化|旅游景区/.test(`${poi.name} ${poi.type} ${poi.address}`), '用户明确想去古镇/古街，已补入同城真实候选。', { nearM: 16000, preferNearest: true });
  }
  if (/博物馆|博物院|文化|历史|展|展馆/.test(raw)) {
    pick((poi) => /博物馆|博物院|历史|文化|展览|纪念馆/.test(`${poi.name} ${poi.type} ${poi.address}`), '用户明确想逛博物馆/文化点，已从高德候选中补入。', { nearM: 9000, preferNearest: true });
  }
  if (/大巴扎|市集|逛|玩|打卡/.test(raw)) {
    pick((poi) => /大巴扎|景区|公园|街区|旅游|风景|购物/.test(`${poi.name} ${poi.type} ${poi.address}`), '补入适合逛玩的高德候选点。', { nearM: 7000, preferNearest: true });
  }

  for (const poi of pois) {
    if (selected.length >= targetStops) break;
    if (used.has(poi.id)) continue;
    if (selected.length && distanceToSelected(poi) > 7000) continue;
    used.add(poi.id);
    selected.push(nodeFromPoi(poi, '已使用高德真实候选做保守规划，可重试优化排序。'));
  }
  for (const poi of pois) {
    if (selected.length >= Math.min(maxStops, 3)) break;
    if (used.has(poi.id)) continue;
    used.add(poi.id);
    selected.push(nodeFromPoi(poi, '已使用高德真实候选做保守规划，可重试优化排序。'));
  }
  return selected;
}

function haversineM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fallbackLeg(from, to) {
  const distanceM = Math.max(15, Math.round(haversineM(from.location, to.location)));
  const walkMinutes = Math.max(1, Math.round(distanceM / 80));
  const driveMinutes = Math.max(8, Math.round((distanceM * 1.25) / 360 + 6));
  const useWalk = walkMinutes <= 25 && distanceM <= 2200;
  return {
    mode: useWalk ? 'walk' : 'transit',
    minutes: useWalk ? walkMinutes : driveMinutes,
    distanceM,
    text: useWalk ? `步行约${walkMinutes}分钟` : `车程约${driveMinutes}分钟`,
    source: 'estimated',
    confidence: useWalk ? 0.6 : 0.42,
  };
}

function createRouteStats() {
  return {
    configured: Boolean(amapKey()),
    used: false,
    status: 'not_needed',
    requested: 0,
    ok: 0,
    fallback: 0,
    longLegs: 0,
  };
}

function noteRouteStats(stats, leg, requested = true) {
  if (!stats) return;
  if (requested) stats.requested += 1;
  if (leg.source === 'amap') {
    stats.used = true;
    stats.ok += 1;
    stats.status = 'ok';
  } else {
    stats.fallback += 1;
    if (stats.status !== 'ok') stats.status = stats.configured ? 'estimated' : 'not_configured';
  }
  if (leg.minutes > HARD_MAX_LEG_MINUTES || leg.distanceM > HARD_MAX_LEG_DISTANCE_M) stats.longLegs += 1;
}

async function amapWalkingLeg(key, from, to) {
  const params = new URLSearchParams({
    key,
    origin: `${from.location.lng},${from.location.lat}`,
    destination: `${to.location.lng},${to.location.lat}`,
  });
  const { data } = await fetchJsonResponseWithTimeout(`${AMAP_BASE_URL}/direction/walking?${params.toString()}`, {}, AMAP_ROUTE_TIMEOUT_MS);
  const path = data?.route?.paths?.[0];
  const distanceM = Math.round(Number(path?.distance ?? 0));
  const minutes = Math.round(Number(path?.duration ?? 0) / 60);
  if (data?.status === '1' && distanceM > 0 && minutes > 0 && minutes <= 45 && distanceM <= 5000) {
    return {
      mode: 'walk',
      minutes,
      distanceM,
      text: `步行约${minutes}分钟`,
      source: 'amap',
      confidence: 0.88,
    };
  }
  return null;
}

async function amapDrivingLeg(key, from, to) {
  const params = new URLSearchParams({
    key,
    origin: `${from.location.lng},${from.location.lat}`,
    destination: `${to.location.lng},${to.location.lat}`,
    strategy: '10',
    extensions: 'base',
  });
  const { data } = await fetchJsonResponseWithTimeout(`${AMAP_BASE_URL}/direction/driving?${params.toString()}`, {}, AMAP_ROUTE_TIMEOUT_MS);
  const path = data?.route?.paths?.[0];
  const distanceM = Math.round(Number(path?.distance ?? 0));
  const minutes = Math.round(Number(path?.duration ?? 0) / 60);
  if (data?.status === '1' && distanceM > 0 && minutes > 0) {
    return {
      mode: 'transit',
      minutes,
      distanceM,
      text: `车程约${minutes}分钟`,
      source: 'amap',
      confidence: 0.82,
    };
  }
  return null;
}

async function amapLeg(key, from, to, stats) {
  let leg = null;
  if (key) {
    const directDistance = haversineM(from.location, to.location);
    try {
      if (directDistance <= 2600) leg = await amapWalkingLeg(key, from, to);
      if (!leg) leg = await amapDrivingLeg(key, from, to);
    } catch {
      // fall through to conservative estimate
    }
  }
  leg = leg ?? fallbackLeg(from, to);
  noteRouteStats(stats, leg, Boolean(key));
  return leg;
}

async function attachLegs(nodes, stats) {
  const key = amapKey();
  const output = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (i === 0) {
      output.push({ ...nodes[i], moveFromPrev: null });
    } else {
      output.push({ ...nodes[i], moveFromPrev: await amapLeg(key, nodes[i - 1], nodes[i], stats) });
    }
  }
  return output;
}

function stayMinutesForNode(node, raw) {
  const text = `${node.name} ${node.type ?? ''} ${node.address ?? ''}`;
  if (node.category === 'dining') return /午饭|午餐|吃饭|正餐/.test(raw) ? 80 : 65;
  if (node.category === 'cafe') return 50;
  if (node.category === 'shopping') return /万象汇|商场|购物中心|大巴扎/.test(text) ? 75 : 60;
  if (node.category === 'entertainment') return 85;
  if (/古镇|古街|老街|景区|风景区|公园|湿地|西湖|东湖|岳麓|鼓浪屿/.test(text)) return 120;
  return 90;
}

function distributeExtraStay(stays, nodes, extraMin) {
  let remaining = Math.max(0, Math.round(extraMin));
  const priorities = nodes
    .map((node, index) => {
      const text = `${node.name} ${node.type ?? ''} ${node.address ?? ''}`;
      const cap = node.category === 'dining'
        ? 100
        : /古镇|古街|老街|景区|公园|湿地|湖|山/.test(text)
          ? 210
          : node.category === 'shopping'
            ? 130
            : 160;
      const priority = /古镇|古街|老街|景区|公园|湿地|湖|山/.test(text) ? 3 : node.category === 'culture' ? 2 : 1;
      return { index, cap, priority };
    })
    .sort((a, b) => b.priority - a.priority);

  while (remaining > 0) {
    let changed = false;
    for (const item of priorities) {
      if (remaining <= 0) break;
      const room = Math.max(0, item.cap - stays[item.index]);
      if (!room) continue;
      const add = Math.min(room, remaining, 30);
      stays[item.index] += add;
      remaining -= add;
      changed = true;
    }
    if (!changed) break;
  }
  if (remaining > 0 && stays.length) {
    stays[stays.length - 1] += remaining;
  }
  return stays;
}

function scheduleNodes(nodes, constraints) {
  if (!nodes.length) return nodes;
  const raw = constraints.raw ?? '';
  const stays = nodes.map((node) => stayMinutesForNode(node, raw));
  const legMinutes = nodes.reduce((sum, node) => sum + Math.max(0, Math.round(node.moveFromPrev?.minutes ?? 0)), 0);
  const targetStay = Math.max(0, constraints.durationMin - legMinutes);
  const baseStay = stays.reduce((sum, item) => sum + item, 0);
  const adjustedStays = distributeExtraStay([...stays], nodes, targetStay - baseStay);

  let clock = constraints.startTime;
  return nodes.map((node, index) => {
    if (index > 0) clock += Math.max(0, (node.moveFromPrev?.minutes ?? 0) / 60);
    const arrive = clock;
    const depart = arrive + adjustedStays[index] / 60;
    clock = depart;
    return {
      ...node,
      time: `${formatClock(arrive)}-${formatClock(depart)}`,
      scheduledStayMinutes: adjustedStays[index],
    };
  });
}

function routeEndTime(nodes, constraints) {
  if (!nodes.length) return constraints.startTime;
  const last = nodes[nodes.length - 1];
  const end = asText(last.time).split(/[-–—]/)[1];
  const match = end?.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return constraints.startTime;
  let hour = Number(match[1]) + Number(match[2]) / 60;
  if (hour < constraints.startTime - 1) hour += 24;
  return hour;
}

function totalMoveMinutes(nodes) {
  return nodes.reduce((sum, node) => sum + Math.max(0, Math.round(node.moveFromPrev?.minutes ?? 0)), 0);
}

function routeCost(nodes) {
  return nodes.reduce((sum, node) => sum + Math.max(0, Math.round(node.estimatedCost ?? 0)), 0);
}

function publicPlanningWarning(kind) {
  if (kind === 'llm_fallback') return '已使用保守规划，可重试优化。';
  if (kind === 'adjustment') return '当前方案仍需调整，可选择少去几个点、换近一点或提高预算。';
  return '当前方案已做基础校验。';
}

function sanitizePublicText(text, fallback = '') {
  const value = asText(text, fallback);
  if (!value) return fallback;
  if (/DeepSeek|API key|JSON|模型|上游|adapter|llm|token|鉴权/i.test(value)) {
    return fallback || '已使用保守规划，可重试优化。';
  }
  return value;
}

function buildAdjustmentOptions(validation) {
  const options = [];
  if (validation.longLegs.length || validation.totalMoveTooLong) {
    options.push('换近一点', '少去几个点');
  }
  if (validation.overBudget) options.push('便宜一点', '提高预算');
  if (validation.shortByMin > 45) options.push('延长停留', '增加近处备选');
  if (!options.length) options.push('重新优化', '少去几个点', '换近一点');
  return [...new Set(options)].slice(0, 5);
}

function validatePlannedNodes(nodes, constraints) {
  const longLegs = nodes
    .filter((node) => node.moveFromPrev && (node.moveFromPrev.minutes > HARD_MAX_LEG_MINUTES || node.moveFromPrev.distanceM > HARD_MAX_LEG_DISTANCE_M))
    .map((node) => ({
      name: node.name,
      minutes: node.moveFromPrev.minutes,
      distanceM: node.moveFromPrev.distanceM,
      source: node.moveFromPrev.source,
    }));
  const moveMin = totalMoveMinutes(nodes);
  const endTime = routeEndTime(nodes, constraints);
  const targetEnd = constraints.startTime + constraints.durationMin / 60;
  const cost = routeCost(nodes);
  const overBudget = constraints.budgetPerCapita != null && cost > constraints.budgetPerCapita * 1.15;
  const shortByMin = Math.max(0, Math.round((targetEnd - endTime) * 60));
  const totalMoveTooLong = moveMin > HARD_MAX_TOTAL_MOVE_MINUTES;
  const status = longLegs.length || totalMoveTooLong || overBudget || shortByMin > 90 ? 'needs-adjustment' : 'ok';
  return {
    status,
    longLegs,
    totalMoveTooLong,
    overBudget,
    shortByMin,
    totalMoveMin: moveMin,
    endTime,
    targetEnd,
    cost,
    adjustmentOptions: buildAdjustmentOptions({ longLegs, totalMoveTooLong, overBudget, shortByMin }),
  };
}

function normalizeAgentLoop(value, fallback = []) {
  if (Array.isArray(value) && value.length) {
    return value.slice(0, 8).map((item, index) => ({
      step: asText(item?.step, `step-${index + 1}`),
      action: asText(item?.action, '执行规划动作。'),
      result: asText(item?.result, '已完成。'),
    }));
  }
  return fallback;
}

function baseResponse(body, status, source, locationResolution, constraints, warnings, extra = {}) {
  return {
    requestId: body.__requestId,
    status,
    source,
    city: locationResolution?.city ?? null,
    province: locationResolution?.province ?? null,
    district: locationResolution?.district ?? null,
    anchors: locationResolution?.anchors ?? [],
    cityNote: locationResolution?.warnings?.[0] ?? '',
    locationResolution,
    warnings: [...(locationResolution?.warnings ?? []), ...warnings],
    historyScope: scopedHistory(body.userId, body.sessionId),
    constraints,
    ...extra,
  };
}

function canUseShanghaiMock(raw, locationResolution) {
  return locationResolution?.city === '上海' && /上海|魔都/.test(raw);
}

function noDataResponse(body, status, source, locationResolution, constraints, warnings, dataSources) {
  return baseResponse(body, status, source, locationResolution, constraints, warnings, {
    plan: {
      summary: status === 'needs-clarification'
        ? (locationResolution?.message ?? '请指定城市或区域。')
        : `暂未生成${locationResolution?.city ?? '当前城市'}路线：当前真实地点数据不足，请换一个更具体的区域或稍后重试。`,
      nodes: [],
    },
    clarificationOptions: locationResolution?.clarificationOptions ?? [],
    agentLoop: normalizeAgentLoop(null, [
      { step: 'location-resolver', action: '高德行政区/POI 解析城市、区域和锚点', result: locationResolution?.city ? `识别为${locationResolution.city}` : '需要补充城市' },
      { step: 'tool-use', action: '准备地点召回与路线生成', result: '缺少足够真实地点，停止生成路线' },
      { step: 'validator', action: '阻止错误城市 fallback', result: '未返回上海 mock 路线' },
    ]),
    planningBasis: {
      agentLoop: '自然语言解析后先检查城市和工具配置；缺少真实 POI 时不生成错误城市路线。',
      dataSource: '没有足够可用真实地点结果。',
      mockServer: '未使用非上海 mock 路线。',
      validator: 'fallback-no-data 不会作为正常路线展示。',
    },
    dataSources,
    adjustmentOptions: status === 'needs-adjustment' ? ['换更具体地点', '少去几个点', '稍后重试'] : [],
    preferenceImpact: ['用户偏好已解析，但因真实地点数据不足，未进入路线排序。'],
  });
}

function mockShanghaiResponse(body, locationResolution, constraints, warning, dataSources) {
  const nodes = [
    {
      id: 'mock-shanghai-museum',
      name: '上海博物馆',
      category: 'culture',
      time: '10:15-11:35',
      reason: '上海明确输入下的稳定 mock fallback，用于 API 不可用时演示。',
      estimatedCost: 0,
      address: '人民广场',
      location: { lng: 121.475, lat: 31.231 },
      source: 'mock',
      rating: 4.6,
      reviews: 2000,
      moveFromPrev: null,
    },
    {
      id: 'mock-shanghai-lunch',
      name: '人民广场本帮菜馆',
      category: 'dining',
      time: '11:55-12:55',
      reason: '饭点明确，预算估算可控。',
      estimatedCost: 88,
      address: '人民广场',
      location: { lng: 121.473, lat: 31.232 },
      source: 'mock',
      rating: 4.5,
      reviews: 1200,
      moveFromPrev: { mode: 'walk', minutes: 8, distanceM: 650, text: '步行约8分钟', source: 'mock' },
    },
    {
      id: 'mock-shanghai-walk',
      name: '外滩源街区',
      category: 'culture',
      time: '13:20-14:30',
      reason: '同城轻量收尾，避免过度移动。',
      estimatedCost: 0,
      address: '外滩源',
      location: { lng: 121.49, lat: 31.239 },
      source: 'mock',
      rating: 4.5,
      reviews: 1500,
      moveFromPrev: { mode: 'transit', minutes: 12, distanceM: 2800, text: '车程约12分钟', source: 'mock' },
    },
  ];
  return baseResponse(body, 'ok', 'mock-shanghai-demo', locationResolution, constraints, [warning], {
    plan: {
      summary: '上海明确输入下使用 mock-shanghai-demo fallback；非上海请求不会返回这条路线。',
      nodes,
    },
    agentLoop: [
      { step: 'intent', action: '识别城市', result: '用户明确输入上海' },
      { step: 'fallback', action: '真实地点或智能排序暂不可用', result: '使用上海演示路线' },
      { step: 'validator', action: '限制 fallback 范围', result: '仅上海请求允许 mock-shanghai-demo' },
    ],
    planningBasis: {
      agentLoop: '上海明确请求允许演示 fallback。',
      dataSource: '本响应使用上海演示路线，没有调用真实地点路线生成。',
      mockServer: '使用 mock-shanghai-demo。',
      validator: '非上海请求不会使用上海 mock。',
    },
    dataSources,
    preferenceImpact: ['保留用户显式上海城市与预算/活动偏好；fallback 仅用于演示稳定性。'],
  });
}

export default async function handler(req, res) {
  const requestId = newRequestId();
  const logger = createPlannerLogger(requestId);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') {
    return send(res, 405, { status: 'method_not_allowed', message: 'Use POST /api/ai/plan' });
  }

  const body = readBody(req);
  body.__requestId = requestId;
  const raw = requestText(body);
  if (!raw) {
    logger.warn('route_plan_bad_request', { status: 'bad_request' });
    return send(res, 400, { status: 'bad_request', source: 'fallback-no-data', warnings: ['request is required'] });
  }
  logger.info('route_plan_request', {
    userId: scopedHistory(body.userId, body.sessionId).userId,
    sessionId: scopedHistory(body.userId, body.sessionId).sessionId,
    requestLength: raw.length,
  });

  const locationResolution = sanitizeLocationResolution(await resolveLocation(raw));
  logger.info('location_resolution', {
    status: locationResolution.status,
    city: locationResolution.city,
    province: locationResolution.province,
    district: locationResolution.district,
    anchors: locationResolution.anchors,
    confidence: locationResolution.confidence,
  });
  const resolverSources = locationResolution.dataSources ?? {};
  if (locationResolution.status === 'needs-clarification') {
    return send(res, 200, noDataResponse(
      body,
      'needs-clarification',
      'fallback-no-data',
      locationResolution,
      null,
      [locationResolution.message ?? '需要补充城市，未默认回上海。'],
      {
        amapDistrict: resolverSources.amapDistrict ?? { configured: Boolean(amapKey()), used: false, status: 'skipped' },
        amapPoi: resolverSources.amapPoi ?? { configured: Boolean(amapKey()), used: false, status: 'skipped' },
        deepseek: { configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()), used: false, status: 'not_needed' },
        mock: { used: false },
      },
    ));
  }

  if (locationResolution.status !== 'resolved') {
    return send(res, 200, noDataResponse(
      body,
      'fallback-no-data',
      'fallback-no-data',
      locationResolution,
      null,
      [locationResolution.message ?? '地名解析失败，未默认回上海。'],
      {
        amapDistrict: resolverSources.amapDistrict ?? { configured: Boolean(amapKey()), used: false, status: 'error' },
        amapPoi: resolverSources.amapPoi ?? { configured: Boolean(amapKey()), used: false, status: 'error' },
        deepseek: { configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()), used: false, status: 'not_needed' },
        mock: { used: false },
      },
    ));
  }

  const constraints = buildConstraints(raw, locationResolution);
  const previousPlan = body.previousPlan ?? null;
  const warnings = [];
  const routeStats = createRouteStats();
  logger.info('constraints_parsed', {
    city: constraints.city,
    startTime: constraints.startTime,
    durationMin: constraints.durationMin,
    durationSource: constraints.durationSource,
    budgetPerCapita: constraints.budgetPerCapita,
    diningBudgetPerCapita: constraints.diningBudgetPerCapita,
    prefs: constraints.prefs,
    mustCategories: constraints.mustCategories,
  });

  const amap = await fetchAmapPois(raw, constraints, locationResolution);
  logger.info('amap_poi_result', {
    configured: amap.configured,
    status: amap.status,
    poiCount: amap.pois.length,
    keywords: amap.keywords,
  });
  const baseDataSources = {
    amapDistrict: resolverSources.amapDistrict ?? { configured: Boolean(amapKey()), used: false, status: 'not_needed' },
    amapPoi: {
      configured: amap.configured,
      used: Boolean(amap.used || resolverSources.amapPoi?.used),
      status: amap.status === 'ok' || resolverSources.amapPoi?.status === 'ok' ? 'ok' : amap.status,
      keywords: amap.keywords,
      resolverUsed: Boolean(resolverSources.amapPoi?.used),
    },
    amapRoute: routeStats,
    deepseek: { configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()), used: false, model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL, status: 'pending' },
    mock: { used: false },
  };

  if (!amap.configured || amap.pois.length < 2) {
    const reason = !amap.configured ? '真实地点服务暂未配置。' : '没有返回足够真实地点。';
    if (canUseShanghaiMock(raw, locationResolution)) {
      return send(res, 200, mockShanghaiResponse(body, locationResolution, constraints, reason, {
        ...baseDataSources,
        mock: { used: true, scope: 'shanghai-only' },
      }));
    }
    const noPoiStatus = amap.configured ? 'needs-adjustment' : 'fallback-no-data';
    return send(res, 200, noDataResponse(
      body,
      noPoiStatus,
      'fallback-no-data',
      locationResolution,
      constraints,
      [reason, '当前城市真实地点数据不足，请换更具体地点或稍后重试。'],
      {
        ...baseDataSources,
        deepseek: { ...baseDataSources.deepseek, used: false, status: 'not_needed' },
      },
    ));
  }

  const deepseek = await callDeepSeek(raw, constraints, amap.pois, previousPlan, body.preferences);
  logger.info('deepseek_result', {
    configured: deepseek.configured,
    used: deepseek.used,
    status: deepseek.status,
    model: deepseek.model,
    error: deepseek.error,
  });
  const dataSources = {
    ...baseDataSources,
    amapPoi: { ...baseDataSources.amapPoi, used: true, status: 'ok', poiCount: amap.pois.length },
    deepseek: { configured: deepseek.configured, used: deepseek.used, model: deepseek.model, status: deepseek.status },
  };

  if (!deepseek.used || !deepseek.parsed) {
    const internalReason = deepseek.configured ? `llm_unavailable:${deepseek.status}` : 'llm_not_configured';
    const publicWarning = publicPlanningWarning('llm_fallback');
    if (canUseShanghaiMock(raw, locationResolution)) {
      return send(res, 200, mockShanghaiResponse(body, locationResolution, constraints, publicWarning, {
        ...dataSources,
        mock: { used: true, scope: 'shanghai-only' },
      }));
    }
    let fallbackNodes = ensureHintCoverage(raw, fallbackNodesFromPois(raw, amap.pois, constraints), amap.pois, locationResolution, constraints);
    if (fallbackNodes.length >= 2) {
      fallbackNodes = scheduleNodes(await attachLegs(fallbackNodes, routeStats), constraints);
      const validation = validatePlannedNodes(fallbackNodes, constraints);
      const status = validation.status;
      const responseWarnings = status === 'needs-adjustment'
        ? [publicPlanningWarning('adjustment')]
        : [publicWarning];
      logger.info('route_validation', {
        status,
        source: 'amap-fallback',
        nodeCount: fallbackNodes.length,
        totalMoveMin: validation.totalMoveMin,
        endTime: validation.endTime,
        targetEnd: validation.targetEnd,
        longLegs: validation.longLegs,
        overBudget: validation.overBudget,
        internalReason,
      });
      return send(res, 200, baseResponse(body, status, 'amap-fallback', locationResolution, constraints, responseWarnings, {
        model: deepseek.model,
        plan: {
          summary: status === 'needs-adjustment'
            ? `${locationResolution.city}路线已用真实地点生成，但当前时间、预算或移动距离需要你选择调整。`
            : `${locationResolution.city}路线已用真实地点做保守规划，可重试优化排序。`,
          nodes: fallbackNodes,
        },
        adjustmentOptions: status === 'needs-adjustment' ? validation.adjustmentOptions : [],
        candidates: amap.pois,
        agentLoop: [
          { step: 'location-resolver', action: '高德行政区/POI/地理编码解析城市和锚点', result: `${locationResolution.city}${locationResolution.anchors?.length ? `/${locationResolution.anchors.join('、')}` : ''}` },
          { step: 'tool-use', action: '调用高德 POI 搜索', result: `获取 ${amap.pois.length} 个候选` },
          { step: 'route-plan', action: '按真实移动时间排布路线', result: `${fallbackNodes.length} 个节点，预计 ${formatClock(validation.endTime)} 结束` },
          { step: 'validator', action: '校验预算、移动距离和总时长', result: status === 'needs-adjustment' ? '需要用户选择调整' : '通过' },
        ],
        planningBasis: {
          agentLoop: '解析需求 → 高德召回 → 后端按真实移动时间生成保守路线 → validator 检查。',
          dataSource: 'POI 名称、地址、坐标来自高德 Web 服务；价格/评分为估算。',
          mockServer: '未使用 mock fallback。',
          validator: '检查单段移动、总移动、预算和目标时长；不可兼得时返回调整选项。',
        },
        dataSources,
        preferenceImpact: ['显式城市/区域和活动偏好决定地点召回与路线节点；保守规划不会暴露内部状态。'],
      }));
    }
    logger.warn('route_plan_no_nodes', { source: 'amap-fallback', poiCount: amap.pois.length, internalReason });
    return send(res, 200, noDataResponse(body, 'fallback-no-data', 'fallback-no-data', locationResolution, constraints, [publicWarning, `已获取 ${amap.pois.length} 个真实候选，但未生成可展示路线。`], dataSources));
  }

  let nodes = ensureHintCoverage(raw, selectNodes(deepseek.parsed, amap.pois, constraints), amap.pois, locationResolution, constraints);
  if (nodes.length < 2) {
    return send(res, 200, noDataResponse(
      body,
      'fallback-no-data',
      'fallback-no-data',
      locationResolution,
      constraints,
      ['当前真实候选不足以生成稳定路线，请换一个更具体的区域或稍后重试。'],
      dataSources,
    ));
  }
  nodes = scheduleNodes(await attachLegs(nodes, routeStats), constraints);
  if (nodes.some((node) => SHANGHAI_POI_RE.test(node.name)) && locationResolution.city !== '上海') {
    return send(res, 200, noDataResponse(
      body,
      'fallback-no-data',
      'fallback-no-data',
      locationResolution,
      constraints,
      ['validator 阻止了非上海请求中的上海 POI。'],
      dataSources,
    ));
  }
  const validation = validatePlannedNodes(nodes, constraints);
  const responseStatus = validation.status;
  const responseWarnings = responseStatus === 'needs-adjustment'
    ? [publicPlanningWarning('adjustment')]
    : warnings;
  logger.info('route_validation', {
    status: responseStatus,
    source: 'amap+deepseek',
    nodeCount: nodes.length,
    totalMoveMin: validation.totalMoveMin,
    endTime: validation.endTime,
    targetEnd: validation.targetEnd,
    longLegs: validation.longLegs,
    overBudget: validation.overBudget,
  });

  const parsed = deepseek.parsed;
  return send(res, 200, baseResponse(body, responseStatus, 'amap+deepseek', locationResolution, constraints, responseWarnings, {
    model: deepseek.model,
    plan: {
      summary: responseStatus === 'needs-adjustment'
        ? `${locationResolution.city}路线已基于真实地点生成，但当前时间、预算或移动距离需要你选择调整。`
        : sanitizePublicText(parsed.summary ?? parsed.plan?.summary, `${locationResolution.city}路线已基于真实地点生成。`),
      nodes,
    },
    adjustmentOptions: responseStatus === 'needs-adjustment' ? validation.adjustmentOptions : [],
    candidates: amap.pois,
    agentLoop: normalizeAgentLoop(parsed.agentLoop, [
      { step: 'location-resolver', action: '高德行政区/POI/地理编码解析城市和锚点', result: `${locationResolution.city}${locationResolution.anchors?.length ? `/${locationResolution.anchors.join('、')}` : ''}` },
      { step: 'tool-use', action: '调用高德 POI 搜索', result: `获取 ${amap.pois.length} 个候选` },
      { step: 'route-plan', action: '按真实移动时间排布路线', result: `${nodes.length} 个节点，预计 ${formatClock(validation.endTime)} 结束` },
      { step: 'validator', action: '校验预算、移动距离和总时长', result: responseStatus === 'needs-adjustment' ? '需要用户选择调整' : '通过' },
    ]),
    planningBasis: {
      agentLoop: sanitizePublicText(parsed.planningBasis?.agentLoop, '解析需求 → 地点召回 → 智能排序 → 后端按真实移动时间排程 → validator 检查。'),
      dataSource: sanitizePublicText(parsed.planningBasis?.dataSource, 'POI 名称、地址、坐标来自地图服务；价格/评分为估算。'),
      mockServer: sanitizePublicText(parsed.planningBasis?.mockServer, '未使用演示 fallback。'),
      validator: sanitizePublicText(parsed.planningBasis?.validator, '仅允许选择真实候选 POI，并检查错城、预算、移动距离和目标时长。'),
    },
    dataSources,
    preferenceImpact: Array.isArray(parsed.preferenceImpact) && parsed.preferenceImpact.length
      ? parsed.preferenceImpact.slice(0, 6).map((item) => sanitizePublicText(item, '用户偏好影响地点召回、排序和停留节奏。'))
      : ['显式城市/区域和活动偏好决定地点召回与路线节点；画像只影响语气与排序。'],
  }));
}
