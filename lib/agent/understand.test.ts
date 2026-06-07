import { describe, it, expect } from 'vitest'
import { parseConstraintsFallback, fallbackKeywords } from './understand.js'
import { personaFor } from './persona.js'

const loc = { city: '上海', district: '静安寺', center: { lat: 31.22, lng: 121.44 } }

describe('parseConstraintsFallback', () => {
  it('extracts start time, dining budget, prefs and must categories', () => {
    const c = parseConstraintsFallback(
      '周末下午在静安找个安静咖啡，再吃顿本帮菜，预算300吃饭', loc, personaFor('couple'),
    )
    expect(c.city).toBe('上海')
    expect(c.district).toBe('静安寺')
    expect(c.startTime).toBe(14)
    expect(c.diningBudgetPerCapita).toBe(300)
    expect(c.budgetPerCapita).toBeNull()
    expect(c.prefs).toContain('quiet')
    expect(c.mustCategories).toContain('cafe')
    expect(c.mustCategories).toContain('dining')
    expect(c.personaId).toBe('couple')
  })

  it('parses a total per-capita budget', () => {
    const c = parseConstraintsFallback('人均200逛逛', loc, personaFor('friends'))
    expect(c.budgetPerCapita).toBe(200)
    expect(c.diningBudgetPerCapita).toBeNull()
  })

  it('avoid pattern removes the pref and records avoid', () => {
    const c = parseConstraintsFallback('找个地方但不要太吵', loc, personaFor('solo'))
    expect(c.prefs).not.toContain('lively')
    expect(c.avoid).toContain('lively')
  })
})

describe('fallbackKeywords', () => {
  it('builds district-scoped category keywords with no hardcoded city anchors', () => {
    const c = parseConstraintsFallback('吃本帮菜喝咖啡', loc, personaFor('couple'))
    const kw = fallbackKeywords(c)
    expect(kw.some((k) => k.includes('咖啡'))).toBe(true)
    expect(kw.some((k) => k.includes('餐'))).toBe(true)
    // never injects a city it was not given
    expect(kw.every((k) => !k.includes('乌鲁木齐') && !k.includes('北京'))).toBe(true)
    expect(kw.length).toBeLessThanOrEqual(8)
  })
})
