function send(res, code, payload) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

function normalizePath(path) {
  return {
    distance: Number(path?.distance ?? 0),
    duration: Math.round(Number(path?.duration ?? 0) / 60),
    source: 'amap',
  };
}

async function fetchWithTimeout(url, timeoutMs = 900) {
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
  if (!['GET', 'POST'].includes(req.method)) {
    return send(res, 405, { status: 'method_not_allowed', message: 'Use GET or POST /api/amap/route-walking' });
  }

  const key = process.env.AMAP_API_KEY || process.env.GAODE_API_KEY || process.env.AMAP_KEY;
  if (!key) {
    return send(res, 200, {
      status: 'not_configured',
      configured: false,
      message: 'AMAP_API_KEY/GAODE_API_KEY/AMAP_KEY is not configured. Add it in Vercel Environment Variables to enable real AMap walking route estimate.',
      source: 'amap_adapter',
    });
  }

  const body = readBody(req);
  const origin = String(req.query.origin || body.origin || '').trim();
  const destination = String(req.query.destination || body.destination || '').trim();
  if (!origin || !destination) {
    return send(res, 400, {
      status: 'bad_request',
      message: 'origin and destination are required, formatted as "lng,lat"',
      source: 'amap_walking',
    });
  }

  const params = new URLSearchParams({ key, origin, destination });

  try {
    const upstream = await fetchWithTimeout(`https://restapi.amap.com/v3/direction/walking?${params.toString()}`);
    const data = await upstream.json();
    if (data.status !== '1') {
      return send(res, 502, {
        status: 'upstream_error',
        configured: true,
        info: data.info,
        infocode: data.infocode,
        source: 'amap_walking',
      });
    }

    const path = data.route?.paths?.[0];
    return send(res, 200, {
      status: 'ok',
      configured: true,
      query: { origin, destination },
      result: normalizePath(path),
      source: 'amap_walking',
    });
  } catch (error) {
    return send(res, 502, {
      status: 'adapter_error',
      configured: true,
      message: error instanceof Error ? error.message : String(error),
      source: 'amap_walking',
    });
  }
}
