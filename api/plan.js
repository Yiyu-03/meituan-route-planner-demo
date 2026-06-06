import { randomUUID } from 'node:crypto'
import { PlanRequestSchema } from '../contract/index'
import { resolveLocation, getAmapKey } from './lib/locationResolver.js'
import { openSSE } from './lib/sse.js'
import { parseBearer } from './lib/auth.js'
import { userForSession, createGuest } from './lib/db/users.js'
import { savePlan } from './lib/db/plans.js'
import { hasDatabase } from './lib/db/client.js'
import { runPlanLoop } from './lib/agent/loop.ts'
import { understand } from './lib/agent/understandLLM.ts'
import { retrieve } from './lib/agent/retrieve.ts'
import { streamExplanation } from './lib/agent/explain.ts'
import { readCache, writeCache } from './lib/amap/cache.js'

function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return req.body
}

async function identityFromReq(req) {
  const token = parseBearer(req.headers?.authorization)
  if (token && hasDatabase()) {
    const user = await userForSession(token)
    if (user) return { userId: Number(user.id), deviceToken: null }
  }
  const device = String(req.headers?.['x-device-token'] || '').trim() || randomUUID()
  if (hasDatabase()) await createGuest(device).catch(() => {})
  return { userId: null, deviceToken: device }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Device-Token')
    return res.status(204).end()
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST /api/plan' })

  const parsed = PlanRequestSchema.safeParse(readBody(req))
  if (!parsed.success) {
    const sse = openSSE(res)
    sse.send({ type: 'error', code: 'bad-request', message: '请求格式不正确。', recoverable: false })
    return sse.close()
  }

  const identity = await identityFromReq(req)
  const sse = openSSE(res)
  const key = getAmapKey()
  const deps = {
    resolveLocation,
    understand: (raw, loc, persona, preferences) => understand(raw, loc, persona, preferences, {}),
    retrieve: (keywords, loc) => retrieve({ keywords, location: loc, key }, {
      readCache: (k) => readCache(k), writeCache: (k, payload) => writeCache(k, payload),
    }),
    streamExplanation: (route, c) => streamExplanation(route, c, { apiKey: process.env.DEEPSEEK_API_KEY ?? '' }),
    savePlan: (record) => (hasDatabase() ? savePlan(record) : Promise.resolve({ id: record.id })),
    planId: () => `plan-${randomUUID()}`,
  }

  try {
    for await (const event of runPlanLoop(parsed.data, identity, deps)) {
      sse.send(event)
    }
  } catch (err) {
    sse.send({ type: 'error', code: 'upstream-unavailable', message: '规划过程出现异常，请稍后再试。', recoverable: true })
  } finally {
    sse.close()
  }
}
