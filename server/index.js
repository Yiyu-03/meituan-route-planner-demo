import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const usersById = new Map();
const usersByNickname = new Map();
const tokens = new Map();
const historiesByUserId = new Map();

const mockPois = [
  poi('p-bund-1', '外滩源·本帮菜馆', 'dining', '上海', '外滩', 31.2405, 121.4890, 4.7, 280, ['本帮菜', '约会', '夜景'], '红烧肉入口即化,临窗能看外滩夜景'),
  poi('p-bund-2', '外滩观景咖啡', 'cafe', '上海', '外滩', 31.2395, 121.4902, 4.6, 68, ['安静', '拍照', '咖啡'], '靠窗位适合聊天,下午光线好'),
  poi('p-jingan-1', '静安独立咖啡馆', 'cafe', '上海', '静安寺', 31.2246, 121.4432, 4.5, 48, ['安静', '办公', '咖啡'], '手冲稳定,适合短暂停下来接电话'),
  poi('p-jingan-2', '愚园路家常面馆', 'dining', '上海', '静安寺', 31.2234, 121.4388, 4.5, 30, ['省钱', '本地烟火', '少排队'], '葱油拌面便宜大碗,街坊常去'),
  poi('p-xintiandi-1', '新天地石库门博物馆', 'culture', '上海', '新天地', 31.2192, 121.4751, 4.5, 0, ['文化', '拍照', '城市历史'], '能快速理解上海老城肌理'),
  poi('p-xintiandi-2', '新天地精品咖啡', 'cafe', '上海', '新天地', 31.2204, 121.4743, 4.6, 62, ['安静', '约会', '咖啡'], '座位间距较舒适,适合等朋友'),
  poi('p-lujiazui-1', '陆家嘴云端茶歇', 'cafe', '上海', '陆家嘴', 31.2398, 121.5038, 4.6, 98, ['夜景', '亲子友好', '安静'], '视野开阔,带娃也不太吵'),
  poi('p-lujiazui-2', '陆家嘴江畔散步道', 'nightscape', '上海', '陆家嘴', 31.2410, 121.5024, 4.4, 0, ['夜景', '少步行', '拍照'], '免费江景,晚上节奏稳定'),
  poi('p-xujiahui-1', '徐家汇 IMAX 影城', 'entertainment', '上海', '徐家汇', 31.1939, 121.4373, 4.5, 95, ['朋友聚会', '娱乐'], '场次多,适合聚会中段安排'),
  poi('p-xujiahui-2', '亲子科学探索馆', 'culture', '上海', '徐家汇', 31.1956, 121.4352, 4.4, 80, ['亲子友好', '文化', '互动'], '孩子可以动手做小实验'),
  poi('p-wukang-1', '武康路梧桐咖啡', 'cafe', '上海', '武康路', 31.2111, 121.4410, 4.6, 55, ['安静', '文艺', '拍照'], '梧桐街景出片,下午适合慢慢坐'),
  poi('p-yuyuan-1', '豫园老茶馆', 'cafe', '上海', '豫园', 31.2272, 121.4921, 4.3, 70, ['本地烟火', '文化', '安静'], '老城厢茶味明显,适合休息'),
];

function poi(id, name, category, city, area, lat, lng, rating, perCapita, tags, ugc) {
  return {
    id,
    name,
    category,
    city,
    area,
    location: { lat, lng },
    rating,
    perCapita,
    tags,
    ugcSummary: ugc,
    source: 'mock_local_life_poi',
  };
}

function hashId(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `mock-user-${hash.toString(36)}`;
}

