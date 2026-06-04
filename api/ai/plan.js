import { getAmapKey, resolveLocation } from '../lib/locationResolver.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const AMAP_BASE_URL = 'https://restapi.amap.com/v3';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_TIMEOUT_MS = 7500;
const AMAP_POI_TIMEOUT_MS = 3200;
const AMAP_ROUTE_TIMEOUT_MS = 900;

const SHANGHAI_POI_RE = /人民广场|上海博物馆|南京东路|外滩|田子坊|新天地|豫园|静安寺|陆家嘴/;
const BLOCKED_POI_RE = /KTV|量贩|歌厅|舞厅|夜店|酒吧|洗浴|按摩|足浴|会所|棋牌|麻将|网吧|酒店|宾馆|停车场|写字楼|小区|住宅|政府机构|学校|幼儿园|公交站|地铁站|出入口|入口|售票处/i;

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

function amapKey() {
  return getAmapKey();
}

function stripCitySuffix(name) {
  return asText(name).replace(/(市|地区|自治州|州|盟)$/, '');
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
  const m = raw.match(/(\d{1,2})\s*点/);
  if (m) {
    let hour = Number(m[1]);
    if (/下午|晚上/.test(raw) && hour <= 9) hour += 12;
    return hour;
  }
  if (/上午|早上/.test(raw)) return 10;
  if (/中午/.test(raw)) return 12;
  if (/下午/.test(raw)) return 14;
  if (/晚上|晚/.test(raw)) return 18.5;
  return 10;
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
  return {
    city: locationResolution.city,
    startTime: parseStartTime(raw),
    durationMin: /一天|整天/.test(raw) ? 360 : 300,
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
    matched: [...(locationResolution.matched ?? []), ...prefs, ...mustCategories].filter(Boolean),
  };
}

