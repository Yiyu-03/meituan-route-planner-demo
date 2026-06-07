import { listHistory } from '../../lib/db/history.js'
import { hasDatabase } from '../../lib/db/client.js'
import { resolveIdentity } from '../../lib/identity.js'

/** Map a DB plan row to the frontend HistoryListItem shape. */
function toListItem(row) {
  return { planId: row.id, request: row.request, createdAt: row.created_at }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  if (!hasDatabase()) return res.status(200).json({ plans: [] })
  const { userId, deviceToken } = await resolveIdentity(req)
  const rows = await listHistory(userId != null ? { userId } : { deviceToken })
  return res.status(200).json({ plans: rows.map(toListItem) })
}
