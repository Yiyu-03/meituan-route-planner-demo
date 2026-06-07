import { describe, it, expect, beforeEach } from 'vitest'
import { getSql, hasDatabase } from './client.js'
import { saveConversation, loadConversation } from './conversations.js'

const maybe = hasDatabase() ? describe : describe.skip

maybe('conversations store', () => {
  beforeEach(async () => {
    const sql = getSql()
    await sql`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, owner TEXT, state JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ
    )`
    await sql`DELETE FROM conversations WHERE id LIKE 'test-conv-%'`
  })

  it('saves then loads a conversation with full state', async () => {
    const state = {
      messages: [{ role: 'assistant', content: '{"thought":"x"}' }],
      candidates: [{ id: 'p1', name: '店' }],
      constraints: { city: '上海' },
      city: '上海',
    }
    await saveConversation('test-conv-1', 'device-abc', state)
    const loaded = await loadConversation('test-conv-1')
    expect(loaded).not.toBeNull()
    expect(loaded!.owner).toBe('device-abc')
    expect(loaded!.state.city).toBe('上海')
    expect(loaded!.state.candidates).toHaveLength(1)
    expect(loaded!.state.messages[0].role).toBe('assistant')
  })

  it('upserts on the same id', async () => {
    await saveConversation('test-conv-2', 'd', { messages: [], candidates: [], constraints: {}, city: 'A' })
    await saveConversation('test-conv-2', 'd', { messages: [{ role: 'user', content: 'hi' }], candidates: [], constraints: {}, city: 'B' })
    const loaded = await loadConversation('test-conv-2')
    expect(loaded!.state.city).toBe('B')
    expect(loaded!.state.messages).toHaveLength(1)
  })

  it('returns null for a missing id', async () => {
    expect(await loadConversation('test-conv-missing')).toBeNull()
  })

  it('returns null when expired', async () => {
    await saveConversation('test-conv-3', 'd', { messages: [], candidates: [], constraints: {}, city: 'A' }, -1000)
    expect(await loadConversation('test-conv-3')).toBeNull()
  })
})
