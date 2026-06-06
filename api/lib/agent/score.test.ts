import { describe, it, expect } from 'vitest'
import { scorePOIs, SCORE_WEIGHTS } from './score'
import { personaFor } from './persona'
import type { EnrichedPOI } from './types'
import type { Constraints } from '../../../contract/index'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [], openHour: 9, closeHour: 21,
    photos: [], tel: null, source: 'amap', sceneTags: [], avgDuration: 50, ...over,
  }
}

const constraints: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['cafe', 'dining'], pace: 'normal', personaId: 'couple', raw: '安静咖啡',
}

describe('SCORE_WEIGHTS', () => {
  it('has no popularity/queue/ugc and sums to 100', () => {
    expect('popularity' in SCORE_WEIGHTS).toBe(false)
    expect('queue' in SCORE_WEIGHTS).toBe(false)
    expect('ugcBonus' in SCORE_WEIGHTS).toBe(false)
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBe(100)
  })
})

describe('scorePOIs', () => {
  it('ranks a pref-matching POI above a non-matching one', () => {
    const quiet = poi({ id: 'quiet', sceneTags: ['quiet'] })
    const loud = poi({ id: 'loud', sceneTags: ['lively'] })
    const ranked = scorePOIs([loud, quiet], constraints, personaFor('couple'), 31.22, 121.44)
    expect(ranked[0].poi.id).toBe('quiet')
    expect(ranked[0].reasons.length).toBeGreaterThan(0)
  })

  it('handles null rating/perCapita without fabricating a value', () => {
    const bare = poi({ id: 'bare', rating: null, perCapita: null })
    const ranked = scorePOIs([bare], constraints, personaFor('solo'), 31.22, 121.44)
    expect(Number.isFinite(ranked[0].score)).toBe(true)
    expect(ranked[0].poi.rating).toBeNull()
    expect(ranked[0].sources.rating).toBe('amap')
  })
})
