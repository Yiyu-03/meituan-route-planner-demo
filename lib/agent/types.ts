import type { Category, Constraints, POI, Route, ScoredPOI } from '../../contract/index.js'

/** Internal persona: scene weights + behavioural defaults. NOT part of the frozen contract. */
export type SceneTag =
  | 'romantic' | 'quiet' | 'photo' | 'family' | 'lively' | 'cultural'
  | 'trendy' | 'local' | 'upscale' | 'budget' | 'nature' | 'nightlife' | 'foodie'

export interface Persona {
  id: 'couple' | 'family' | 'friends' | 'solo'
  label: string
  sceneWeights: Partial<Record<SceneTag, number>>
  categoryPriority: Partial<Record<Category, number>>
  budgetSensitivity: number   // 0..1
  walkTolerance: number       // minutes willing to walk per leg
  latestEnd: number           // preferred latest end hour
  partyDefault: number
  pace: 'relaxed' | 'normal' | 'packed'
}

/** A POI enriched for the deterministic core: contract POI + derived scene tags + stay duration. */
export interface EnrichedPOI extends POI {
  sceneTags: SceneTag[]   // derived from amap tags (provenance: 'derived')
  avgDuration: number     // minutes; derived from category + pace (provenance: 'derived')
}

export interface RetrieveResult {
  pois: EnrichedPOI[]
  center: { lat: number; lng: number }
  cacheHits: number
  cacheMisses: number
  amapStatus: 'ok' | 'empty' | 'not_configured' | 'error'
}

export interface UnderstandResult {
  constraints: Constraints
  keywords: string[]          // amap search keywords
  llmUsed: boolean
}

export type { Category, Constraints, POI, Route, ScoredPOI }
