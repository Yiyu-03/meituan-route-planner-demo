import { getPlan } from '../../lib/db/history.js'
import { hasDatabase } from '../../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  if (!hasDatabase()) return res.status(404).json({ error: 'not found' })
  const id = req.query?.id
  const plan = await getPlan(String(id))
  if (!plan) return res.status(404).json({ error: 'not found' })
  return res.status(200).json({ plan })
}
