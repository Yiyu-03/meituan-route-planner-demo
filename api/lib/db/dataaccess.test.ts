import { describe, it, expect, beforeEach } from 'vitest'
import { getSql, hasDatabase } from './client.js'
import { createUser, findUserByUsername, createSession, userForSession } from './users.js'
import { createGuest } from './users.js'
import { savePlan } from './plans.js'
import { listHistory, getPlan, migrateGuestPlans } from './history.js'
import { hashPassword, newToken, sessionExpiry } from '../auth.js'

const maybe = hasDatabase() ? describe : describe.skip

maybe('db data access', () => {
  beforeEach(async () => {
    const sql = getSql()
    await sql`TRUNCATE plans, sessions, guests, users RESTART IDENTITY CASCADE`
  })

  it('creates and looks up a user, issues a session', async () => {
    const user = await createUser({ username: 'amy', passwordHash: await hashPassword('pw'), prefs: ['quiet'], budgetPref: 200 })
    expect(user.username).toBe('amy')
    const again = await findUserByUsername('amy')
    expect(again!.id).toBe(user.id)
    const token = newToken()
    await createSession(token, user.id, sessionExpiry())
    const resolved = await userForSession(token)
    expect(resolved!.id).toBe(user.id)
  })

  it('saves plans and lists/gets history; migrates guest plans to a user', async () => {
    const device = newToken()
    await createGuest(device)
    await savePlan({ id: 'plan-1', userId: null, deviceToken: device, request: 'r', constraints: { city: '上海' }, routes: [], dataSources: {} })
    let hist = await listHistory({ deviceToken: device })
    expect(hist).toHaveLength(1)
    const got = await getPlan('plan-1')
    expect(got!.request).toBe('r')

    const user = await createUser({ username: 'bob', passwordHash: await hashPassword('pw'), prefs: [], budgetPref: null })
    await migrateGuestPlans(device, user.id)
    const userHist = await listHistory({ userId: user.id })
    expect(userHist).toHaveLength(1)
  })
})
