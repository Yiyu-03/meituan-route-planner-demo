import { getSql } from './client.js'

const DEFAULT_TTL_MS = 60 * 60 * 1000 // 1h — paused conversations are short-lived.

/**
 * Persist (upsert) a paused ReAct conversation so an askUser turn can resume later.
 * @param {string} id        conversationId
 * @param {string|null} owner deviceToken or userId string (provenance of the asker)
 * @param {object} state     { messages, candidates, constraints, city }
 */
export async function saveConversation(id, owner, state, ttlMs = DEFAULT_TTL_MS) {
  const sql = getSql()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  const rows = await sql`
    INSERT INTO conversations (id, owner, state, expires_at)
    VALUES (${id}, ${owner}, ${JSON.stringify(state)}::jsonb, ${expiresAt})
    ON CONFLICT (id) DO UPDATE
      SET owner = EXCLUDED.owner, state = EXCLUDED.state, expires_at = EXCLUDED.expires_at
    RETURNING id
  `
  return rows[0]
}

/** Load a conversation by id. Returns { id, owner, state } or null if missing/expired. */
export async function loadConversation(id) {
  const sql = getSql()
  const rows = await sql`
    SELECT id, owner, state, expires_at FROM conversations WHERE id = ${id}
  `
  const row = rows[0]
  if (!row) return null
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null
  return { id: row.id, owner: row.owner, state: row.state }
}
