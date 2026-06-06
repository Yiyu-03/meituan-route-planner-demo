import { neon } from '@neondatabase/serverless'

let cached = null

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/** Returns a tagged-template SQL function bound to DATABASE_URL. Throws if unset. */
export function getSql() {
  if (!hasDatabase()) throw new Error('DATABASE_URL is not configured')
  if (!cached) cached = neon(process.env.DATABASE_URL)
  return cached
}
