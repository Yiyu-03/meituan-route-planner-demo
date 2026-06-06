import { hashPassword, newToken, sessionExpiry } from '../lib/auth.js'
import { createUser, findUserByUsername, createSession } from '../lib/db/users.js'
import { migrateGuestPlans } from '../lib/db/history.js'
import { hasDatabase } from '../lib/db/client.js'

function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  if (!hasDatabase()) return res.status(503).json({ error: 'database not configured' })
  const { username, password, deviceToken } = readBody(req)
  if (!username || !password || String(password).length < 6) {
    return res.status(400).json({ error: '用户名必填，密码至少 6 位。' })
  }
  if (await findUserByUsername(username)) return res.status(409).json({ error: '用户名已存在。' })
  const user = await createUser({ username, passwordHash: await hashPassword(password) })
  const token = newToken()
  await createSession(token, user.id, sessionExpiry())
  if (deviceToken) await migrateGuestPlans(deviceToken, user.id).catch(() => {})
  return res.status(201).json({ token, user: { id: user.id, username: user.username } })
}
