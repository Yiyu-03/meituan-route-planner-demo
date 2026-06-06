import { verifyPassword, newToken, sessionExpiry } from '../lib/auth.js'
import { findUserByUsername, createSession } from '../lib/db/users.js'
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
  const user = await findUserByUsername(username)
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码不正确。' })
  }
  const token = newToken()
  await createSession(token, user.id, sessionExpiry())
  if (deviceToken) await migrateGuestPlans(deviceToken, user.id).catch(() => {})
  return res.status(200).json({ token, user: { id: user.id, username: user.username } })
}
