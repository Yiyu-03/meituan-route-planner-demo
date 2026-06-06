import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false
  return bcrypt.compare(plain, hash)
}

/** Opaque session/device token. */
export function newToken() {
  return randomBytes(24).toString('hex')
}

/** Extract a bearer token from an Authorization header value. */
export function parseBearer(header) {
  const value = typeof header === 'string' ? header.trim() : ''
  const m = value.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/** Session expiry: 30 days from now (ISO). */
export function sessionExpiry() {
  return new Date(Date.now() + 30 * 86400_000).toISOString()
}
