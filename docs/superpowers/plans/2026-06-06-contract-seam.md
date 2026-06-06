# Plan 0 · Contract Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frozen `contract/` package — shared data types, zod-validated SSE event schemas, SSE framing helpers, and recorded SSE fixtures — that both the backend and frontend worktrees import.

**Architecture:** A standalone `contract/` directory at the repo root. Data shapes and event shapes are defined as **zod schemas** and TS types are *inferred* from them, so we get one source of truth plus runtime validation for free. A small framing module encodes/parses the SSE wire format. Hand-authored fixtures represent real plan streams; a test asserts every fixture conforms to the schema — this test is the "seam guard" that fails the moment either worktree drifts from the contract.

**Tech Stack:** TypeScript (ESM), zod, vitest.

---

## File Structure

```
contract/
  index.ts        # barrel: re-exports types, events, framing
  types.ts        # zod schemas + inferred types for data shapes
  events.ts       # zod schemas for SSE events + the plan request
  framing.ts      # encodeSSE / parseSSE wire helpers
  fixtures/
    shanghai-quiet-cafe.sse.txt   # a full happy-path stream
    needs-clarification.sse.txt   # an error stream
  __tests__/
    types.test.ts
    events.test.ts
    framing.test.ts
    fixtures.test.ts
vitest.config.ts  # repo root, picks up contract/**/*.test.ts
```

This package has no dependency on `src/` or `api/`. Both worktrees import from `contract/`.

---

## Task 1: Set up the contract package and test runner

**Files:**
- Modify: `package.json` (add deps + test script)
- Create: `vitest.config.ts`
- Create: `contract/index.ts`

- [ ] **Step 1: Install zod and vitest**

Run:
```bash
npm install zod && npm install -D vitest
```
Expected: both added to `package.json`, no errors.

