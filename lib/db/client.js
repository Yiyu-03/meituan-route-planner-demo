import { neon } from '@neondatabase/serverless'

let cached = null

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/** Retry a transient DB op (Neon HTTP can blip on cold/serverless connections). */
async function withRetry(fn, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 150 * (i + 1)))
    }
  }
  throw lastErr
}

/**
 * Returns a tagged-template SQL function bound to DATABASE_URL, with transient-retry.
 * Usage is unchanged: `await sql\`SELECT ...\`` or `await sql.query(text, params)`.
 */
export function getSql() {
  if (!hasDatabase()) throw new Error('DATABASE_URL is not configured')
  if (!cached) {
    const base = neon(process.env.DATABASE_URL)
    const wrapped = (...args) => withRetry(() => base(...args))
    wrapped.query = (...args) => withRetry(() => base.query(...args))
    cached = wrapped
  }
  return cached
}
