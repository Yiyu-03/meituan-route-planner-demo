import { parseBearer } from '../lib/auth.js'
import { userForSession } from '../lib/db/users.js'
import { listHistory } from '../lib/db/history.js'
import { hasDatabase } from '../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  if (!hasDatabase()) return res.status(200).json({ plans: [] })
  const token = parseBearer(req.headers?.authorization)
  const user = token ? await userForSession(token) : null
  const deviceToken = String(req.headers?.['x-device-token'] || '').trim() || null
  const plans = await listHistory(user ? { userId: Number(user.id) } : { deviceToken })
  return res.status(200).json({ plans })
}
