import { getSql } from './client.js'

/** List a user's or guest's plans, newest first. */
export async function listHistory({ userId = null, deviceToken = null, limit = 30 }) {
  const sql = getSql()
  if (userId != null) {
    return sql`
      SELECT id, request, constraints, created_at FROM plans
      WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}
    `
  }
  if (deviceToken) {
    return sql`
      SELECT id, request, constraints, created_at FROM plans
      WHERE device_token = ${deviceToken} ORDER BY created_at DESC LIMIT ${limit}
    `
  }
  return []
}

export async function getPlan(id) {
  const sql = getSql()
  const rows = await sql`SELECT id, request, constraints, routes, data_sources, created_at FROM plans WHERE id = ${id}`
  return rows[0] ?? null
}

/** Attach a guest's anonymous plans to a user after login. */
export async function migrateGuestPlans(deviceToken, userId) {
  const sql = getSql()
  await sql`UPDATE plans SET user_id = ${userId} WHERE device_token = ${deviceToken} AND user_id IS NULL`
}
