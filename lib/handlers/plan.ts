import { randomUUID } from 'node:crypto'
import { PlanRequestSchema } from '../../contract/index.js'
import { resolveLocation, getAmapKey } from '../locationResolver.js'
import { openSSE } from '../sse.js'
import { createGuest } from '../db/users.js'
import { resolveIdentity } from '../identity.js'
import { savePlan } from '../db/plans.js'
import { hasDatabase } from '../db/client.js'
import { runPlanLoop } from '../agent/loop.js'
import { runReactLoop } from '../agent/react.js'
import { understand } from '../agent/understandLLM.js'
import { retrieve } from '../agent/retrieve.js'
import { streamExplanation } from '../agent/explain.js'
import { walkingLeg, drivingLeg } from '../amap/client.js'
import { attachRealLegs } from '../agent/legs.js'
import { readCache, writeCache } from '../amap/cache.js'
import { chatJson } from '../deepseek/client.js'
import { saveConversation, loadConversation } from '../db/conversations.js'

function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return req.body
}

async function identityFromReq(req) {
  const id = await resolveIdentity(req)
  if (id.userId) return { userId: id.userId, deviceToken: null }
  // Guest: the caller's Bearer token IS their device token (stable across plan + history).
  const device = id.deviceToken || randomUUID()
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

  const reqData = parsed.data
  const identity = await identityFromReq(req)
  const sse = openSSE(res)
  const key = getAmapKey()
  const apiKey = process.env.DEEPSEEK_API_KEY ?? ''

  // single-keyword real POI search (amap place/text via cache) — ReAct's searchPOI tool.
  const searchPOI = async (keyword, district) => {
    const resolved = await resolveLocation(reqData.request).catch(() => null)
    const city = resolved?.city ?? null
    if (!city) return []
    const result = await retrieve(
      { keywords: [keyword], location: { city, district: district ?? null, center: resolved.center }, key },
      { readCache: (k) => readCache(k), writeCache: (k, payload) => writeCache(k, payload) },
    )
    return result.pois
  }

  // Real Amap walking/driving leg with a route cache (key by mode + rounded coords) to guard quota.
  const cachedLeg = async (from, to, mode) => {
    const k = `leg:${mode}:${from.lng.toFixed(4)},${from.lat.toFixed(4)}>${to.lng.toFixed(4)},${to.lat.toFixed(4)}`
    const hit = await readCache(k).catch(() => null)
    if (hit && typeof hit.minutes === 'number') return hit
    const r = mode === 'walk' ? await walkingLeg({ from, to, key }) : await drivingLeg({ from, to, key })
    if (r) await writeCache(k, r).catch(() => {})
    return r
  }

  const sharedDeps = {
    resolveLocation,
    attachLegs: key ? (route) => attachRealLegs(route, cachedLeg) : undefined,
    understand: (raw, loc, persona, preferences) => understand(raw, loc, persona, preferences, {}),
    retrieve: (keywords, loc) => retrieve({ keywords, location: loc, key }, {
      readCache: (k) => readCache(k), writeCache: (k, payload) => writeCache(k, payload),
    }),
    streamExplanation: (route, c) => streamExplanation(route, c, { apiKey }),
    savePlan: (record) => (hasDatabase() ? savePlan(record) : Promise.resolve({ id: record.id })),
    planId: () => `plan-${randomUUID()}`,
  }

  try {
    // ── replan: editing an existing plan stays on the deterministic loop ──
    if (reqData.previousPlan != null && reqData.previousPlan.stops.length >= 2) {
      const deps = { ...sharedDeps, editChatJson: (messages) => chatJson({ apiKey, messages }) }
      for await (const event of runPlanLoop(reqData, identity, deps)) sse.send(event)
    } else {
      // ── new / resumed conversational ReAct plan ──
      let priorState
      if (reqData.conversationId && reqData.answer && hasDatabase()) {
        const conv = await loadConversation(reqData.conversationId).catch(() => null)
        if (conv) priorState = conv.state
      }
      const reactDeps = {
        ...sharedDeps,
        searchPOI,
        saveConversation: (id, owner, state) =>
          (hasDatabase() ? saveConversation(id, owner, state) : Promise.resolve({ id })),
        conversationId: () => `conv-${randomUUID()}`,
        chatJson: (messages) => chatJson({ apiKey, messages }),
        priorState,
      }
      for await (const event of runReactLoop(reqData, identity, reactDeps)) sse.send(event)
    }
  } catch (err) {
    sse.send({ type: 'error', code: 'upstream-unavailable', message: '规划过程出现异常，请稍后再试。', recoverable: true })
  } finally {
    sse.close()
  }
}
