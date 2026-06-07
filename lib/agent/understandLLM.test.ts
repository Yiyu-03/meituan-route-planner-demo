import { describe, it, expect } from 'vitest'
import { understand } from './understandLLM.js'
import { personaFor } from './persona.js'

const loc = { city: '上海', district: '静安区', center: { lat: 31.22, lng: 121.44 } }
const prefs = { personaPick: 'couple' as const, prefs: ['quiet'], budgetPref: null }

describe('understand', () => {
  it('uses LLM output when available and keeps city from resolveLocation', async () => {
    const result = await understand('静安找安静咖啡再吃本帮菜', loc, personaFor('couple'), prefs, {
      chatJson: async () => ({ prefs: ['quiet', 'romantic'], mustCategories: ['cafe', 'dining'], startHour: 14, durationMin: 300, party: 2, diningBudget: 300, keywords: ['静安区 安静咖啡', '静安区 本帮菜'] }),
    })
    expect(result.llmUsed).toBe(true)
    expect(result.constraints.city).toBe('上海')
    expect(result.constraints.prefs).toContain('romantic')
    expect(result.keywords).toContain('静安区 本帮菜')
    expect(result.constraints.diningBudgetPerCapita).toBe(300)
  })

  it('falls back to deterministic parser when LLM returns null', async () => {
    const result = await understand('人均200逛逛', loc, personaFor('friends'), { personaPick: 'friends', prefs: [], budgetPref: null }, {
      chatJson: async () => null,
    })
    expect(result.llmUsed).toBe(false)
    expect(result.constraints.budgetPerCapita).toBe(200)
    expect(result.keywords.length).toBeGreaterThan(0)
  })

  it('extracts a specific-place anchor from the request', async () => {
    const result = await understand('在新世界城附近吃本帮菜', loc, personaFor('couple'), prefs, {
      chatJson: async () => ({ anchor: '新世界城', mustCategories: ['dining'], keywords: ['本帮菜'] }),
    })
    expect(result.anchor).toBe('新世界城')
  })

  it('extracts a district-name anchor from the request', async () => {
    const result = await understand('静安找咖啡', loc, personaFor('solo'), { personaPick: 'solo', prefs: [], budgetPref: null }, {
      chatJson: async () => ({ anchor: '静安', mustCategories: ['cafe'], keywords: ['咖啡'] }),
    })
    expect(result.anchor).toBe('静安')
  })

  it('returns null anchor when none is given', async () => {
    const result = await understand('在上海玩', loc, personaFor('friends'), { personaPick: 'friends', prefs: [], budgetPref: null }, {
      chatJson: async () => ({ anchor: null, mustCategories: [], keywords: ['上海 景点'] }),
    })
    expect(result.anchor).toBeNull()
  })

  it('anchor is null when the LLM is unavailable', async () => {
    const result = await understand('随便逛逛', loc, personaFor('friends'), { personaPick: 'friends', prefs: [], budgetPref: null }, {
      chatJson: async () => null,
    })
    expect(result.anchor).toBeNull()
  })
})