- [ ] **Step 2: Add a test script to package.json**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['contract/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Create a placeholder barrel so the package resolves**

Create `contract/index.ts`:
```ts
export * from './types'
export * from './events'
export * from './framing'
```
(The three modules are created in later tasks; this file will fail to typecheck until then — that is expected and resolved by Task 4.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts contract/index.ts
git commit -m "chore: scaffold contract package with vitest + zod"
```

---

## Task 2: Data shape schemas (`contract/types.ts`)

These mirror the planner's data model, trimmed for no-mock (no `reviews`, no `queueBase`). Types are inferred from zod schemas.

**Files:**
- Create: `contract/types.ts`
- Test: `contract/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `contract/__tests__/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ConstraintsSchema, ScoredPOISchema, RouteSchema } from '../types'

describe('data schemas', () => {
  it('accepts a valid Constraints object', () => {
    const c = {
      city: '上海', district: '静安寺', startTime: 14, durationMin: 330,
      party: 2, budgetPerCapita: null, diningBudgetPerCapita: 300,
      prefs: ['quiet'], avoid: [], mustCategories: ['dining'],
      pace: 'normal', personaId: 'couple', raw: '周末下午…',
    }
    expect(() => ConstraintsSchema.parse(c)).not.toThrow()
  })

  it('rejects a POI that carries a fabricated review count', () => {
    const poi = {
      id: 'B0I6Y7URLT', name: '红子鸡凤凰楼', category: 'dining',
      city: '上海', area: '静安寺', lat: 31.24, lng: 121.44,
      rating: 4.8, perCapita: 137, tags: ['本帮菜'],
      source: 'amap', reviews: 9999, // <-- not in schema, must be stripped/rejected
    }
    const parsed = ScoredPOISchema.shape.poi.parse(poi) as Record<string, unknown>
    expect('reviews' in parsed).toBe(false)
  })

  it('accepts a valid Route with stops', () => {
    const route = {
      id: 'route-0',
      stops: [{
        poi: { id: 'p1', name: '咖啡', category: 'cafe', city: '上海', area: '静安寺',
          lat: 31.2, lng: 121.4, rating: 4.5, perCapita: 78, tags: ['安静'], source: 'amap' },
        arrive: 14, depart: 15, legFromPrev: null, reasons: ['命中需求：安静'],
        sources: { rating: 'amap', perCapita: 'amap', sceneTags: 'derived' },
      }],
      totalCost: 78, totalWalkMin: 0, totalTransitMin: 0, endTime: 15,
      coverage: ['cafe'], checks: [], explanation: '', risks: [],
    }
    expect(() => RouteSchema.parse(route)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run contract/__tests__/types.test.ts`
Expected: FAIL — cannot resolve `../types` exports.

- [ ] **Step 3: Implement the schemas**

Create `contract/types.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run contract/__tests__/types.test.ts`
Expected: PASS (3 tests). The `reviews` test passes because `.strict()` on `POISchema` rejects unknown keys — adjust the test if you prefer strip semantics; here we assert rejection by catching:

If Step 1's `reviews` test fails because `.strict()` throws instead of stripping, change that test body to:
```ts
expect(() => ScoredPOISchema.shape.poi.parse(poi)).toThrow()
```

- [ ] **Step 5: Commit**

```bash
git add contract/types.ts contract/__tests__/types.test.ts
git commit -m "feat(contract): data shape schemas with no-mock provenance"
```

---

## Task 3: SSE event + request schemas (`contract/events.ts`)

**Files:**
- Create: `contract/events.ts`
- Test: `contract/__tests__/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `contract/__tests__/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PlanRequestSchema, SSEEventSchema } from '../events'

describe('plan request', () => {
  it('accepts a minimal request', () => {
    const req = {
      request: '静安找个安静咖啡', preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: null,
    }
    expect(() => PlanRequestSchema.parse(req)).not.toThrow()
  })
})

describe('SSE events', () => {
  it('accepts a stage event', () => {
    const e = { type: 'stage', key: 'retrieve', label: '召回', status: 'ok', ms: 120, summary: '18 家' }
    expect(() => SSEEventSchema.parse(e)).not.toThrow()
  })
  it('accepts an explanation delta', () => {
    const e = { type: 'explanation', routeId: 'route-0', delta: '收尾轻量游览' }
    expect(() => SSEEventSchema.parse(e)).not.toThrow()
  })
  it('accepts an error event', () => {
    const e = { type: 'error', code: 'insufficient-data', message: '真实地点不足', recoverable: true }
    expect(() => SSEEventSchema.parse(e)).not.toThrow()
  })
  it('rejects an unknown event type', () => {
    expect(() => SSEEventSchema.parse({ type: 'mystery' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run contract/__tests__/events.test.ts`
Expected: FAIL — cannot resolve `../events`.

- [ ] **Step 3: Implement the schemas**

Create `contract/events.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run contract/__tests__/events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add contract/events.ts contract/__tests__/events.test.ts
git commit -m "feat(contract): SSE event + plan request schemas"
```

---

## Task 4: SSE framing helpers (`contract/framing.ts`)

Backend uses `encodeSSE` to write events; tests and the frontend dev harness use `parseSSE` to read fixtures.

**Files:**
- Create: `contract/framing.ts`
- Test: `contract/__tests__/framing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `contract/__tests__/framing.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { encodeSSE, parseSSE } from '../framing'
import type { SSEEvent } from '../events'

describe('SSE framing', () => {
  it('round-trips events through the wire format', () => {
    const events: SSEEvent[] = [
      { type: 'stage', key: 'understand', label: '读懂需求', status: 'ok' },
      { type: 'error', code: 'insufficient-data', message: 'x', recoverable: true },
    ]
    const wire = events.map(encodeSSE).join('')
    expect(wire).toContain('event: stage\n')
    expect(wire).toContain('data: ')
    const parsed = parseSSE(wire)
    expect(parsed).toEqual(events)
  })

  it('ignores comments and blank lines', () => {
    const wire = ': keep-alive\n\nevent: stage\ndata: {"type":"stage","key":"k","label":"l","status":"ok"}\n\n'
    const parsed = parseSSE(wire)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].type).toBe('stage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run contract/__tests__/framing.test.ts`
Expected: FAIL — cannot resolve `../framing`.

- [ ] **Step 3: Implement the helpers**

Create `contract/framing.ts`:
```ts
import { SSEEventSchema, type SSEEvent } from './events'

/** Encode one event as an SSE frame: `event: <type>\ndata: <json>\n\n`. */
export function encodeSSE(event: SSEEvent): string {
  const data = JSON.stringify(event)
  return `event: ${event.type}\ndata: ${data}\n\n`
}

/** Parse a complete SSE text blob into validated events. Skips comments/keep-alives. */
export function parseSSE(text: string): SSEEvent[] {
  const out: SSEEvent[] = []
  for (const block of text.split('\n\n')) {
    const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
    if (!dataLine) continue
    const json = dataLine.slice(dataLine.indexOf(':') + 1).trim()
    if (!json) continue
    out.push(SSEEventSchema.parse(JSON.parse(json)))
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run contract/__tests__/framing.test.ts`
Expected: PASS (2 tests). Also run `npx tsc --noEmit` to confirm `contract/index.ts` now typechecks.

- [ ] **Step 5: Commit**

```bash
git add contract/framing.ts contract/__tests__/framing.test.ts
git commit -m "feat(contract): SSE wire encode/parse helpers"
```

---

## Task 5: Fixtures + seam guard test

Hand-author two representative streams. The test validates them against the schema — this is the guard that fails when either worktree drifts.

**Files:**
- Create: `contract/fixtures/shanghai-quiet-cafe.sse.txt`
- Create: `contract/fixtures/needs-clarification.sse.txt`
- Test: `contract/__tests__/fixtures.test.ts`

- [ ] **Step 1: Write the failing test**

Create `contract/__tests__/fixtures.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseSSE } from '../framing'

const dir = join(__dirname, '..', 'fixtures')

describe('fixtures conform to the contract', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sse.txt'))
  it('has at least two fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(2)
  })
  for (const f of files) {
    it(`parses ${f} with no schema errors`, () => {
      const text = readFileSync(join(dir, f), 'utf8')
      expect(() => parseSSE(text)).not.toThrow()
    })
  }
  it('happy-path fixture ends with a done event', () => {
    const text = readFileSync(join(dir, 'shanghai-quiet-cafe.sse.txt'), 'utf8')
    const events = parseSSE(text)
    expect(events.at(-1)?.type).toBe('done')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run contract/__tests__/fixtures.test.ts`
Expected: FAIL — fixtures directory empty / files missing.

- [ ] **Step 3: Author the happy-path fixture**

Create `contract/fixtures/shanghai-quiet-cafe.sse.txt` (each event is a valid `SSEEvent`; one POI shown for brevity, add a 2nd/3rd stop following the same shape):
```
event: stage
data: {"type":"stage","key":"understand","label":"读懂需求","status":"ok","ms":1400}

event: constraints
data: {"type":"constraints","constraints":{"city":"上海","district":"静安寺","startTime":14,"durationMin":330,"party":2,"budgetPerCapita":null,"diningBudgetPerCapita":300,"prefs":["quiet"],"avoid":[],"mustCategories":["dining"],"pace":"normal","personaId":"couple","raw":"周末下午在静安找个安静咖啡，再吃顿本帮菜，人均300内"}}

event: stage
data: {"type":"stage","key":"retrieve","label":"召回","status":"ok","ms":260,"summary":"18 家真实店"}

event: candidates
data: {"type":"candidates","candidates":[{"poi":{"id":"B0LBRRKLFC","name":"看得到风景的咖啡馆","category":"cafe","city":"上海","area":"静安寺","lat":31.224,"lng":121.443,"rating":4.5,"perCapita":78,"tags":["安静","拍照"],"openHour":9,"closeHour":20,"photos":["https://aos-comment.amap.com/B0LBRRKLFC/comment/444ed6fe82367e685163efc4a02f4a22_2048_2048_80.jpg"],"tel":null,"source":"amap"},"score":82.4,"reasons":["命中你的需求：安静"],"sources":{"rating":"amap","perCapita":"amap","sceneTags":"derived"}}]}

event: route
data: {"type":"route","route":{"id":"route-0","stops":[{"poi":{"id":"B0LBRRKLFC","name":"看得到风景的咖啡馆","category":"cafe","city":"上海","area":"静安寺","lat":31.224,"lng":121.443,"rating":4.5,"perCapita":78,"tags":["安静"],"openHour":9,"closeHour":20,"photos":[],"tel":null,"source":"amap"},"arrive":14,"depart":15,"legFromPrev":null,"reasons":["命中你的需求：安静"],"sources":{"rating":"amap","perCapita":"amap"}}],"totalCost":78,"totalWalkMin":0,"totalTransitMin":0,"endTime":15,"coverage":["cafe"],"checks":[{"key":"budget","label":"预算","status":"pass","detail":"人均合计 ¥78"}],"explanation":"","risks":[]}}

event: explanation
data: {"type":"explanation","routeId":"route-0","delta":"先到靠窗的安静咖啡馆坐下，"}

event: explanation
data: {"type":"explanation","routeId":"route-0","delta":"光线好、适合接电话。"}

event: done
data: {"type":"done","planId":"plan-demo-1","routes":[{"id":"route-0","stops":[{"poi":{"id":"B0LBRRKLFC","name":"看得到风景的咖啡馆","category":"cafe","city":"上海","area":"静安寺","lat":31.224,"lng":121.443,"rating":4.5,"perCapita":78,"tags":["安静"],"openHour":9,"closeHour":20,"photos":[],"tel":null,"source":"amap"},"arrive":14,"depart":15,"legFromPrev":null,"reasons":["命中你的需求：安静"],"sources":{"rating":"amap","perCapita":"amap"}}],"totalCost":78,"totalWalkMin":0,"totalTransitMin":0,"endTime":15,"coverage":["cafe"],"checks":[],"explanation":"先到靠窗的安静咖啡馆坐下，光线好、适合接电话。","risks":[]}],"dataSources":{"amapPoi":{"configured":true,"used":true,"status":"ok"},"amapRoute":{"configured":true,"used":true,"status":"ok"},"deepseek":{"configured":true,"used":true,"status":"ok"},"cache":{"hits":1,"misses":2}}}

```

- [ ] **Step 4: Author the error fixture**

Create `contract/fixtures/needs-clarification.sse.txt`:
```
event: stage
data: {"type":"stage","key":"understand","label":"读懂需求","status":"ok","ms":1200}

event: error
data: {"type":"error","code":"needs-clarification","message":"需要补充城市，未默认回上海。","recoverable":true}

```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run contract/__tests__/fixtures.test.ts`
Expected: PASS. If a fixture fails, the error names the offending field — fix the fixture JSON to match the schema (do NOT loosen the schema).

- [ ] **Step 6: Commit**

```bash
git add contract/fixtures contract/__tests__/fixtures.test.ts
git commit -m "feat(contract): seam-guard fixtures for happy path + clarification"
```

---

## Task 6: Full suite green + freeze note

**Files:**
- Modify: `contract/index.ts` (add a freeze banner comment)

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: all contract tests PASS.

- [ ] **Step 2: Add a freeze banner to the barrel**

Prepend to `contract/index.ts`:
```ts
// ⚠️ FROZEN CONTRACT — the seam between worktree A (backend) and B (frontend).
// Changing anything here requires syncing BOTH worktrees on main. Do not edit in a feature branch.
```

- [ ] **Step 3: Commit**

```bash
git add contract/index.ts
git commit -m "docs(contract): freeze banner; contract seam complete"
```

---

## Self-Review

**Spec coverage:** Covers spec §3 (contract: types.ts, events.ts, fixtures) and the SSE event table in §3 — every event in the spec table (`stage/constraints/candidates/route/explanation/done/error`) has a schema in Task 3 and appears in a fixture in Task 5. The no-mock provenance policy (§1) is enforced by `FieldSource` + `.strict()` POISchema (Task 2). Framing (Task 4) supports backend emit / frontend consume (§6).

**Placeholder scan:** No TBD/TODO. The happy-path fixture notes "add a 2nd/3rd stop following the same shape" — this is an explicit instruction with a complete example to copy, not a placeholder.

**Type consistency:** `SSEEvent` discriminated union (events.ts) is consumed by `encodeSSE`/`parseSSE` (framing.ts). `POISchema` field names (`perCapita`, `openHour`, `closeHour`, `photos`, `tel`, `rating` nullable) are identical across types.ts, fixtures, and tests. `personaId` enum values match between `ConstraintsSchema` and `PlanRequestSchema.preferences.personaPick` (latter adds `'auto'`).

---

## Execution Handoff

This is Plan 0 of 3. Plans A (backend) and B (frontend) depend on this frozen contract and will be written next.
