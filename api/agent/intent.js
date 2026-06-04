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

async function fetchWithTimeout(url, options, timeoutMs = 1600) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeIntent(value) {
  const allowed = new Set([
    'reduceTravel',
    'addStop',
    'addFoodOrDrink',
    'replaceFood',
    'lowerBudget',
    'makeQuiet',
    'makePhotoFriendly',
    'changeArea',
    'unknown',
  ]);
  if (!value || !allowed.has(value.primaryIntent)) return null;
  return {
    primaryIntent: value.primaryIntent,
    secondaryIntents: Array.isArray(value.secondaryIntents)
      ? value.secondaryIntents.filter((item) => allowed.has(item))
      : [],
    slots: value.slots && typeof value.slots === 'object' ? value.slots : {},
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 120) : 'LLM parsed route refine intent',
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') {
    return send(res, 405, { status: 'method_not_allowed', message: 'Use POST /api/agent/intent' });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return send(res, 200, {
      status: 'not_configured',
      message: 'OPENAI_API_KEY is not configured. Client will use deterministic local intent parser.',
    });
  }

  const body = readBody(req);
  const refineText = String(body.refineText || '').trim().slice(0, 160);
  if (!refineText) return send(res, 400, { status: 'bad_request', message: 'refineText is required' });

  const route = Array.isArray(body.route) ? body.route.slice(0, 6) : [];
  const originalRequest = String(body.originalRequest || body.request || '').slice(0, 300);
  const model = process.env.AGENT_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const system = [
    'You are an intent parser for a local route planning agent.',
    'Return only strict JSON. Do not create routes or POIs.',
    'Allowed primaryIntent values: reduceTravel, addStop, addFoodOrDrink, replaceFood, lowerBudget, makeQuiet, makePhotoFriendly, changeArea, unknown.',
    'Use slots for targetStop, category, area, budget, tone when present.',
    'LLM only understands/plans. The app will validate and repair routes separately.',
  ].join('\\n');

  const user = JSON.stringify({
    originalRequest,
    currentRoute: route,
    refineText,
    outputShape: {
      primaryIntent: 'reduceTravel | addStop | addFoodOrDrink | replaceFood | lowerBudget | makeQuiet | makePhotoFriendly | changeArea | unknown',
      secondaryIntents: [],
      slots: { targetStop: '第二站', category: '奶茶', area: '金鸡湖', budget: 200, tone: '安静' },
      confidence: '0.0-1.0',
      reason: 'short Chinese reason',
    },
  });

  try {
    const upstream = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : null;
    const intent = normalizeIntent(parsed);
    if (!intent) {
      return send(res, 502, { status: 'bad_llm_output', message: 'LLM did not return valid intent JSON' });
    }
    return send(res, 200, { status: 'ok', intent, model });
  } catch (error) {
    return send(res, 502, {
      status: 'adapter_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
