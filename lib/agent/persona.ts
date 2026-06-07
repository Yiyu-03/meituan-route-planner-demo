import type { Persona } from './types.js'

export const PERSONAS: Record<Persona['id'], Persona> = {
  couple: {
    id: 'couple', label: '情侣',
    sceneWeights: { romantic: 1.0, quiet: 0.7, photo: 0.6, upscale: 0.4, cultural: 0.5, lively: 0.1, nightlife: 0.2, foodie: 0.5, local: 0.3, nature: 0.4 },
    categoryPriority: { cafe: 0.5, dining: 0.4, culture: 0.5, nightscape: 0.4 },
    budgetSensitivity: 0.4, walkTolerance: 18, latestEnd: 22.5, partyDefault: 2, pace: 'normal',
  },
  family: {
    id: 'family', label: '家庭',
    sceneWeights: { family: 1.0, quiet: 0.5, cultural: 0.6, nature: 0.7, photo: 0.3, local: 0.4, foodie: 0.5, budget: 0.3, lively: 0.2, nightlife: -1.0, upscale: -0.2 },
    categoryPriority: { culture: 0.6, dining: 0.5, shopping: 0.3, entertainment: 0.2 },
    budgetSensitivity: 0.6, walkTolerance: 14, latestEnd: 20.5, partyDefault: 3, pace: 'relaxed',
  },
  friends: {
    id: 'friends', label: '朋友',
    sceneWeights: { lively: 0.9, foodie: 0.7, trendy: 0.6, photo: 0.5, local: 0.5, budget: 0.4, romantic: 0.2, nightlife: 0.4, cultural: 0.4, nature: 0.3 },
    categoryPriority: { dining: 0.6, entertainment: 0.4, cafe: 0.4, shopping: 0.4 },
    budgetSensitivity: 0.5, walkTolerance: 20, latestEnd: 23, partyDefault: 4, pace: 'normal',
  },
  solo: {
    id: 'solo', label: '独行',
    sceneWeights: { quiet: 0.9, cultural: 0.9, local: 0.7, photo: 0.4, nature: 0.5, foodie: 0.5, budget: 0.4, lively: -0.1, romantic: 0.1, nightlife: 0.1 },
    categoryPriority: { culture: 0.7, cafe: 0.5, dining: 0.4, shopping: 0.2 },
    budgetSensitivity: 0.5, walkTolerance: 22, latestEnd: 21.5, partyDefault: 1, pace: 'normal',
  },
}

/** Map the contract personaPick (auto|couple|family|friends|solo) to a Persona. */
export function personaFor(pick: 'auto' | Persona['id']): Persona {
  if (pick === 'auto') return PERSONAS.friends
  return PERSONAS[pick]
}