function createToken(userId) {
  const token = `mock-token-${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  tokens.set(token, userId);
  return token;
}

function normalizePrefs(prefs) {
  const allow = new Set(['quiet', 'budget', 'avoidQueue', 'family']);
  return Array.isArray(prefs) ? prefs.filter((pref) => allow.has(pref)) : [];
}

function getOrCreateUser({ nickname, prefs = [], budgetPref = null }) {
  const name = String(nickname || '演示用户').trim() || '演示用户';
  const existingId = usersByNickname.get(name);
  const userId = existingId ?? hashId(name);
  const user = {
    userId,
    nickname: name,
    prefs: normalizePrefs(prefs),
    budgetPref: typeof budgetPref === 'number' ? budgetPref : null,
    createdAt: usersById.get(userId)?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  usersById.set(userId, user);
  usersByNickname.set(name, userId);
  if (!historiesByUserId.has(userId)) historiesByUserId.set(userId, []);
  return user;
}

function authUser(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const userId = tokens.get(token);
  return userId ? usersById.get(userId) : null;
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(data, null, 2));
}

function notFound(res) {
  send(res, 404, { error: 'not_found' });
}

function unauthorized(res) {
  send(res, 401, { error: 'unauthorized', message: 'Missing or invalid mock token' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error('body_too_large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
  });
}

function filterPois(searchParams) {
  const keyword = (searchParams.get('keyword') ?? '').trim().toLowerCase();
  const city = (searchParams.get('city') ?? '').trim();
  const area = (searchParams.get('area') ?? '').trim().toLowerCase();
  return mockPois.filter((p) => {
    const hitKeyword = !keyword || [p.name, p.category, p.area, p.ugcSummary, ...p.tags].some((v) =>
      String(v).toLowerCase().includes(keyword),
    );
    const hitCity = !city || p.city.includes(city);
    const hitArea = !area || p.area.toLowerCase().includes(area) || p.name.toLowerCase().includes(area);
    return hitKeyword && hitCity && hitArea;
  }).slice(0, 10);
}

function resolvePoint(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const found = mockPois.find((p) => p.id === value || p.name === value);
    return found?.location ?? null;
  }
  if (value.poiId) return resolvePoint(value.poiId);
  if (value.id) return resolvePoint(value.id);
  if (typeof value.lat === 'number' && typeof value.lng === 'number') return { lat: value.lat, lng: value.lng };
  return null;
}

function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}

function estimateRoute(body) {
  const from = resolvePoint(body.from);
  const to = resolvePoint(body.to);
  if (!from || !to) return null;
  const mode = body.mode === 'walk' || body.mode === 'transit' || body.mode === 'taxi' ? body.mode : 'mixed';
  const distanceMeters = haversineMeters(from, to);
  const durationMinutes = Math.max(2, Math.round(
    mode === 'walk'
      ? distanceMeters / 80
      : mode === 'taxi'
        ? distanceMeters / 350 + 4
        : distanceMeters / 260 + 6,
  ));
  return {
    distanceMeters,
    durationMinutes,
    mode,
    source: 'mock_route_estimate',
  };
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, {
      ok: true,
      service: 'meituan-route-planner-mock-server',
      uptimeSeconds: Math.round(process.uptime()),
      dataMode: 'memory + mock POI + mock route estimate',
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/auth/register') {
    const body = await readBody(req);
    const user = getOrCreateUser(body);
    send(res, 200, { token: createToken(user.userId), user });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/auth/login') {
    const body = await readBody(req);
    const name = String(body.nickname || '').trim();
    const userId = usersByNickname.get(name);
    const user = userId ? usersById.get(userId) : getOrCreateUser({ nickname: name || '演示用户' });
    send(res, 200, { token: createToken(user.userId), user });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/me') {
    const user = authUser(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    send(res, 200, { user });
    return;
  }

  if (url.pathname === '/history') {
    const user = authUser(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    if (req.method === 'GET') {
      send(res, 200, { userId: user.userId, history: historiesByUserId.get(user.userId) ?? [] });
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const history = historiesByUserId.get(user.userId) ?? [];
      const item = {
        id: body.id ?? `history-${Date.now().toString(36)}`,
        title: body.title ?? '路线规划记录',
        route: body.route ?? body,
        createdAt: new Date().toISOString(),
      };
      historiesByUserId.set(user.userId, [item, ...history].slice(0, 20));
      send(res, 200, { saved: item, count: historiesByUserId.get(user.userId).length });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/poi/search') {
    send(res, 200, {
      source: 'mock_amap_poi_search',
      query: Object.fromEntries(url.searchParams.entries()),
      pois: filterPois(url.searchParams),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/route/estimate') {
    const body = await readBody(req);
    const estimate = estimateRoute(body);
    if (!estimate) {
      send(res, 400, { error: 'invalid_points', message: 'from/to must be poi id, poi name, or {lat,lng}' });
      return;
    }
    send(res, 200, estimate);
    return;
  }

  notFound(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    send(res, 500, { error: 'server_error', message: error.message });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Mock route planner server listening on http://${HOST}:${PORT}`);
});
