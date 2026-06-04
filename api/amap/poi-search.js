function send(res, code, payload) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(code).json(payload);
}

function normalizePoi(poi) {
  return {
    name: poi.name,
    address: typeof poi.address === 'string' ? poi.address : '',
    location: poi.location,
    type: poi.type,
    source: 'amap',
  };
}

async function fetchWithTimeout(url, timeoutMs = 3200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') {
    return send(res, 405, { status: 'method_not_allowed', message: 'Use GET /api/amap/poi-search' });
  }

  const key = process.env.AMAP_API_KEY || process.env.GAODE_API_KEY || process.env.AMAP_KEY;
  if (!key) {
    return send(res, 200, {
      status: 'not_configured',
      configured: false,
      message: 'AMAP_API_KEY/GAODE_API_KEY/AMAP_KEY is not configured. Add it in Vercel Environment Variables to enable real AMap POI search.',
      results: [],
      source: 'amap_adapter',
    });
  }

  const keyword = String(req.query.keyword || req.query.keywords || '').trim();
  const city = String(req.query.city || '').trim();
  const area = String(req.query.area || '').trim();
  if (!keyword && !area) {
    return send(res, 400, { status: 'bad_request', message: 'keyword or area is required' });
  }

  const params = new URLSearchParams({
    key,
    keywords: [area, keyword].filter(Boolean).join(' '),
    city,
    citylimit: 'false',
    offset: String(req.query.limit || 10),
    page: '1',
    extensions: 'base',
  });

  try {
    const upstream = await fetchWithTimeout(`https://restapi.amap.com/v3/place/text?${params.toString()}`);
    const data = await upstream.json();
    if (data.status !== '1') {
      return send(res, 502, {
        status: 'upstream_error',
        configured: true,
        info: data.info,
        infocode: data.infocode,
        results: [],
        source: 'amap_place_text',
      });
    }

    return send(res, 200, {
      status: 'ok',
      configured: true,
      query: { keyword, city, area },
      results: (data.pois || []).map(normalizePoi),
      source: 'amap_place_text',
    });
  } catch (error) {
    return send(res, 502, {
      status: 'adapter_error',
      configured: true,
      message: error instanceof Error ? error.message : String(error),
      results: [],
      source: 'amap_place_text',
    });
  }
}
