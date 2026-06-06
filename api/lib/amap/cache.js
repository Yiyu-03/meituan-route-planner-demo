import { getSql, hasDatabase } from '../db/client.js'

function norm(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** poi:<city>|<scope>|<keyword> — normalized, stable. */
export function normalizeCacheKey({ city, keyword, scope }) {
  return `poi:${norm(city)}|${norm(scope)}|${norm(keyword)}`
}

/** leg:<lat,lng>-><lat,lng> with coords rounded to 3 decimals (~110m). */
export function legCacheKey(from, to) {
  const r = (n) => Number(n).toFixed(3)
  return `leg:${r(from.lat)},${r(from.lng)}->${r(to.lat)},${r(to.lng)}`
}

export function isFresh(fetchedAtIso, ttlDays) {
  const age = Date.now() - new Date(fetchedAtIso).getTime()
  return age <= ttlDays * 86400_000
}

const DEFAULT_TTL_DAYS = 21 // within the spec's 14–30 day window

/** Read a cached payload if present and fresh; else null. No-op (null) when DB absent. */
export async function readCache(key, ttlDays = DEFAULT_TTL_DAYS) {
  if (!hasDatabase()) return null
  const sql = getSql()
  const rows = await sql`SELECT payload, fetched_at FROM poi_cache WHERE key = ${key}`
  const row = rows[0]
  if (!row) return null
  if (!isFresh(new Date(row.fetched_at).toISOString(), ttlDays)) return null
  return row.payload
}

/** Upsert a payload. No-op when DB absent. */
export async function writeCache(key, payload) {
  if (!hasDatabase()) return
  const sql = getSql()
  await sql`
    INSERT INTO poi_cache (key, payload, fetched_at)
    VALUES (${key}, ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
  `
}
