function safeString(value, max = 120) {
  if (typeof value !== 'string') return value;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function scrub(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item));
  if (typeof value === 'string') return safeString(value);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/key|token|secret|authorization|cookie/i.test(key)) {
      out[key] = '[redacted]';
    } else if (/request|prompt|raw|input/i.test(key) && typeof entry === 'string') {
      out[key] = safeString(entry, 80);
    } else {
      out[key] = scrub(entry);
    }
  }
  return out;
}

export function createPlannerLogger(requestId) {
  const startedAt = Date.now();
  const log = (event, fields = {}, level = 'info') => {
    const payload = {
      event,
      requestId,
      elapsedMs: Date.now() - startedAt,
      ...scrub(fields),
    };
    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  };
  return {
    requestId,
    info: (event, fields) => log(event, fields, 'info'),
    warn: (event, fields) => log(event, fields, 'warn'),
    error: (event, fields) => log(event, fields, 'error'),
  };
}

export function newRequestId(prefix = 'plan') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