function keywordsFor(raw, constraints, locationResolution) {
  const words = new Set();
  const district = typeof locationResolution.district === 'string' ? locationResolution.district : '';
  if (district && /古镇|古街|老街/.test(raw)) words.add(`${district} 古镇`);
  if (district && /万象汇/.test(raw)) words.add(`${district} 万象汇`);
  if (district && /吃|美食|午饭|晚饭|餐厅/.test(raw)) words.add(`${district} 餐厅`);
  for (const hint of locationResolution.poiHints ?? []) words.add(hint);
  for (const anchor of locationResolution.anchors ?? []) {
    if (anchor && anchor !== locationResolution.district && !/(省|市|区|县|旗)$/.test(anchor)) words.add(anchor);
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

function normalizeAmapPoi(item, index) {
  const loc = parseLocation(item.location);
  if (!loc || !item.name) return null;
  const text = `${item.name} ${item.type || ''} ${item.address || ''}`;
  if (/(省|市|区|县|旗)$/.test(item.name) && /地名地址信息|行政地名|普通地名|区县级地名/.test(text)) return null;
  if (BLOCKED_POI_RE.test(text)) return null;
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
  return true;
}

function scorePoiForPlan(poi, raw, locationResolution, index) {
  const text = `${poi.name} ${poi.area ?? ''} ${poi.address ?? ''} ${poi.type ?? ''}`;
  const keyword = asText(poi.keyword);
  let score = Math.max(0, 80 - index);
  if (locationResolution.district && poi.area === locationResolution.district) score += 70;
  if (locationResolution.district && text.includes(locationResolution.district)) score += 30;
  if (locationResolution.district && keyword.includes(locationResolution.district)) score += 12;
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
  await runBatched(keywords, 3, async (keyword) => {
    const adcodeScope = asText(locationResolution.adcode);
    const hasAdcodeScope = /^\d{6}$/.test(adcodeScope);
    const cityScope = hasAdcodeScope ? adcodeScope : constraints.city;
    const params = new URLSearchParams({
      key,
      keywords: keyword,
      city: cityScope,
      citylimit: hasAdcodeScope ? 'true' : 'false',
      offset: '10',
      page: '1',
      extensions: 'base',
    });
    try {
      const data = await fetchJsonWithRetry(`${AMAP_BASE_URL}/place/text?${params.toString()}`, AMAP_POI_TIMEOUT_MS);
      if (data.status !== '1') return;
      for (const item of data.pois ?? []) {
        const poi = normalizeAmapPoi(item, pois.length);
        if (!poi || !isPoiInResolvedLocation(poi, constraints, locationResolution) || seen.has(`${poi.name}-${poi.location.lng},${poi.location.lat}`)) continue;
        poi.keyword = keyword;
        seen.add(`${poi.name}-${poi.location.lng},${poi.location.lat}`);
        pois.push(poi);
      }
    } catch {
      // One slow keyword must not fail the whole planner.
    }
  });
  const rankedPois = pois
    .map((poi, index) => ({ poi, index, score: scorePoiForPlan(poi, raw, locationResolution, index) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.poi)
    .slice(0, 30);

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
    poiCandidates: pois.map((poi) => ({
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
      '如果是新疆但用户未指定具体城市，说明默认使用乌鲁木齐。',
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
    return { configured: true, used: false, model, status: 'adapter_error', error: error instanceof Error ? error.message : String(error) };
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

function selectNodes(parsed, pois) {
  const rawNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : Array.isArray(parsed?.plan?.nodes) ? parsed.plan.nodes : [];
  const used = new Set();
  const selected = [];
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
      reason: asText(node?.reason, '由 DeepSeek 基于高德候选和用户偏好选择。'),
      estimatedCost: node?.estimatedCost == null ? poi.estimatedCost : asNumber(node.estimatedCost, poi.estimatedCost),
      address: poi.address,
      type: poi.type,
      location: poi.location,
      source: 'amap',
      rating: poi.rating,
      reviews: poi.reviews,
    });
  }
  if (selected.length >= 2) return selected.slice(0, 5);
  return pois.slice(0, Math.min(4, pois.length)).map((poi) => ({
    id: poi.id,
    poiId: poi.id,
    name: poi.name,
    category: poi.category,
    time: '',
    reason: 'DeepSeek 未返回足够可匹配节点，使用高德候选顺序兜底。',
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

function ensureHintCoverage(raw, nodes, pois, locationResolution) {
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
  return [...required, ...nodes.filter((node) => !required.some((requiredNode) => requiredNode.poiId === node.poiId))].slice(0, 5);
}

function fallbackNodesFromPois(raw, pois) {
  const selected = [];
  const used = new Set();
  const pick = (predicate, reason) => {
    const poi = pois.find((item) => !used.has(item.id) && predicate(item));
    if (!poi) return;
    used.add(poi.id);
    selected.push(nodeFromPoi(poi, reason));
  };

  if (/吃|美食|午饭|晚饭|餐厅|肉串|烧烤/.test(raw)) {
    pick((poi) => poi.category === 'dining', '用户有明确用餐需求，优先选择当前城市高德餐饮候选。');
  }
  if (/博物馆|博物院|文化|历史|展|展馆/.test(raw)) {
    pick((poi) => /博物馆|博物院|历史|文化|展览|纪念馆/.test(`${poi.name} ${poi.type} ${poi.address}`), '用户明确想逛博物馆/文化点，已从高德候选中补入。');
  }
  if (/大巴扎|市集|逛|玩|打卡/.test(raw)) {
    pick((poi) => /大巴扎|景区|公园|街区|旅游|风景|购物/.test(`${poi.name} ${poi.type} ${poi.address}`), '补入适合逛玩的高德候选点。');
  }

  for (const poi of pois) {
    if (selected.length >= 4) break;
    if (used.has(poi.id)) continue;
    used.add(poi.id);
    selected.push(nodeFromPoi(poi, 'DeepSeek 暂不可用，使用高德候选顺序保守补足路线。'));
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
  return {
    mode: walkMinutes <= 25 ? 'walk' : 'transit',
    minutes: walkMinutes <= 25 ? walkMinutes : Math.min(45, Math.max(12, Math.round(walkMinutes * 0.35))),
    distanceM,
    text: walkMinutes <= 25 ? `步行约${walkMinutes}分钟` : `车程约${Math.min(45, Math.max(12, Math.round(walkMinutes * 0.35)))}分钟`,
    source: 'estimated',
  };
}

async function amapLeg(key, from, to) {
  if (!key) return fallbackLeg(from, to);
  const params = new URLSearchParams({
    key,
    origin: `${from.location.lng},${from.location.lat}`,
    destination: `${to.location.lng},${to.location.lat}`,
  });
  try {
    const { data } = await fetchJsonResponseWithTimeout(`${AMAP_BASE_URL}/direction/walking?${params.toString()}`, {}, AMAP_ROUTE_TIMEOUT_MS);
    const path = data.route?.paths?.[0];
    const distanceM = Math.round(Number(path?.distance ?? 0));
    const minutes = Math.round(Number(path?.duration ?? 0) / 60);
    if (data.status === '1' && distanceM > 0 && minutes > 0 && minutes <= 45 && distanceM <= 12000) {
      return {
        mode: minutes <= 25 ? 'walk' : 'transit',
        minutes,
        distanceM,
        text: minutes <= 25 ? `步行约${minutes}分钟` : `车程约${minutes}分钟`,
        source: 'amap',
      };
    }
  } catch {
    // fall through
  }
  return fallbackLeg(from, to);
}

async function attachLegs(nodes) {
  const key = amapKey();
  const output = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (i === 0) {
      output.push({ ...nodes[i], moveFromPrev: null });
    } else {
      output.push({ ...nodes[i], moveFromPrev: await amapLeg(key, nodes[i - 1], nodes[i]) });
    }
  }
  return output;
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
        : `暂未生成${locationResolution?.city ?? '当前城市'}路线：真实 POI/API 数据不足，请检查高德 API key、DeepSeek API key 或稍后重试。`,
      nodes: [],
    },
    clarificationOptions: locationResolution?.clarificationOptions ?? [],
    agentLoop: normalizeAgentLoop(null, [
      { step: 'location-resolver', action: '高德行政区/POI 解析城市、区域和锚点', result: locationResolution?.city ? `识别为${locationResolution.city}` : '需要补充城市' },
      { step: 'tool-use', action: '准备调用高德 POI 与 DeepSeek', result: '缺少必要数据或配置，停止生成路线' },
      { step: 'validator', action: '阻止错误城市 fallback', result: '未返回上海 mock 路线' },
    ]),
    planningBasis: {
      agentLoop: '自然语言解析后先检查城市和工具配置；缺少真实 POI 时不生成错误城市路线。',
      dataSource: '没有可用真实 POI 或 DeepSeek 结果。',
      mockServer: '未使用非上海 mock 路线。',
      validator: 'fallback-no-data 不会作为正常路线展示。',
    },
    dataSources,
    preferenceImpact: ['用户偏好已解析，但因真实 POI/API 数据不足，未进入路线排序。'],
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
      { step: 'fallback', action: '高德或 DeepSeek 不可用', result: '使用上海演示 mock' },
      { step: 'validator', action: '限制 fallback 范围', result: '仅上海请求允许 mock-shanghai-demo' },
    ],
    planningBasis: {
      agentLoop: '上海明确请求允许演示 fallback。',
      dataSource: '本响应未使用真实高德/DeepSeek 生成路线。',
      mockServer: '使用 mock-shanghai-demo。',
      validator: '非上海请求不会使用上海 mock。',
    },
    dataSources,
    preferenceImpact: ['保留用户显式上海城市与预算/活动偏好；fallback 仅用于演示稳定性。'],
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') {
    return send(res, 405, { status: 'method_not_allowed', message: 'Use POST /api/ai/plan' });
  }

  const body = readBody(req);
  const raw = requestText(body);
  if (!raw) {
    return send(res, 400, { status: 'bad_request', source: 'fallback-no-data', warnings: ['request is required'] });
  }

  const locationResolution = await resolveLocation(raw);
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

  const amap = await fetchAmapPois(raw, constraints, locationResolution);
  const baseDataSources = {
    amapDistrict: resolverSources.amapDistrict ?? { configured: Boolean(amapKey()), used: false, status: 'not_needed' },
    amapPoi: {
      configured: amap.configured,
      used: Boolean(amap.used || resolverSources.amapPoi?.used),
      status: amap.status === 'ok' || resolverSources.amapPoi?.status === 'ok' ? 'ok' : amap.status,
      keywords: amap.keywords,
      resolverUsed: Boolean(resolverSources.amapPoi?.used),
    },
    deepseek: { configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()), used: false, model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL, status: 'pending' },
    mock: { used: false },
  };

  if (!amap.configured || amap.pois.length < 2) {
    const reason = !amap.configured ? '高德 API key 未配置。' : '高德没有返回足够真实 POI。';
    if (canUseShanghaiMock(raw, locationResolution)) {
      return send(res, 200, mockShanghaiResponse(body, locationResolution, constraints, reason, {
        ...baseDataSources,
        mock: { used: true, scope: 'shanghai-only' },
      }));
    }
    return send(res, 200, noDataResponse(
      body,
      'fallback-no-data',
      'fallback-no-data',
      locationResolution,
      constraints,
      [reason, `当前城市真实 POI 数据不足，未返回上海 mock。`],
      baseDataSources,
    ));
  }

  const deepseek = await callDeepSeek(raw, constraints, amap.pois, previousPlan, body.preferences);
  const dataSources = {
    ...baseDataSources,
    amapPoi: { ...baseDataSources.amapPoi, used: true, status: 'ok', poiCount: amap.pois.length },
    deepseek: { configured: deepseek.configured, used: deepseek.used, model: deepseek.model, status: deepseek.status },
  };

  if (!deepseek.used || !deepseek.parsed) {
    const reason = deepseek.configured ? `DeepSeek 调用失败或 JSON 不合规:${deepseek.error ?? deepseek.status}` : 'DeepSeek API key 未配置。';
    if (canUseShanghaiMock(raw, locationResolution)) {
      return send(res, 200, mockShanghaiResponse(body, locationResolution, constraints, reason, {
        ...dataSources,
        mock: { used: true, scope: 'shanghai-only' },
      }));
    }
    let fallbackNodes = ensureHintCoverage(raw, fallbackNodesFromPois(raw, amap.pois), amap.pois, locationResolution);
    if (fallbackNodes.length >= 2) {
      fallbackNodes = await attachLegs(fallbackNodes);
      return send(res, 200, baseResponse(body, 'ok', 'amap-fallback', locationResolution, constraints, [reason], {
        model: deepseek.model,
        plan: {
          summary: `${locationResolution.city}路线已先用高德真实 POI 生成；DeepSeek 暂时没有返回可用 JSON。`,
          nodes: fallbackNodes,
        },
        candidates: amap.pois,
        agentLoop: [
          { step: 'location-resolver', action: '高德行政区/POI/地理编码解析城市和锚点', result: `${locationResolution.city}${locationResolution.anchors?.length ? `/${locationResolution.anchors.join('、')}` : ''}` },
          { step: 'tool-use', action: '调用高德 POI 搜索', result: `获取 ${amap.pois.length} 个候选` },
          { step: 'llm-plan', action: 'DeepSeek 生成旅行书 JSON', result: reason },
          { step: 'validator', action: '使用高德候选保守兜底', result: `${fallbackNodes.length} 个节点，未使用 mock` },
        ],
        planningBasis: {
          agentLoop: '解析需求 → 高德召回 → DeepSeek 尝试 → DeepSeek 不可用时使用高德候选保守路线。',
          dataSource: 'POI 名称、地址、坐标来自高德 Web 服务；价格/评分为估算。',
          mockServer: '未使用 mock fallback。',
          validator: '只允许使用当前解析城市下的高德候选 POI，并阻止错城 POI。',
        },
        dataSources,
        preferenceImpact: ['显式城市/区域和活动偏好决定高德关键词与路线节点；DeepSeek 暂不可用时不阻断路线展示。'],
      }));
    }
    return send(res, 200, noDataResponse(body, 'fallback-no-data', 'fallback-no-data', locationResolution, constraints, [reason, `已获取 ${amap.pois.length} 个高德候选，但未生成可展示路线。`], dataSources));
  }

  let nodes = ensureHintCoverage(raw, selectNodes(deepseek.parsed, amap.pois), amap.pois, locationResolution);
  if (nodes.length < 2) {
    return send(res, 200, noDataResponse(
      body,
      'fallback-no-data',
      'fallback-no-data',
      locationResolution,
      constraints,
      ['DeepSeek 没有返回足够可匹配高德 POI 的 route nodes。'],
      dataSources,
    ));
  }
  nodes = await attachLegs(nodes);
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

  const parsed = deepseek.parsed;
  return send(res, 200, baseResponse(body, 'ok', 'amap+deepseek', locationResolution, constraints, warnings, {
    model: deepseek.model,
    plan: {
      summary: asText(parsed.summary ?? parsed.plan?.summary, `${locationResolution.city}路线已基于高德真实 POI 和 DeepSeek 生成。`),
      nodes,
    },
    candidates: amap.pois,
    agentLoop: normalizeAgentLoop(parsed.agentLoop, [
      { step: 'location-resolver', action: '高德行政区/POI/地理编码解析城市和锚点', result: `${locationResolution.city}${locationResolution.anchors?.length ? `/${locationResolution.anchors.join('、')}` : ''}` },
      { step: 'tool-use', action: '调用高德 POI 搜索', result: `获取 ${amap.pois.length} 个候选` },
      { step: 'llm-plan', action: 'DeepSeek 基于候选生成旅行书 JSON', result: `${nodes.length} 个节点` },
      { step: 'validator', action: '校验节点来源和移动段', result: '通过' },
    ]),
    planningBasis: {
      agentLoop: asText(parsed.planningBasis?.agentLoop, '解析需求 → 高德召回 → DeepSeek 排序成书 → validator 检查。'),
      dataSource: asText(parsed.planningBasis?.dataSource, 'POI 名称、地址、坐标来自高德 Web 服务；价格/评分为估算。'),
      mockServer: asText(parsed.planningBasis?.mockServer, '未使用 mock fallback。'),
      validator: asText(parsed.planningBasis?.validator, '仅允许 DeepSeek 选择高德候选 POI，并检查非上海请求不得出现上海 POI。'),
    },
    dataSources,
    preferenceImpact: Array.isArray(parsed.preferenceImpact) && parsed.preferenceImpact.length
      ? parsed.preferenceImpact.slice(0, 6).map((item) => asText(item))
      : ['显式城市/区域和活动偏好决定高德关键词与路线节点；画像只影响语气与排序。'],
  }));
}
