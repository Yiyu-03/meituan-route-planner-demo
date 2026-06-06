import { z } from 'zod'

export const CategorySchema = z.enum([
  'dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape',
])
export type Category = z.infer<typeof CategorySchema>

export const PaceSchema = z.enum(['relaxed', 'normal', 'packed'])
export const PersonaIdSchema = z.enum(['couple', 'family', 'friends', 'solo'])

/** Where a single field's value came from (no-mock provenance). */
export const FieldSourceSchema = z.enum(['amap', 'user', 'derived'])
export type FieldSource = z.infer<typeof FieldSourceSchema>

/** A POI carries only real Amap fields + user/derived. `.strict()` drops fabricated fields. */
export const POISchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CategorySchema,
  city: z.string(),
  area: z.string(),
  lat: z.number(),
  lng: z.number(),
  rating: z.number().nullable(),       // amap business.rating (may be absent)
  perCapita: z.number().nullable(),    // amap business.cost (may be absent)
  tags: z.array(z.string()),           // amap business.tag tokens
  openHour: z.number().nullable(),     // parsed from amap opentime
  closeHour: z.number().nullable(),
  photos: z.array(z.string()).default([]),
  tel: z.string().nullable().default(null),
  source: z.literal('amap'),
}).strict()
export type POI = z.infer<typeof POISchema>

export const ScoredPOISchema = z.object({
  poi: POISchema,
  score: z.number(),
  reasons: z.array(z.string()),
  sources: z.record(z.string(), FieldSourceSchema), // per-field provenance
})
export type ScoredPOI = z.infer<typeof ScoredPOISchema>

export const ConstraintsSchema = z.object({
  city: z.string(),
  district: z.string().nullable(),
  startTime: z.number(),
  durationMin: z.number(),
  party: z.number(),
  budgetPerCapita: z.number().nullable(),
  diningBudgetPerCapita: z.number().nullable(),
  prefs: z.array(z.string()),
  avoid: z.array(z.string()),
  mustCategories: z.array(CategorySchema),
  pace: PaceSchema,
  personaId: PersonaIdSchema,
  raw: z.string(),
})
export type Constraints = z.infer<typeof ConstraintsSchema>

export const LegSchema = z.object({
  distM: z.number(),
  minutes: z.number(),
  mode: z.enum(['walk', 'transit']),
}).nullable()

export const CheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  detail: z.string(),
})
export type Check = z.infer<typeof CheckSchema>

export const RouteStopSchema = z.object({
  poi: POISchema,
  arrive: z.number(),
  depart: z.number(),
  legFromPrev: LegSchema,
  reasons: z.array(z.string()),
  sources: z.record(z.string(), FieldSourceSchema),
})
export type RouteStop = z.infer<typeof RouteStopSchema>

export const RouteSchema = z.object({
  id: z.string(),
  stops: z.array(RouteStopSchema),
  totalCost: z.number(),
  totalWalkMin: z.number(),
  totalTransitMin: z.number(),
  endTime: z.number(),
  coverage: z.array(CategorySchema),
  checks: z.array(CheckSchema),
  explanation: z.string(),
  risks: z.array(z.string()),
})
export type Route = z.infer<typeof RouteSchema>

export const DataSourceStatusSchema = z.object({
  configured: z.boolean(),
  used: z.boolean(),
  status: z.string(),
})
export const DataSourcesSchema = z.object({
  amapPoi: DataSourceStatusSchema,
  amapRoute: DataSourceStatusSchema,
  deepseek: DataSourceStatusSchema,
  cache: z.object({ hits: z.number(), misses: z.number() }),
})
export type DataSources = z.infer<typeof DataSourcesSchema>

export const PlanResultSchema = z.object({
  planId: z.string(),
  constraints: ConstraintsSchema,
  routes: z.array(RouteSchema),
  dataSources: DataSourcesSchema,
})
export type PlanResult = z.infer<typeof PlanResultSchema>
