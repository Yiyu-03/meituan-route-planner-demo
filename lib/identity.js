import { parseBearer } from './auth.js'
import { userForSession } from './db/users.js'
import { hasDatabase } from './db/client.js'

/**
 * Resolve the caller's identity from one opaque Bearer token (with an x-device-token
 * fallback). A token that matches a user session => user; otherwise the same token IS
 * the guest device token. This keeps guest plans + history scoped to one stable token.
 */
export async function resolveIdentity(req) {
  const bearer = parseBearer(req.headers?.authorization)
  const headerDevice = String(req.headers?.['x-device-token'] || '').trim() || null
  const token = bearer || headerDevice
  if (token && hasDatabase()) {
    const user = await userForSession(token)
    if (user) return { userId: Number(user.id), deviceToken: null, user }
  }
  return { userId: null, deviceToken: token, user: null }
}
