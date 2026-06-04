const AMAP_BASE_URL = 'https://restapi.amap.com/v3';
const DISTRICT_TIMEOUT_MS = 2600;
const POI_TIMEOUT_MS = 3000;

const MUNICIPALITIES = new Set(['北京市', '上海市', '天津市', '重庆市']);
const CITY_SUFFIX_RE = /(市|地区|自治州|州|盟)$/;
const PROVINCE_OPTION_PREFS = {
  浙江省: ['杭州', '宁波', '绍兴', '温州'],
  湖北省: ['武汉', '宜昌', '襄阳', '荆州'],
  湖南省: ['长沙', '张家界', '岳阳', '湘潭'],
};

const ALIAS_REPLACEMENTS = [
  { re: /西湿地公园/g, from: '西湿地公园', to: '西溪湿地公园' },
  { re: /西湿地/g, from: '西湿地', to: '西溪湿地公园' },
  { re: /西溪湿地公园公园/g, from: '西溪湿地公园公园', to: '西溪湿地公园' },
  { re: /西溪湿地(?!公园)/g, from: '西溪湿地', to: '西溪湿地公园' },
  { re: /乌市/g, from: '乌市', to: '乌鲁木齐' },
  { re: /魔都/g, from: '魔都', to: '上海' },
  { re: /帝都/g, from: '帝都', to: '北京' },
  { re: /羊城/g, from: '羊城', to: '广州' },
  { re: /鹏城/g, from: '鹏城', to: '深圳' },
  { re: /江城/g, from: '江城', to: '武汉' },
  { re: /星城/g, from: '星城', to: '长沙' },
  { re: /蓉城/g, from: '蓉城', to: '成都' },
  { re: /山城/g, from: '山城', to: '重庆' },
  { re: /长安/g, from: '长安', to: '西安' },
];

const GENERIC_POI_WORDS = new Set([
  '景点', '公园', '博物馆', '博物院', '美术馆', '餐厅', '饭店', '咖啡', '奶茶',
  '早午餐', 'brunch', '羊肉串', '烧烤', '美食', '地方', '城市', '附近',
]);

const BAD_POI_RE = /酒店|宾馆|停车场|政府|学校|小区|住宅|写字楼|产业园|售楼|服务区|收费站|KTV|夜总会|洗浴|足浴|按摩/i;
const WEAK_POI_HINT_RE = /^(?:周边|附近|边上|旁边|边上的|附近的|旁边的)?(?:古镇|老街|古街|公园|博物馆|景点|景区|商场|万象汇|美食|餐厅)$/;

const districtCache = new Map();
const poiCache = new Map();
const inputtipsCache = new Map();
const geocodeCache = new Map();

export function getAmapKey() {
  return process.env.AMAP_API_KEY?.trim()
    || process.env.GAODE_API_KEY?.trim()
    || process.env.AMAP_KEY?.trim()
    || '';
}

