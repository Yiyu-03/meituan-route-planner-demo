import { getSql } from './client.js'

export async function createUser({ username, passwordHash, prefs = [], budgetPref = null }) {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO users (username, password_hash, prefs, budget_pref)
    VALUES (${username}, ${passwordHash}, ${JSON.stringify(prefs)}::jsonb, ${budgetPref})
    RETURNING id, username, prefs, budget_pref, created_at
  `
  return rows[0]
}

export async function findUserByUsername(username) {
  const sql = getSql()
  const rows = await sql`SELECT id, username, password_hash, prefs, budget_pref FROM users WHERE username = ${username}`
  return rows[0] ?? null
}

export async function createSession(token, userId, expiresAt) {
  const sql = getSql()
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expiresAt})`
}

export async function userForSession(token) {
  if (!token) return null
  const sql = getSql()
  const rows = await sql`
    SELECT u.id, u.username, u.prefs, u.budget_pref
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()
  `
  return rows[0] ?? null
}

export async function createGuest(deviceToken, prefs = []) {
  const sql = getSql()
  await sql`
    INSERT INTO guests (device_token, prefs) VALUES (${deviceToken}, ${JSON.stringify(prefs)}::jsonb)
    ON CONFLICT (device_token) DO NOTHING
  `
  return { deviceToken }
}
