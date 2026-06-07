import { describe, it, expect } from 'vitest'
import { getSql, hasDatabase } from './client.js'

const maybe = hasDatabase() ? describe : describe.skip

maybe('db client', () => {
  it('runs a trivial query', async () => {
    const sql = getSql()
    const rows = await sql`SELECT 1 AS one`
    expect(rows[0].one).toBe(1)
  })

  it('schema tables exist after schema.sql is applied', async () => {
    const sql = getSql()
    const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
    const names = rows.map((r: any) => r.table_name)
    for (const t of ['users', 'sessions', 'guests', 'plans', 'poi_cache']) {
      expect(names).toContain(t)
    }
  })
})

describe('db client guard', () => {
  it('hasDatabase reflects DATABASE_URL presence', () => {
    expect(typeof hasDatabase()).toBe('boolean')
  })
})