function uniq(values) {
  return [...new Set(values.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function asString(value) {
  if (Array.isArray(value)) return value.find((item) => typeof item === 'string' && item.trim()) ?? '';
  return typeof value === 'string' ? value.trim() : '';
}

function stripCitySuffix(name) {
  const text = asString(name);
  if (!text) return '';
  if (MUNICIPALITIES.has(text)) return text.replace(/市$/, '');
  return text.replace(CITY_SUFFIX_RE, '');
}

function normalizeProvinceName(name) {
  const text = asString(name);
  if (!text) return null;
  return text;
}

function parseCenter(center) {
  const [lngRaw, latRaw] = asString(center).split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function parentCityAdcode(adcode) {
  const code = asString(adcode);
  if (!/^\d{6}$/.test(code)) return '';
  if (['11', '12', '31', '50'].includes(code.slice(0, 2))) return `${code.slice(0, 2)}0000`;
  if (code.endsWith('00')) return code;
  return `${code.slice(0, 4)}00`;
}

function provinceAdcode(adcode) {
  const code = asString(adcode);
  if (!/^\d{6}$/.test(code)) return '';
  return `${code.slice(0, 2)}0000`;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAmapJson(url, timeoutMs) {
  const first = await fetchJson(url, timeoutMs);
  if (first?.infocode === '10021' || /EXCEEDED_THE_LIMIT/i.test(asString(first?.info))) {
    await sleep(380);
    return fetchJson(url, timeoutMs);
  }
  return first;
}

async function districtLookup(keyword, subdistrict = 0) {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: 'not_configured', districts: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: 'not_needed', districts: [] };
  const cacheKey = `${clean}:${subdistrict}`;
  if (districtCache.has(cacheKey)) return districtCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    keywords: clean,
    subdistrict: String(subdistrict),
    extensions: 'base',
    output: 'JSON',
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/config/district?${params.toString()}`, DISTRICT_TIMEOUT_MS)
    .then((data) => {
      if (data?.status !== '1') {
        return { configured: true, used: true, status: 'error', info: data?.info, districts: [] };
      }
      return {
        configured: true,
        used: true,
        status: (data.districts ?? []).length ? 'ok' : 'empty',
        districts: data.districts ?? [],
      };
    })
    .catch((error) => ({
      configured: true,
      used: true,
      status: 'error',
      info: error instanceof Error ? error.message : String(error),
      districts: [],
    }));
  districtCache.set(cacheKey, result);
  const final = await result;
  if (final.status === 'error') districtCache.delete(cacheKey);
  return final;
}

async function poiLookup(keyword, city = '') {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: 'not_configured', pois: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: 'not_needed', pois: [] };
  const cacheKey = `${clean}:${city}`;
  if (poiCache.has(cacheKey)) return poiCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    keywords: clean,
    city,
    citylimit: city ? 'true' : 'false',
    offset: '8',
    page: '1',
    extensions: 'all',
    output: 'JSON',
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/place/text?${params.toString()}`, POI_TIMEOUT_MS)
    .then((data) => {
      if (data?.status !== '1') {
        return { configured: true, used: true, status: 'error', info: data?.info, pois: [] };
      }
      return {
        configured: true,
        used: true,
        status: (data.pois ?? []).length ? 'ok' : 'empty',
        pois: data.pois ?? [],
      };
    })
    .catch((error) => ({
      configured: true,
      used: true,
      status: 'error',
      info: error instanceof Error ? error.message : String(error),
      pois: [],
    }));
  poiCache.set(cacheKey, result);
  const final = await result;
  if (final.status === 'error') poiCache.delete(cacheKey);
  return final;
}

async function inputtipsLookup(keyword, city = '') {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: 'not_configured', tips: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: 'not_needed', tips: [] };
  const cacheKey = `${clean}:${city}`;
  if (inputtipsCache.has(cacheKey)) return inputtipsCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    keywords: clean,
    city,
    citylimit: city ? 'true' : 'false',
    datatype: 'poi',
    output: 'JSON',
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/assistant/inputtips?${params.toString()}`, POI_TIMEOUT_MS)
    .then((data) => {
      if (data?.status !== '1') {
        return { configured: true, used: true, status: 'error', info: data?.info, tips: [] };
      }
      return {
        configured: true,
        used: true,
        status: (data.tips ?? []).length ? 'ok' : 'empty',
        tips: data.tips ?? [],
      };
    })
    .catch((error) => ({
      configured: true,
      used: true,
      status: 'error',
      info: error instanceof Error ? error.message : String(error),
      tips: [],
    }));
  inputtipsCache.set(cacheKey, result);
  const final = await result;
  if (final.status === 'error') inputtipsCache.delete(cacheKey);
  return final;
}

async function geocodeLookup(keyword, city = '') {
  const key = getAmapKey();
  if (!key) return { configured: false, used: false, status: 'not_configured', geocodes: [] };
  const clean = asString(keyword);
  if (!clean) return { configured: true, used: false, status: 'not_needed', geocodes: [] };
  const cacheKey = `${clean}:${city}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const params = new URLSearchParams({
    key,
    address: clean,
    city,
    output: 'JSON',
  });
  const result = fetchAmapJson(`${AMAP_BASE_URL}/geocode/geo?${params.toString()}`, POI_TIMEOUT_MS)
    .then((data) => {
      if (data?.status !== '1') {
        return { configured: true, used: true, status: 'error', info: data?.info, geocodes: [] };
      }
      return {
        configured: true,
        used: true,
        status: (data.geocodes ?? []).length ? 'ok' : 'empty',
        geocodes: data.geocodes ?? [],
      };
    })
    .catch((error) => ({
      configured: true,
      used: true,
      status: 'error',
      info: error instanceof Error ? error.message : String(error),
      geocodes: [],
    }));
  geocodeCache.set(cacheKey, result);
  const final = await result;
  if (final.status === 'error') geocodeCache.delete(cacheKey);
  return final;
}

function normalizeAliases(raw) {
  let text = asString(raw);
  const matched = [];
  for (const alias of ALIAS_REPLACEMENTS) {
    alias.re.lastIndex = 0;
    if (!alias.re.test(text)) continue;
    alias.re.lastIndex = 0;
    text = text.replace(alias.re, alias.to);
    matched.push(alias.from === alias.to ? alias.from : `${alias.from}=>${alias.to}`);
  }
  text = text.replace(/西溪湿地公园公园/g, '西溪湿地公园');
  return { text, matched };
}

function splitLocationList(value) {
  return uniq(asString(value)
    .replace(/(上午|下午|晚上|早上|中午)?\s*\d{1,2}\s*点/g, ' ')
    .split(/、|,|，|和|及|以及|\/|;|；|\s+/)
    .map((item) => item
      .replace(/^(想去|去|逛|到|在|来|玩|一下|一下子|边上的|附近的|旁边的|周边的)/, '')
      .replace(/(玩一下|玩玩|逛逛|逛一下|逛一逛|看看|玩|旅游|旅行|一带|附近|周边)$/g, '')
      .trim())
    .filter((item) => item.length >= 2 && item.length <= 16));
}

function cleanupAdminHint(value) {
  let text = asString(value);
  text = text.replace(/^.+(?:来|到|在)(?=[\u4e00-\u9fa5]{2,})/, '');
  text = text.replace(/^(?:想去|去|逛|到|在|来|玩)/, '');
  text = text.replace(/(?:玩|旅游|旅行|逛逛|逛一下|一带|附近|周边)$/g, '');
  return text.trim();
}

function expandAdminHint(value) {
  const clean = cleanupAdminHint(value);
  if (!clean) return [];
  const hints = [clean];
  if (!/自治区|特别行政区/.test(clean)) {
    const cityDistrict = clean.match(/^([\u4e00-\u9fa5]{2,8}?)(?:市)?([\u4e00-\u9fa5]{2,8}(?:区|县|旗))$/);
    if (cityDistrict) {
      hints.push(cityDistrict[1], cityDistrict[2]);
    }
  }
  return uniq(hints);
}

function addPhrasePoiHints(text, poiHints) {
  const foodPlaceMatches = [...text.matchAll(/(?:带(?:他|她|ta|TA|朋友|同学|家人|客户)?|去|到|在)([\u4e00-\u9fa5A-Za-z0-9·]{2,16}?)(?:吃|喝|逛|玩|午饭|晚饭|brunch)/g)];
  for (const match of foodPlaceMatches) {
    poiHints.push(...splitLocationList(match[1]));
  }
}

function isWeakPoiHint(value) {
  const clean = asString(value)
    .replace(/^(?:周边|附近|边上|边上的|旁边|旁边的|附近的)/, '')
    .replace(/(?:玩一下|玩玩|逛逛|逛一下|逛一逛|看看|玩)$/g, '')
    .trim();
  return !clean || GENERIC_POI_WORDS.has(clean) || WEAK_POI_HINT_RE.test(clean);
}

export function extractLocationHints(rawInput) {
  const { text, matched: aliasMatches } = normalizeAliases(rawInput);
  const adminHints = [];
  const poiHints = [];

  const comeMatch = text.match(/来([^，,。；;\s]{2,18}?)(?:玩|旅游|旅行|出差|逛|$)/);
  if (comeMatch?.[1]) adminHints.push(...splitLocationList(comeMatch[1]));

  const arriveMatches = [...text.matchAll(/(?:到|在)([^，,。；;\s]{2,18}?)(?:，|,|。|；|;|\s|人均|预算|想|吃|逛|玩|$)/g)];
  for (const match of arriveMatches) adminHints.push(...splitLocationList(match[1]));

  const adminSuffixMatches = [...text.matchAll(/(?:^|[，,。；;\s到在来])([\u4e00-\u9fa5]{1,14}(?:省|自治区|特别行政区|市|地区|自治州|州|盟|区|县|旗))/g)];
  for (const match of adminSuffixMatches) adminHints.push(match[1]);

  const wantMatches = [...text.matchAll(/(?:想去|想逛|去|逛一下|逛逛|看看)([^。；;]+?)(?:。|；|;|$)/g)];
  for (const match of wantMatches) poiHints.push(...splitLocationList(match[1]));
  addPhrasePoiHints(text, poiHints);

  const expandedAdminHints = adminHints.flatMap((item) => expandAdminHint(item));
  const adminSet = new Set(uniq(expandedAdminHints).filter((item) => !GENERIC_POI_WORDS.has(item)));
  const poiSet = new Set(uniq(poiHints).filter((item) => !GENERIC_POI_WORDS.has(item)));

  for (const item of adminSet) {
    if (poiSet.has(item)) poiSet.delete(item);
  }

  return {
    normalizedText: text,
    aliasMatches,
    adminHints: [...adminSet],
    poiHints: [...poiSet],
  };
}

function childOptionsFromProvince(district) {
  const raw = Array.isArray(district?.districts) ? district.districts : [];
  const names = raw
    .filter((item) => ['city', 'province'].includes(item.level) || /市$|自治州$|地区$|盟$/.test(asString(item.name)))
    .map((item) => stripCitySuffix(item.name))
    .filter(Boolean);
  const province = normalizeProvinceName(district?.name);
  const preferred = PROVINCE_OPTION_PREFS[province] ?? [];
  return uniq([...preferred.filter((item) => names.includes(item)), ...names]).slice(0, 8);
}

async function normalizeAdminDistrict(keyword, district) {
  const name = asString(district?.name);
  const level = asString(district?.level);
  const adcode = asString(district?.adcode);
  const citycode = asString(district?.citycode);
  const center = parseCenter(district?.center);
  const isMunicipality = MUNICIPALITIES.has(name);

  if (level === 'province' && !isMunicipality) {
    return {
      kind: 'province',
      keyword,
      province: normalizeProvinceName(name),
      provinceAdcode: adcode,
      center,
      options: childOptionsFromProvince(district),
      matched: name,
    };
  }

  if (level === 'city' || isMunicipality) {
    const provinceCode = provinceAdcode(adcode);
    const provinceResult = provinceCode && provinceCode !== adcode ? await districtLookup(provinceCode, 0) : null;
    const province = normalizeProvinceName(provinceResult?.districts?.[0]?.name) ?? (isMunicipality ? name : null);
    return {
      kind: 'city',
      keyword,
      city: stripCitySuffix(name),
      province,
      district: null,
      adcode,
      citycode,
      center,
      matched: name,
      confidence: keyword === name || keyword === stripCitySuffix(name) ? 0.96 : 0.9,
      source: 'district-city',
    };
  }

  if (['district', 'street'].includes(level) || /区$|县$|旗$/.test(name)) {
    const parentCode = parentCityAdcode(adcode);
    const cityResult = parentCode ? await districtLookup(parentCode, 0) : null;
    const cityDistrict = cityResult?.districts?.[0];
    const cityName = stripCitySuffix(cityDistrict?.name);
    const provinceCode = provinceAdcode(adcode);
    const provinceResult = provinceCode ? await districtLookup(provinceCode, 0) : null;
    const province = normalizeProvinceName(provinceResult?.districts?.[0]?.name);
    return {
      kind: 'district',
      keyword,
      city: cityName || stripCitySuffix(cityDistrict?.name),
      province,
      district: name,
      adcode,
      citycode: asString(cityDistrict?.citycode) || citycode,
      center,
      matched: name,
      confidence: 0.92,
      source: 'district-parent-city',
    };
  }

  return null;
}

function poiCityFromFields(item) {
  const pname = asString(item.pname ?? item.province);
  const cityRaw = asString(item.cityname ?? item.city);
  const adname = asString(item.adname ?? item.district);
  const adcode = asString(item.adcode);
  let city = stripCitySuffix(cityRaw);
  if (!city && MUNICIPALITIES.has(pname)) city = stripCitySuffix(pname);
  return {
    city,
    province: normalizeProvinceName(pname),
    district: adname || null,
    adcode,
    citycode: asString(item.citycode),
    center: parseCenter(item.location),
  };
}

function poiScore(keyword, item, provinceHint, cityHint) {
  const name = asString(item.name ?? item.formatted_address);
  const text = `${name} ${asString(item.type)} ${asString(item.address)} ${asString(item.district)}`;
  if (!name || BAD_POI_RE.test(text)) return -100;
  const loc = poiCityFromFields(item);
  let score = 20;
  if (name === keyword) score += 34;
  else if (name.includes(keyword) || keyword.includes(name)) score += 24;
  if (provinceHint && loc.province === provinceHint) score += 18;
  if (cityHint && loc.city === cityHint) score += 18;
  if (/风景|景区|公园|名胜|博物馆|文化|古迹|街区|旅游|休闲/.test(text)) score += 8;
  if (loc.city) score += 10;
  if (loc.center) score += 4;
  return score;
}

async function poiEvidenceFromHint(keyword, provinceHint, cityHint) {
  const [place, tips, geocode] = await Promise.all([
    poiLookup(keyword, cityHint ?? ''),
    inputtipsLookup(keyword, cityHint ?? ''),
    geocodeLookup(keyword, cityHint ?? ''),
  ]);
  const placePois = (place.pois ?? []).map((item) => ({ ...item, __source: 'place-text' }));
  const tipPois = (tips.tips ?? [])
    .filter((item) => asString(item.location))
    .map((item) => ({ ...item, __source: 'inputtips' }));
  const geocodePois = (geocode.geocodes ?? []).map((item) => ({
    name: asString(item.formatted_address) || keyword,
    pname: item.province,
    cityname: item.city,
    adname: item.district,
    adcode: item.adcode,
    location: item.location,
    __source: 'geocode',
  }));
  const all = [...placePois, ...tipPois, ...geocodePois]
    .map((item) => ({ item, score: poiScore(keyword, item, provinceHint, cityHint) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = all[0];
  if (!best) {
    return {
      keyword,
      status: 'empty',
      placeStatus: place.status,
      inputtipsStatus: tips.status,
      geocodeStatus: geocode.status,
      evidence: null,
    };
  }
  const loc = poiCityFromFields(best.item);
  return {
    keyword,
    status: 'ok',
    placeStatus: place.status,
    inputtipsStatus: tips.status,
    geocodeStatus: geocode.status,
    evidence: {
      kind: 'poi',
      keyword,
      city: loc.city,
      province: loc.province,
      district: loc.district,
      adcode: loc.adcode,
      citycode: loc.citycode,
      center: loc.center,
      matched: `${keyword}=>${asString(best.item.name) || keyword}`,
      confidence: Math.min(0.9, 0.64 + best.score / 180),
      source: best.item.__source,
    },
  };
}

function chooseCity(evidence, provinceHint) {
  const byCity = new Map();
  for (const item of evidence) {
    if (!item?.city) continue;
    if (provinceHint && item.province && item.province !== provinceHint) continue;
    const prev = byCity.get(item.city) ?? { score: 0, items: [] };
    const weight = item.kind === 'city' ? 1.1 : item.kind === 'district' ? 1.0 : 0.82;
    prev.score += (item.confidence ?? 0.7) * weight;
    prev.items.push(item);
    byCity.set(item.city, prev);
  }
  return [...byCity.entries()]
    .map(([city, value]) => ({ city, ...value }))
    .sort((a, b) => b.score - a.score || b.items.length - a.items.length)[0] ?? null;
}

function mergeCityInfo(chosen, preferredDistrict = null) {
  const items = chosen?.items ?? [];
  const strong = items.find((item) => item.kind === 'city')
    ?? items.find((item) => item.kind === 'district')
    ?? items[0];
  const district = items.find((item) => item.kind === 'district' && item.district)?.district
    ?? preferredDistrict
    ?? items.find((item) => item.district)?.district
    ?? null;
  return {
    city: chosen?.city ?? strong?.city ?? null,
    province: strong?.province ?? items.find((item) => item.province)?.province ?? null,
    district,
    adcode: strong?.kind === 'city' ? strong.adcode : parentCityAdcode(strong?.adcode) || strong?.adcode || null,
    citycode: strong?.citycode || null,
    center: strong?.center ?? items.find((item) => item.center)?.center ?? null,
  };
}

function clarificationMessage(province, options) {
  if (!province) return '请指定具体城市或区域。';
  const visible = options.length ? `，例如${options.slice(0, 4).join('、')}` : '';
  return `已识别为${province}，请指定${visible}等具体城市。`;
}

export async function resolveLocation(rawInput) {
  const key = getAmapKey();
  const hints = extractLocationHints(rawInput);
  const resolutionPath = [
    'raw input',
    'alias normalization',
    'district lookup',
  ];
  const warnings = [];
  const matched = [...hints.aliasMatches];
  const sourceUsage = {
    amapDistrict: {
      configured: Boolean(key),
      used: false,
      status: key ? 'not_needed' : 'not_configured',
    },
    amapPoi: {
      configured: Boolean(key),
      used: false,
      status: key ? 'not_needed' : 'not_configured',
    },
  };

  const adminEvidence = [];
  const provinceOnly = [];
  const districtStatuses = [];

  if (hints.adminHints.length) {
    const adminResults = [];
    for (const hint of hints.adminHints) {
      const lookup = await districtLookup(hint, 1);
      sourceUsage.amapDistrict.used = sourceUsage.amapDistrict.used || lookup.used;
      districtStatuses.push(lookup.status);
      const first = lookup.districts?.[0];
      if (!first) {
        adminResults.push(null);
        continue;
      }
      const normalized = await normalizeAdminDistrict(hint, first);
      adminResults.push(normalized);
    }
    for (const item of adminResults) {
      if (!item) continue;
      matched.push(item.keyword === item.matched ? item.matched : `${item.keyword}=>${item.matched}`);
      if (item.kind === 'province') provinceOnly.push(item);
      else adminEvidence.push(item);
    }
  }

  if (sourceUsage.amapDistrict.used) {
    sourceUsage.amapDistrict.status = districtStatuses.includes('ok')
      ? 'ok'
      : districtStatuses.find((status) => status === 'error') ?? 'empty';
  }

  const provinceHint = adminEvidence.find((item) => item.province)?.province ?? provinceOnly[0]?.province ?? null;
  const cityHint = adminEvidence.find((item) => item.city)?.city ?? null;
  const preferredDistrictHint = [...hints.adminHints]
    .filter((item) => /(?:区|县|旗)$/.test(item) && !/自治区|特别行政区/.test(item))
    .sort((a, b) => a.length - b.length)[0] ?? null;
  const poiResults = [];

  const poiHintsForInference = hints.poiHints.filter((hint) => cityHint || provinceHint || !isWeakPoiHint(hint));

  if (poiHintsForInference.length) {
    resolutionPath.push('poi reverse city inference');
    const results = await Promise.all(poiHintsForInference.map((hint) => poiEvidenceFromHint(hint, provinceHint, cityHint)));
    for (const result of results) {
      sourceUsage.amapPoi.used = true;
      poiResults.push(result);
      if (result.evidence) {
        adminEvidence.push(result.evidence);
        matched.push(result.evidence.matched);
      }
    }
    const statuses = poiResults.flatMap((item) => [item.placeStatus, item.inputtipsStatus, item.geocodeStatus]).filter(Boolean);
    sourceUsage.amapPoi.status = statuses.includes('ok') ? 'ok' : statuses.find((status) => status === 'error') ?? 'empty';
  } else if (hints.poiHints.length) {
    warnings.push('已忽略缺少城市上下文的泛地点描述，避免用“古镇/商场”等泛词误判城市。');
  }

  if (!key && !adminEvidence.length) {
    return {
      status: 'error',
      city: null,
      province: null,
      district: null,
      adcode: null,
      citycode: null,
      center: null,
      anchors: [],
      poiHints: hints.poiHints,
      matched,
      confidence: 0,
      resolutionPath,
      warnings: ['AMAP_API_KEY/GAODE_API_KEY/AMAP_KEY is not configured.'],
      dataSources: sourceUsage,
      message: '高德 Web 服务 key 未配置，无法进行通用地名解析。',
    };
  }

  const chosen = chooseCity(adminEvidence, provinceHint);
  if (chosen?.city) {
  const cityInfo = mergeCityInfo(chosen, preferredDistrictHint);
    const districts = uniq([
      cityInfo.district,
      ...adminEvidence
        .filter((item) => item.kind === 'district' && item.district && item.city === cityInfo.city)
        .map((item) => item.district),
    ]);
    const anchors = uniq([...districts, ...hints.poiHints]);
    const confidence = Math.max(0.55, Math.min(0.98, chosen.score / Math.max(1, chosen.items.length)));
    matched.push(cityInfo.city);
    return {
      status: 'resolved',
      city: cityInfo.city,
      province: cityInfo.province ?? provinceHint,
      district: cityInfo.district,
      adcode: cityInfo.adcode,
      citycode: cityInfo.citycode,
      center: cityInfo.center,
      anchors,
      poiHints: hints.poiHints,
      matched: uniq(matched),
      confidence: +confidence.toFixed(2),
      resolutionPath,
      warnings,
      dataSources: sourceUsage,
      normalizedInput: hints.normalizedText,
    };
  }

  if (provinceOnly.length) {
    const province = provinceOnly[0];
    const options = childOptionsFromProvince({ name: province.province, districts: province.options.map((name) => ({ name: `${name}市`, level: 'city' })) });
    return {
      status: 'needs-clarification',
      city: null,
      province: province.province,
      district: null,
      adcode: province.provinceAdcode,
      citycode: null,
      center: province.center,
      anchors: [],
      poiHints: hints.poiHints,
      matched: uniq(matched),
      confidence: 0.52,
      resolutionPath,
      warnings,
      dataSources: sourceUsage,
      clarificationOptions: options,
      message: clarificationMessage(province.province, options),
      normalizedInput: hints.normalizedText,
    };
  }

  return {
    status: 'needs-clarification',
    city: null,
    province: null,
    district: null,
    adcode: null,
    citycode: null,
    center: null,
    anchors: [],
    poiHints: hints.poiHints,
    matched: uniq(matched),
    confidence: 0.2,
    resolutionPath,
    warnings,
    dataSources: sourceUsage,
    clarificationOptions: [],
    message: '请指定具体城市或区域。',
    normalizedInput: hints.normalizedText,
  };
}
