import { parseBearer } from '../lib/auth.js'
import { userForSession } from '../lib/db/users.js'
import { hasDatabase } from '../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  const token = parseBearer(req.headers?.authorization)
  if (!token || !hasDatabase()) return res.status(200).json({ user: null })
  const user = await userForSession(token)
  return res.status(200).json({ user: user ? { id: user.id, username: user.username, prefs: user.prefs, budgetPref: user.budget_pref } : null })
}
