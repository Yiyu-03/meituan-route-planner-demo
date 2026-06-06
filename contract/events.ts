import { z } from 'zod'
import {
  ConstraintsSchema, ScoredPOISchema, RouteSchema, DataSourcesSchema,
} from './types'

export const PlanRequestSchema = z.object({
  request: z.string().min(1),
  preferences: z.object({
    personaPick: z.enum(['auto', 'couple', 'family', 'friends', 'solo']),
    prefs: z.array(z.string()),
    budgetPref: z.number().nullable(),
  }),
  previousPlan: RouteSchema.nullable(),
  sessionId: z.string().optional(),
})
export type PlanRequest = z.infer<typeof PlanRequestSchema>

export const StageEventSchema = z.object({
  type: z.literal('stage'),
  key: z.string(),
  label: z.string(),
  status: z.enum(['running', 'ok', 'skip', 'fail']),
  ms: z.number().optional(),
  summary: z.string().optional(),
})
export const ConstraintsEventSchema = z.object({
  type: z.literal('constraints'),
  constraints: ConstraintsSchema,
})
export const CandidatesEventSchema = z.object({
  type: z.literal('candidates'),
  candidates: z.array(ScoredPOISchema),
})
export const RouteEventSchema = z.object({
  type: z.literal('route'),
  route: RouteSchema,
})
export const ExplanationEventSchema = z.object({
  type: z.literal('explanation'),
  routeId: z.string(),
  delta: z.string(),
})
export const DoneEventSchema = z.object({
  type: z.literal('done'),
  planId: z.string(),
  routes: z.array(RouteSchema),
  dataSources: DataSourcesSchema,
})
export const ErrorEventSchema = z.object({
  type: z.literal('error'),
  code: z.enum(['needs-clarification', 'insufficient-data', 'upstream-unavailable', 'bad-request']),
  message: z.string(),
  recoverable: z.boolean(),
})

export const SSEEventSchema = z.discriminatedUnion('type', [
  StageEventSchema, ConstraintsEventSchema, CandidatesEventSchema,
  RouteEventSchema, ExplanationEventSchema, DoneEventSchema, ErrorEventSchema,
])
export type SSEEvent = z.infer<typeof SSEEventSchema>
