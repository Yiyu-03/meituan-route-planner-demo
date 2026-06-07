import { randomUUID } from 'node:crypto'
import { createGuest } from '../../lib/db/users.js'
import { hasDatabase } from '../../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  const deviceToken = randomUUID()
  if (hasDatabase()) await createGuest(deviceToken).catch(() => {})
  return res.status(201).json({ deviceToken })
}
