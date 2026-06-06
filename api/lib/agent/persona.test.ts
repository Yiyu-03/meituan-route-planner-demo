import { describe, it, expect } from 'vitest'
import { personaFor, PERSONAS } from './persona'

describe('personaFor', () => {
  it('returns the requested persona', () => {
    expect(personaFor('couple').id).toBe('couple')
    expect(personaFor('family').id).toBe('family')
  })

  it('resolves auto to friends by default', () => {
    expect(personaFor('auto').id).toBe('friends')
  })

  it('couple weights romantic higher than friends does', () => {
    const couple = PERSONAS.couple.sceneWeights.romantic ?? 0
    const friends = PERSONAS.friends.sceneWeights.romantic ?? 0
    expect(couple).toBeGreaterThan(friends)
  })

  it('family forbids nightlife (non-positive weight)', () => {
    expect(PERSONAS.family.sceneWeights.nightlife ?? 0).toBeLessThanOrEqual(0)
  })
})
