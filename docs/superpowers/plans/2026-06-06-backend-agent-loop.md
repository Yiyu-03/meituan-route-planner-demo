# Plan A · Backend Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the worktree-A backend: a `POST /api/plan` SSE orchestration endpoint whose **deterministic skeleton** (score → build → validate → repair → rank, ported from `src/engine`) is fed **real Amap POI data**, with LLM only at the two ends (`understand` for intent→constraints+keywords, `explain` for streamed reasoning). Plus username/password auth (bcrypt + session), guest device tokens, plan history, Neon Postgres persistence, and an Amap search cache that protects the 5000/month search quota. **No mock data, no fabricated POI features, no fallback fake routes** — honest empty states only (`needs-clarification` / `insufficient-data` / `upstream-unavailable`).

**Architecture:** Vercel Functions (Node runtime) + Fluid Compute. The HTTP entry `api/plan.js` opens an SSE stream and drives `api/lib/agent/loop.js`. The loop calls `resolveLocation` (reused), `understand` (DeepSeek small call), `retrieve` (Amap v5 `/place/text?show_fields=business,photos` + cache + feature extraction), then the pure deterministic core `score`/`build`/`validate`/`repair`/`rank` (ported, with `popularity`/`queue` features deleted and weights reallocated). The `route` event is emitted within seconds; `explain` streams `explanation` deltas afterward without blocking. Everything persists to Neon Postgres; nothing is held in module memory. All SSE events are framed with the frozen `contract/` `encodeSSE` and validated by `contract/` zod schemas — the seam never drifts.

**Tech Stack:** Node ESM, TypeScript for `api/lib/agent/*` pure functions (compiled/run via vitest + tsx), zod (from `contract/`), `@neondatabase/serverless`, `bcryptjs`, vitest. DeepSeek `deepseek-v4-flash`. Amap v5 REST.

---

## Preconditions

- **Plan 0 (contract seam) is merged to `main`.** `contract/index.ts` exports `ConstraintsSchema`, `ScoredPOISchema`, `POISchema`, `RouteSchema`, `RouteStopSchema`, `CheckSchema`, `DataSourcesSchema`, `PlanRequestSchema`, `SSEEventSchema`, the inferred TS types (`Constraints`, `POI`, `ScoredPOI`, `Route`, `RouteStop`, `Check`, `DataSources`, `PlanRequest`, `SSEEvent`, `Category`), and `encodeSSE` / `parseSSE`. **This plan imports those; it never re-defines them.**
- You are running in the `feat/backend-agent-loop` git worktree, branched from `main` after Plan 0. Create it with the superpowers:using-git-worktrees skill if it does not exist.
- `vitest.config.ts` at repo root already includes `contract/**/*.test.ts`; this plan extends `include` to also pick up `api/**/*.test.ts`.
- `.env.local` holds `AMAP_API_KEY`, `DEEPSEEK_API_KEY`, and (after Task 2) `DATABASE_URL` pointing at a Neon dev branch or local Postgres.
- Node 20+, `vercel` CLI available for `vercel dev`.

### Standing up a test database

DB-touching tests run against a real Postgres (Neon dev branch or local). Before the DB tasks:

```bash
# Option A — local Postgres via Docker:
docker run -d --name route-pg -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=route_test -p 5433:5432 postgres:16
export DATABASE_URL="postgres://postgres:pg@localhost:5433/route_test"

# Option B — Neon dev branch:
export DATABASE_URL="postgres://<user>:<pwd>@<neon-host>/<db>?sslmode=require"

# Apply schema (re-runnable; Task 9 creates schema.sql):
psql "$DATABASE_URL" -f api/lib/db/schema.sql
```

The Neon serverless driver speaks Postgres over HTTP/WebSocket, so the same `DATABASE_URL` works in `vercel dev`, in CI, and against local Postgres (set `neonConfig.poolQueryViaFetch`/`wsProxy` only when targeting non-Neon — see Task 9). Tests that need the DB **skip themselves** when `DATABASE_URL` is unset, so the pure-function suite stays runnable offline.

---

## File Structure (end state)

```
api/
  plan.js                         # POST /api/plan — SSE orchestration entry
  auth/
    register.js  login.js  guest.js  me.js
  history/
    index.js  [id].js
  lib/
    agent/
      types.ts                    # backend-only internal types (Persona, RetrieveResult, …)
      persona.ts                  # persona scene weights (user-pick driven)
      understand.ts               # parse fallback + DeepSeek-call shaping (pure parts unit-tested)
      retrieve.ts                 # Amap recall + cache + feature extraction → POI[]
      score.ts                    # ported scorePOIs (no popularity/queue)
      build.ts                    # ported beam search
      validate.ts                 # ported checks (queue check deleted)
      repair.ts                   # ported auto-repair
      rank.ts                     # ported ranking
      explain.ts                  # DeepSeek streamed reasoning + deterministic fallback
      loop.ts                     # orchestrates stages, yields SSE events
    amap/
      client.ts                   # injectable-fetch Amap v5 client (place/text, walking)
      poiFeatures.ts              # business/photos → POI fields (null when absent)
      cache.ts                    # poi_cache read/write, key normalization, TTL
    deepseek/
      client.ts                   # injectable-fetch DeepSeek client (stream + reasoning_content)
    db/
      schema.sql  client.ts  users.ts  plans.ts  history.ts
    sse.ts                        # SSE response setup + write(event) using contract encodeSSE
    errors.ts                     # PlanError + error codes
    auth.ts                       # bcrypt hash/verify, session token issue/verify, bearer parse
vercel.json                       # maxDuration 60, node runtime
```

The TS files under `api/lib/` are imported by the `.js` handlers via a thin compiled/`tsx` boundary (Vercel Node functions support `.ts`). Tests import the `.ts` modules directly through vitest.

---

## Task 1: Wire vitest to pick up backend tests + add deps

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Extend the vitest include glob**

Edit `vitest.config.ts` so `test.include` is:
```ts
    include: ['contract/**/*.test.ts', 'src/**/*.test.ts', 'api/**/*.test.ts'],
```
Leave the rest of the file untouched.

- [ ] **Step 2: Install runtime + dev deps**

Run:
```bash
npm install @neondatabase/serverless bcryptjs && npm install -D tsx @types/bcryptjs
```
Expected: added to `package.json`, no errors. (`zod` and `vitest` already present from Plan 0.)

- [ ] **Step 3: Confirm the suite still runs**

Run: `npm test`
Expected: PASS — the existing contract tests still green; no backend tests yet.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore(backend): vitest picks up api tests; add neon+bcrypt+tsx deps"
```

---

## Task 2: Backend internal types + error codes

The deterministic core needs a `Persona` shape (scene weights) that is **not** in the frozen contract (it is an internal detail). Errors map to the contract's `error` event codes.

**Files:**
- Create: `api/lib/agent/types.ts`
- Create: `api/lib/errors.ts`
- Test: `api/lib/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PlanError, isPlanError } from './errors'

describe('PlanError', () => {
  it('carries a contract error code + recoverable flag', () => {
    const e = new PlanError('insufficient-data', '真实地点不足', true)
    expect(e.code).toBe('insufficient-data')
    expect(e.recoverable).toBe(true)
    expect(isPlanError(e)).toBe(true)
    expect(isPlanError(new Error('plain'))).toBe(false)
  })

  it('toEvent() produces a contract-shaped error event', () => {
    const e = new PlanError('needs-clarification', '需要城市', true)
    expect(e.toEvent()).toEqual({
      type: 'error', code: 'needs-clarification', message: '需要城市', recoverable: true,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/errors.test.ts`
Expected: FAIL — cannot resolve `./errors`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/types.ts`:
```ts
import type { Category, Constraints, POI, Route, ScoredPOI } from '../../../contract/index'

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
```

Create `api/lib/errors.js`:
```js
/** @typedef {'needs-clarification'|'insufficient-data'|'upstream-unavailable'|'bad-request'} PlanErrorCode */

export class PlanError extends Error {
  /** @param {PlanErrorCode} code @param {string} message @param {boolean} recoverable */
  constructor(code, message, recoverable) {
    super(message)
    this.name = 'PlanError'
    this.code = code
    this.recoverable = recoverable
  }

  toEvent() {
    return { type: 'error', code: this.code, message: this.message, recoverable: this.recoverable }
  }
}

export function isPlanError(value) {
  return value instanceof PlanError
}
```

Create `api/lib/errors.ts` (TS re-export so `.ts` modules get typing; the `.js` is what handlers import):
```ts
export { PlanError, isPlanError } from './errors.js'
export type PlanErrorCode =
  | 'needs-clarification' | 'insufficient-data' | 'upstream-unavailable' | 'bad-request'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/errors.test.ts`
Expected: PASS (2 tests). The test imports `./errors` which resolves to `errors.ts` re-exporting the `.js`.

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/types.ts api/lib/errors.js api/lib/errors.ts api/lib/errors.test.ts
git commit -m "feat(backend): internal persona/enriched types + PlanError codes"
```

---

## Task 3: Persona table (user-pick driven scene weights)

Ports the persona concept from `src/engine` but keyed to the contract `personaId` enum, no mock POI references.

**Files:**
- Create: `api/lib/agent/persona.ts`
- Test: `api/lib/agent/persona.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/persona.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/persona.test.ts`
Expected: FAIL — cannot resolve `./persona`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/persona.ts`:
```ts
import type { Persona } from './types'

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/persona.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/persona.ts api/lib/agent/persona.test.ts
git commit -m "feat(backend): persona scene-weight table keyed to contract personaId"
```

---

## Task 4: Geo helpers (ported, no mock data)

Pure distance + travel estimate, ported verbatim from `src/engine/geo.ts` but typed against contract `POI` (uses `lat`/`lng`).

**Files:**
- Create: `api/lib/agent/geo.ts`
- Test: `api/lib/agent/geo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/geo.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { haversineM, travelEstimate } from './geo'

describe('geo', () => {
  it('haversine returns ~0 for identical points', () => {
    expect(haversineM(31.2, 121.4, 31.2, 121.4)).toBeCloseTo(0, 5)
  })

  it('haversine measures a known ~1.5km gap', () => {
    const d = haversineM(31.2240, 121.4430, 31.2300, 121.4560)
    expect(d).toBeGreaterThan(1000)
    expect(d).toBeLessThan(2000)
  })

  it('short distance picks walk, long distance picks transit', () => {
    expect(travelEstimate(400, 20).mode).toBe('walk')
    expect(travelEstimate(6000, 20).mode).toBe('transit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/geo.test.ts`
Expected: FAIL — cannot resolve `./geo`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/geo.ts`:
```ts
import type { POI } from '../../../contract/index'

/** Haversine great-circle distance in metres. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function distBetween(a: POI, b: POI): number {
  return haversineM(a.lat, a.lng, b.lat, b.lng)
}

/** Estimate travel minutes + mode. < walkTolerance ⇒ walk; else transit with fixed transfer overhead. */
export function travelEstimate(
  distM: number, walkToleranceMin: number,
): { minutes: number; mode: 'walk' | 'transit' } {
  const walkSpeed = 80 // metres/min ≈ 4.8 km/h
  const walkMin = Math.round(distM / walkSpeed)
  if (walkMin <= walkToleranceMin) return { minutes: walkMin, mode: 'walk' }
  const transitMin = Math.round(8 + distM / 350)
  return { minutes: transitMin, mode: 'transit' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/geo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/geo.ts api/lib/agent/geo.test.ts
git commit -m "feat(backend): geo distance + travel estimate (typed against contract POI)"
```

---

## Task 5: `understand` deterministic fallback parser

`understand` produces structured `Constraints` + Amap search `keywords`. The LLM does the smart version (Task 13), but a **pure deterministic fallback** must exist (timeout/no-key safety net, spec §10) and is independently unit-testable. This replaces the old regex `keywordsFor()` and hardcoded city anchors — the city comes from `resolveLocation`, never from a hardcoded list. We unit-test only the pure parsing here; the DeepSeek wiring is Task 13.

**Files:**
- Create: `api/lib/agent/understand.ts`
- Test: `api/lib/agent/understand.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/understand.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseConstraintsFallback, fallbackKeywords } from './understand'
import { personaFor } from './persona'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/understand.test.ts`
Expected: FAIL — cannot resolve `./understand`.

- [ ] **Step 3: Implement the pure parser + keyword builder**

Create `api/lib/agent/understand.ts`:
```ts
import type { Category, Constraints } from '../../../contract/index'
import type { Persona, SceneTag } from './types'

export interface ResolvedLocation {
  city: string
  district: string | null
  center: { lat: number; lng: number }
}

const PREF_LEX: { tag: SceneTag; words: string[] }[] = [
  { tag: 'romantic', words: ['浪漫', '约会', '情侣', '氛围', '小资', '情调'] },
  { tag: 'quiet', words: ['安静', '清净', '不吵', '僻静', '慢', '轻松', '慢慢逛'] },
  { tag: 'photo', words: ['拍照', '出片', '打卡', '上镜', '好看', '颜值'] },
  { tag: 'family', words: ['带娃', '小孩', '孩子', '亲子', '宝宝', '儿童', '遛娃'] },
  { tag: 'lively', words: ['热闹', '好玩', '气氛', '嗨', '聚会', '聚餐'] },
  { tag: 'cultural', words: ['文艺', '文化', '艺术', '展', '展馆', '博物馆', '书店', '历史', '园林'] },
  { tag: 'trendy', words: ['网红', '潮', '时髦', '新潮', '潮流'] },
  { tag: 'local', words: ['本地', '地道', '烟火', '小吃', '特色', '本帮'] },
  { tag: 'upscale', words: ['精致', '高端', '高档', '正式', '商务', '档次'] },
  { tag: 'budget', words: ['便宜', '实惠', '性价比', '平价', '不贵', '省'] },
  { tag: 'nature', words: ['自然', '绿', '公园', '江边', '滨江', '户外'] },
  { tag: 'nightlife', words: ['酒吧', '夜生活', '蹦迪', '小酌', '喝一杯', 'livehouse', '夜店'] },
  { tag: 'foodie', words: ['好吃', '美食', '吃货', '大餐'] },
]

const AVOID_PATTERNS: { re: RegExp; tag: SceneTag }[] = [
  { re: /不要(太)?吵|别(太)?吵|太吵/, tag: 'lively' },
  { re: /不要太贵|别太贵|不想太贵/, tag: 'upscale' },
  { re: /不要(去)?酒吧|不喝酒|没有酒/, tag: 'nightlife' },
]

const CAT_LEX: { cat: Category; words: string[] }[] = [
  { cat: 'dining', words: ['吃饭', '吃', '美食', '正餐', '晚饭', '午饭', '大餐', '餐厅', '本帮', '菜'] },
  { cat: 'cafe', words: ['咖啡', '喝咖啡', '茶', '下午茶', '奶茶'] },
  { cat: 'culture', words: ['博物馆', '美术馆', '展', '展馆', '园林', '书店', '历史', '文化', 'citywalk'] },
  { cat: 'entertainment', words: ['演出', '话剧', '剧场', '电影', '密室', '桌游', '乐园'] },
  { cat: 'shopping', words: ['逛街', '购物', '商场', '买', '淘'] },
  { cat: 'nightscape', words: ['夜景', '看景', '江景', '登高', '夜游', '灯'] },
]

const CAT_KEYWORD: Record<Category, string[]> = {
  dining: ['餐厅', '本帮菜', '美食'],
  cafe: ['咖啡', '咖啡馆'],
  culture: ['博物馆', '展览', '书店'],
  entertainment: ['剧场', '电影院'],
  shopping: ['商场', '购物中心'],
  nightscape: ['观景', '夜景'],
}

function parseStartTime(raw: string): number {
  const m = raw.match(/(\d{1,2})\s*点(?!前|之前|以前|结束|回)/)
  if (m) {
    let h = parseInt(m[1], 10)
    if (/晚|下午/.test(raw) && h <= 9 && !/中午/.test(raw)) h += 12
    return h
  }
  if (/凌晨|半夜/.test(raw)) return 0.5
  if (/早上|上午|一早/.test(raw)) return 10
  if (/中午/.test(raw)) return 12
  if (/下午/.test(raw)) return 14
  if (/傍晚/.test(raw)) return 17
  if (/晚上|夜里|晚/.test(raw)) return 18.5
  return 14
}

function parseDuration(raw: string, startHour: number): number {
  if (/一天|整天|玩一天/.test(raw)) return 360
  if (/(下午|白天).*(晚上|夜)|逛到晚上|到晚上/.test(raw)) return 300
  if (/半天/.test(raw)) return 240
  const endM = raw.match(/(\d{1,2})\s*点前/)
  if (endM) {
    let endH = parseInt(endM[1], 10)
    if (endH <= 9) endH += 12
    return Math.max(120, Math.round((endH - startHour) * 60))
  }
  if (/晚饭前/.test(raw)) return Math.max(120, Math.round((18 - startHour) * 60))
  return startHour >= 18 ? 240 : 300
}

function parseBudget(raw: string): { total: number | null; dining: number | null } {
  const diningPatterns = [
    /(?:预算|人均)\s*(\d{2,4})\s*(?:吃午饭|吃午餐|吃晚饭|吃晚餐|吃饭|吃正餐)/,
    /(?:午饭|午餐|晚饭|晚餐|吃饭|正餐).*?(?:预算|人均)\s*(\d{2,4})/,
    /(\d{2,4})\s*(?:元|块)?\s*(?:吃午饭|吃午餐|吃晚饭|吃晚餐|吃饭|吃正餐)/,
  ]
  for (const p of diningPatterns) {
    const m = raw.match(p)
    if (m) return { total: null, dining: parseInt(m[1], 10) }
  }
  const patterns = [/人均\s*(\d{2,4})/, /预算\s*(?:人均)?\s*(\d{2,4})/, /(\d{2,4})\s*(?:左右|以内|以下|块|元)/]
  for (const p of patterns) {
    const m = raw.match(p)
    if (m) return { total: parseInt(m[1], 10), dining: null }
  }
  return { total: null, dining: null }
}

function parseParty(raw: string): number {
  const cnMap: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 }
  const m = raw.match(/([一两二三四五六七八]|\d+)\s*(?:个|位)?\s*(?:朋友|同学|人|家)/)
  if (m) {
    const n = cnMap[m[1]] ?? parseInt(m[1], 10)
    if (!Number.isNaN(n) && n > 0) return n
  }
  if (/情侣|对象|女朋友|男朋友|两个人/.test(raw)) return 2
  if (/一个人|独自|自己/.test(raw)) return 1
  if (/带娃|带孩子|一家|全家/.test(raw)) return 3
  return 0
}

function parsePace(raw: string): Constraints['pace'] | null {
  if (/不要太赶|别太赶|不赶|慢慢|轻松|不要太累/.test(raw)) return 'relaxed'
  if (/多逛|多玩|尽量多|紧凑|赶一点/.test(raw)) return 'packed'
  return null
}

/** Deterministic constraints parser — the fallback when the LLM is unavailable or times out. */
export function parseConstraintsFallback(
  raw: string, loc: ResolvedLocation, persona: Persona,
): Constraints {
  const startTime = parseStartTime(raw)
  const durationMin = parseDuration(raw, startTime)
  const budget = parseBudget(raw)
  const party = parseParty(raw)

  const prefs = new Set<string>()
  for (const { tag, words } of PREF_LEX) if (words.some((w) => raw.includes(w))) prefs.add(tag)
  const avoid = new Set<string>()
  for (const { re, tag } of AVOID_PATTERNS) if (re.test(raw)) { avoid.add(tag); prefs.delete(tag) }

  const mustCategories = new Set<Category>()
  for (const { cat, words } of CAT_LEX) if (words.some((w) => raw.includes(w))) mustCategories.add(cat)

  return {
    city: loc.city,
    district: loc.district,
    startTime,
    durationMin,
    party: party || persona.partyDefault,
    budgetPerCapita: budget.total,
    diningBudgetPerCapita: budget.dining,
    prefs: [...prefs],
    avoid: [...avoid],
    mustCategories: [...mustCategories],
    pace: parsePace(raw) ?? persona.pace,
    personaId: persona.id,
    raw,
  }
}

/** Build Amap search keywords from constraints. City/district come from resolveLocation, never hardcoded. */
export function fallbackKeywords(c: Constraints): string[] {
  const scope = c.district || c.city
  const words = new Set<string>()
  const cats: Category[] = c.mustCategories.length ? c.mustCategories : ['dining', 'cafe', 'culture']
  for (const cat of cats) {
    for (const term of CAT_KEYWORD[cat]) words.add(`${scope} ${term}`)
  }
  if (c.prefs.includes('cultural')) words.add(`${scope} 景点`)
  if (c.prefs.includes('nature')) words.add(`${scope} 公园`)
  return [...words].slice(0, 8)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/understand.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/understand.ts api/lib/agent/understand.test.ts
git commit -m "feat(backend): deterministic understand fallback (constraints + keywords, no hardcoded cities)"
```

---

## Task 6: Amap feature mapping (real `business`/`photos` only; null when absent)

Maps a v5 `/place/text?show_fields=business,photos` POI into the contract `POI`. **Only real fields** — `rating`/`cost`/`opentime`/`tag`/`photos`/`tel`. Missing fields stay `null`/`[]`; **no fabricated defaults**. `popularity` (reviews) and `queue` are never produced. Scene tags are derived from `tag` and flagged as `derived` provenance.

**Files:**
- Create: `api/lib/amap/poiFeatures.ts`
- Test: `api/lib/amap/poiFeatures.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/amap/poiFeatures.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toEnrichedPOI, parseOpenHours, deriveSceneTags } from './poiFeatures'

const v5Poi = {
  id: 'B0LBRRKLFC',
  name: '看得到风景的咖啡馆',
  type: '餐饮服务;咖啡厅;咖啡厅',
  location: '121.443,31.224',
  cityname: '上海市', adname: '静安区',
  business: { rating: '4.5', cost: '78', opentime_today: '09:00-20:00', tag: '安静,拍照,环境好', tel: '021-12345678' },
  photos: [{ url: 'https://aos.example/a.jpg' }, { title: '门面', url: 'https://aos.example/b.jpg' }],
}

describe('parseOpenHours', () => {
  it('parses a HH:MM-HH:MM window', () => {
    expect(parseOpenHours('09:00-20:00')).toEqual({ openHour: 9, closeHour: 20 })
  })
  it('returns nulls for an unparseable string', () => {
    expect(parseOpenHours('详见门店')).toEqual({ openHour: null, closeHour: null })
  })
})

describe('deriveSceneTags', () => {
  it('maps amap tag tokens to scene tags', () => {
    const tags = deriveSceneTags('安静,拍照,网红', 'cafe')
    expect(tags).toContain('quiet')
    expect(tags).toContain('photo')
    expect(tags).toContain('trendy')
  })
})

describe('toEnrichedPOI', () => {
  it('uses real business fields and never invents reviews/queue', () => {
    const poi = toEnrichedPOI(v5Poi, '上海', '静安区')!
    expect(poi.rating).toBe(4.5)
    expect(poi.perCapita).toBe(78)
    expect(poi.openHour).toBe(9)
    expect(poi.tel).toBe('021-12345678')
    expect(poi.photos.length).toBe(2)
    expect(poi.source).toBe('amap')
    expect(poi.category).toBe('cafe')
    expect((poi as Record<string, unknown>).reviews).toBeUndefined()
    expect((poi as Record<string, unknown>).queueBase).toBeUndefined()
  })

  it('leaves missing fields null/empty, no fabrication', () => {
    const bare = { id: 'X', name: '某店', type: '餐饮服务;中餐厅', location: '121.4,31.2', cityname: '上海市', adname: '静安区' }
    const poi = toEnrichedPOI(bare, '上海', '静安区')!
    expect(poi.rating).toBeNull()
    expect(poi.perCapita).toBeNull()
    expect(poi.openHour).toBeNull()
    expect(poi.tel).toBeNull()
    expect(poi.photos).toEqual([])
  })

  it('rejects a POI with no parseable location', () => {
    expect(toEnrichedPOI({ id: 'X', name: 'n', type: 't', location: '' }, '上海', null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/amap/poiFeatures.test.ts`
Expected: FAIL — cannot resolve `./poiFeatures`.

- [ ] **Step 3: Implement**

Create `api/lib/amap/poiFeatures.ts`:
```ts
import type { Category } from '../../../contract/index'
import type { EnrichedPOI, SceneTag } from '../agent/types'

interface AmapV5Poi {
  id?: string
  name?: string
  type?: string
  location?: string
  cityname?: string
  adname?: string
  business?: {
    rating?: string
    cost?: string
    opentime_today?: string
    opentime_week?: string
    tag?: string
    tel?: string
  }
  photos?: { title?: string; url?: string }[]
}

function categoryFor(text: string): Category {
  if (/咖啡|茶饮|奶茶|甜品|饮品|下午茶|面包|烘焙/.test(text)) return 'cafe'
  if (/餐饮|餐厅|中餐|西餐|美食|小吃|肉串|烧烤|火锅|菜馆|饭店|brunch|早午餐/i.test(text)) return 'dining'
  if (/夜景|观景|灯光|夜游/.test(text)) return 'nightscape'
  if (/购物|商场|市集|大巴扎|商业/.test(text)) return 'shopping'
  if (/影院|剧场|演出|娱乐|游乐|KTV|密室|桌游/.test(text)) return 'entertainment'
  return 'culture'
}

const TAG_MAP: { re: RegExp; tag: SceneTag }[] = [
  { re: /安静|清净|僻静/, tag: 'quiet' },
  { re: /拍照|出片|打卡|环境|颜值/, tag: 'photo' },
  { re: /浪漫|情调|氛围/, tag: 'romantic' },
  { re: /亲子|儿童|带娃/, tag: 'family' },
  { re: /热闹|气氛/, tag: 'lively' },
  { re: /文化|艺术|文艺|历史/, tag: 'cultural' },
  { re: /网红|潮流|时髦/, tag: 'trendy' },
  { re: /本地|地道|特色|老字号|本帮/, tag: 'local' },
  { re: /精致|高端|商务/, tag: 'upscale' },
  { re: /实惠|平价|性价比/, tag: 'budget' },
  { re: /自然|公园|江景/, tag: 'nature' },
  { re: /酒吧|清吧|精酿/, tag: 'nightlife' },
  { re: /美食|好吃/, tag: 'foodie' },
]

/** Derive scene tags from a real amap tag string. Provenance is 'derived' (estimate). */
export function deriveSceneTags(tagStr: string, category: Category): SceneTag[] {
  const out = new Set<SceneTag>()
  const text = tagStr || ''
  for (const { re, tag } of TAG_MAP) if (re.test(text)) out.add(tag)
  if (category === 'cafe' && !out.size) out.add('quiet')
  return [...out]
}

/** Parse "HH:MM-HH:MM" (Amap opentime_today). Returns nulls when unparseable — never fabricated. */
export function parseOpenHours(opentime: string | undefined): { openHour: number | null; closeHour: number | null } {
  const m = (opentime || '').match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/)
  if (!m) return { openHour: null, closeHour: null }
  const open = parseInt(m[1], 10) + parseInt(m[2], 10) / 60
  let close = parseInt(m[3], 10) + parseInt(m[4], 10) / 60
  if (close <= open) close += 24
  return { openHour: open, closeHour: Math.min(close, 27) }
}

const STAY_BY_CATEGORY: Record<Category, number> = {
  dining: 75, cafe: 50, culture: 90, entertainment: 85, shopping: 60, nightscape: 60,
}

function num(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Map a raw v5 POI to the contract POI enriched for the deterministic core. Returns null if unusable. */
export function toEnrichedPOI(raw: AmapV5Poi, city: string, district: string | null): EnrichedPOI | null {
  const name = (raw.name || '').trim()
  const [lngStr, latStr] = String(raw.location || '').split(',')
  const lng = Number(lngStr)
  const lat = Number(latStr)
  if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null

  const typeText = `${name} ${raw.type || ''}`
  const category = categoryFor(typeText)
  const b = raw.business || {}
  const { openHour, closeHour } = parseOpenHours(b.opentime_today || b.opentime_week)
  const photos = (raw.photos || []).map((p) => p.url).filter((u): u is string => !!u)

  return {
    id: raw.id || `${name}-${raw.location}`,
    name,
    category,
    city,
    area: raw.adname || district || '',
    lat,
    lng,
    rating: num(b.rating),
    perCapita: num(b.cost),
    tags: (b.tag || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    openHour,
    closeHour,
    photos,
    tel: (b.tel || '').trim() || null,
    source: 'amap',
    sceneTags: deriveSceneTags(b.tag || '', category),
    avgDuration: STAY_BY_CATEGORY[category],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/amap/poiFeatures.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/amap/poiFeatures.ts api/lib/amap/poiFeatures.test.ts
git commit -m "feat(backend): amap v5 feature mapping — real fields only, null when absent, no reviews/queue"
```

---

## Task 7: Amap client (injectable fetch, no real network in tests)

A thin client over v5 `place/text` and walking direction with an **injectable `fetch`** so unit tests never hit the network. Reads the key via the reused `getAmapKey()`.

**Files:**
- Create: `api/lib/amap/client.ts`
- Test: `api/lib/amap/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/amap/client.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { searchPlaceText, walkingLeg } from './client'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

describe('searchPlaceText', () => {
  it('requests show_fields=business,photos and returns raw pois', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '1', pois: [{ name: '咖啡', location: '121.4,31.2' }] }))
    const { status, pois } = await searchPlaceText(
      { keyword: '静安 咖啡', city: '上海', key: 'K' }, { fetchImpl: fetchMock },
    )
    expect(status).toBe('ok')
    expect(pois).toHaveLength(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v5/place/text')
    expect(url).toContain('show_fields=business%2Cphotos')
  })

  it('reports empty status when amap returns no pois', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '1', pois: [] }))
    const { status } = await searchPlaceText({ keyword: 'x', city: '上海', key: 'K' }, { fetchImpl: fetchMock })
    expect(status).toBe('empty')
  })

  it('reports error status on upstream failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '0', info: 'INVALID_PARAMS' }))
    const { status } = await searchPlaceText({ keyword: 'x', city: '上海', key: 'K' }, { fetchImpl: fetchMock })
    expect(status).toBe('error')
  })
})

describe('walkingLeg', () => {
  it('returns metres + minutes from a v5 walking path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: '1', route: { paths: [{ distance: '600', cost: { duration: '480' } }] },
    }))
    const leg = await walkingLeg({ from: { lat: 31.2, lng: 121.4 }, to: { lat: 31.21, lng: 121.41 }, key: 'K' }, { fetchImpl: fetchMock })
    expect(leg).toEqual({ distM: 600, minutes: 8 })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v5/direction/walking')
  })

  it('returns null when amap has no path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: '0' }))
    const leg = await walkingLeg({ from: { lat: 0, lng: 0 }, to: { lat: 0, lng: 0 }, key: 'K' }, { fetchImpl: fetchMock })
    expect(leg).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/amap/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement**

Create `api/lib/amap/client.ts`:
```ts
const AMAP_V5 = 'https://restapi.amap.com/v5'

export interface AmapDeps {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function fetchJson(url: string, deps: AmapDeps): Promise<any> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 4500)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    return await (res as Response).json()
  } finally {
    clearTimeout(timer)
  }
}

export interface PlaceTextParams {
  keyword: string
  city: string
  key: string
  citylimit?: boolean
  pageSize?: number
}

export interface PlaceTextResult {
  status: 'ok' | 'empty' | 'error'
  pois: any[]
  info?: string
}

/** v5 place/text with business+photos. Caller is responsible for caching/quota. */
export async function searchPlaceText(p: PlaceTextParams, deps: AmapDeps = {}): Promise<PlaceTextResult> {
  const params = new URLSearchParams({
    key: p.key,
    keywords: p.keyword,
    region: p.city,
    city_limit: p.citylimit === false ? 'false' : 'true',
    show_fields: 'business,photos',
    page_size: String(p.pageSize ?? 12),
    page_num: '1',
  })
  try {
    const data = await fetchJson(`${AMAP_V5}/place/text?${params.toString()}`, deps)
    if (data?.status !== '1') return { status: 'error', pois: [], info: data?.info }
    const pois = Array.isArray(data.pois) ? data.pois : []
    return { status: pois.length ? 'ok' : 'empty', pois }
  } catch (err) {
    return { status: 'error', pois: [], info: err instanceof Error ? err.message : String(err) }
  }
}

export interface WalkingParams {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  key: string
}

/** v5 walking direction. Returns { distM, minutes } or null. */
export async function walkingLeg(p: WalkingParams, deps: AmapDeps = {}): Promise<{ distM: number; minutes: number } | null> {
  const params = new URLSearchParams({
    key: p.key,
    origin: `${p.from.lng},${p.from.lat}`,
    destination: `${p.to.lng},${p.to.lat}`,
  })
  try {
    const data = await fetchJson(`${AMAP_V5}/direction/walking?${params.toString()}`, { ...deps, timeoutMs: deps.timeoutMs ?? 1600 })
    const path = data?.route?.paths?.[0]
    const distM = Math.round(Number(path?.distance ?? 0))
    const durationSec = Number(path?.cost?.duration ?? path?.duration ?? 0)
    const minutes = Math.round(durationSec / 60)
    if (data?.status === '1' && distM > 0 && minutes > 0) return { distM, minutes }
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/amap/client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/amap/client.ts api/lib/amap/client.test.ts
git commit -m "feat(backend): injectable-fetch amap v5 client (place/text + walking)"
```

---

## Task 8: Postgres schema + DB client

The Neon serverless driver over a `DATABASE_URL`. Schema is re-runnable (`IF NOT EXISTS`). DB tests skip when `DATABASE_URL` is unset.

**Files:**
- Create: `api/lib/db/schema.sql`
- Create: `api/lib/db/client.js`
- Test: `api/lib/db/client.test.ts`

- [ ] **Step 1: Write the schema**

Create `api/lib/db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  prefs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget_pref   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS guests (
  device_token TEXT PRIMARY KEY,
  prefs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id           TEXT PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  device_token TEXT,
  request      TEXT NOT NULL,
  constraints  JSONB NOT NULL,
  routes       JSONB NOT NULL,
  data_sources JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_user_idx ON plans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_device_idx ON plans (device_token, created_at DESC);

CREATE TABLE IF NOT EXISTS poi_cache (
  key        TEXT PRIMARY KEY,
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing test**

Create `api/lib/db/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { getSql, hasDatabase } from './client.js'

const maybe = hasDatabase() ? describe : describe.skip

maybe('db client', () => {
  it('runs a trivial query', async () => {
    const sql = getSql()
    const rows = await sql`SELECT 1 AS one`
    expect(rows[0].one).toBe(1)
  })

  it('schema tables exist after schema.sql is applied', async () => {
    const sql = getSql()
    const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
    const names = rows.map((r: any) => r.table_name)
    for (const t of ['users', 'sessions', 'guests', 'plans', 'poi_cache']) {
      expect(names).toContain(t)
    }
  })
})

describe('db client guard', () => {
  it('hasDatabase reflects DATABASE_URL presence', () => {
    expect(typeof hasDatabase()).toBe('boolean')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run api/lib/db/client.test.ts`
Expected: FAIL — cannot resolve `./client.js`.

- [ ] **Step 4: Implement the client**

Create `api/lib/db/client.js`:
```js
import { neon } from '@neondatabase/serverless'

let cached = null

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/** Returns a tagged-template SQL function bound to DATABASE_URL. Throws if unset. */
export function getSql() {
  if (!hasDatabase()) throw new Error('DATABASE_URL is not configured')
  if (!cached) cached = neon(process.env.DATABASE_URL)
  return cached
}
```

- [ ] **Step 5: Apply schema and run test to verify it passes**

Run (with `DATABASE_URL` exported per Preconditions):
```bash
psql "$DATABASE_URL" -f api/lib/db/schema.sql
npx vitest run api/lib/db/client.test.ts
```
Expected: PASS. With `DATABASE_URL` unset, the first two tests are SKIPPED and the guard test passes — also acceptable green.

- [ ] **Step 6: Commit**

```bash
git add api/lib/db/schema.sql api/lib/db/client.js api/lib/db/client.test.ts
git commit -m "feat(backend): neon postgres schema + sql client (skippable db tests)"
```

---

## Task 9: POI cache (quota guard, TTL 14–30 days)

Normalizes a cache key from `city + keyword + category-scope`, reads/writes `poi_cache`, honours TTL. Caller (retrieve) only calls Amap on a miss, protecting the 5000/month quota. Walking legs cache too (coordinates rounded).

**Files:**
- Create: `api/lib/amap/cache.js`
- Test: `api/lib/amap/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/amap/cache.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { normalizeCacheKey, legCacheKey, isFresh } from './cache.js'

describe('normalizeCacheKey', () => {
  it('is stable across whitespace/case and keyword order within scope', () => {
    const a = normalizeCacheKey({ city: '上海', keyword: '静安  咖啡', scope: 'cafe' })
    const b = normalizeCacheKey({ city: '上海', keyword: '静安 咖啡', scope: 'cafe' })
    expect(a).toBe(b)
    expect(a.startsWith('poi:')).toBe(true)
  })
  it('differs by city and scope', () => {
    expect(normalizeCacheKey({ city: '上海', keyword: 'k', scope: 'cafe' }))
      .not.toBe(normalizeCacheKey({ city: '北京', keyword: 'k', scope: 'cafe' }))
    expect(normalizeCacheKey({ city: '上海', keyword: 'k', scope: 'cafe' }))
      .not.toBe(normalizeCacheKey({ city: '上海', keyword: 'k', scope: 'dining' }))
  })
})

describe('legCacheKey', () => {
  it('rounds coordinates so near-identical legs share a key', () => {
    const a = legCacheKey({ lat: 31.22401, lng: 121.44302 }, { lat: 31.23001, lng: 121.45001 })
    const b = legCacheKey({ lat: 31.22404, lng: 121.44298 }, { lat: 31.23002, lng: 121.45004 })
    expect(a).toBe(b)
    expect(a.startsWith('leg:')).toBe(true)
  })
})

describe('isFresh', () => {
  it('true within TTL, false after', () => {
    const now = Date.now()
    expect(isFresh(new Date(now - 5 * 86400_000).toISOString(), 14)).toBe(true)
    expect(isFresh(new Date(now - 40 * 86400_000).toISOString(), 14)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/amap/cache.test.ts`
Expected: FAIL — cannot resolve `./cache.js`.

- [ ] **Step 3: Implement**

Create `api/lib/amap/cache.js`:
```js
import { getSql, hasDatabase } from '../db/client.js'

function norm(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** poi:<city>|<scope>|<keyword> — normalized, stable. */
export function normalizeCacheKey({ city, keyword, scope }) {
  return `poi:${norm(city)}|${norm(scope)}|${norm(keyword)}`
}

/** leg:<lat,lng>-><lat,lng> with coords rounded to 3 decimals (~110m). */
export function legCacheKey(from, to) {
  const r = (n) => Number(n).toFixed(3)
  return `leg:${r(from.lat)},${r(from.lng)}->${r(to.lat)},${r(to.lng)}`
}

export function isFresh(fetchedAtIso, ttlDays) {
  const age = Date.now() - new Date(fetchedAtIso).getTime()
  return age <= ttlDays * 86400_000
}

const DEFAULT_TTL_DAYS = 21 // within the spec's 14–30 day window

/** Read a cached payload if present and fresh; else null. No-op (null) when DB absent. */
export async function readCache(key, ttlDays = DEFAULT_TTL_DAYS) {
  if (!hasDatabase()) return null
  const sql = getSql()
  const rows = await sql`SELECT payload, fetched_at FROM poi_cache WHERE key = ${key}`
  const row = rows[0]
  if (!row) return null
  if (!isFresh(new Date(row.fetched_at).toISOString(), ttlDays)) return null
  return row.payload
}

/** Upsert a payload. No-op when DB absent. */
export async function writeCache(key, payload) {
  if (!hasDatabase()) return
  const sql = getSql()
  await sql`
    INSERT INTO poi_cache (key, payload, fetched_at)
    VALUES (${key}, ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
  `
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/amap/cache.test.ts`
Expected: PASS (5 tests). `readCache`/`writeCache` are exercised end-to-end in Task 10's retrieve test via a fake DB or skipped when no `DATABASE_URL`.

- [ ] **Step 5: Commit**

```bash
git add api/lib/amap/cache.js api/lib/amap/cache.test.ts
git commit -m "feat(backend): poi_cache key normalization + TTL read/write (quota guard)"
```

---

## Task 10: `retrieve` — Amap recall + cache + feature extraction

Ties together: for each keyword, check cache → on miss call `searchPlaceText` → cache raw pois → map via `toEnrichedPOI`. Dedup by id, drop POIs outside the resolved city. Returns `RetrieveResult` with cache hit/miss counts. `fetchImpl`, `readCache`, `writeCache`, and `key` are injected so the test runs offline.

**Files:**
- Create: `api/lib/agent/retrieve.ts`
- Test: `api/lib/agent/retrieve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/retrieve.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { retrieve } from './retrieve'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

const loc = { city: '上海', district: '静安区', center: { lat: 31.22, lng: 121.44 } }

const cafePoi = {
  id: 'B1', name: '安静咖啡', type: '餐饮服务;咖啡厅', location: '121.443,31.224',
  cityname: '上海市', adname: '静安区',
  business: { rating: '4.6', cost: '70', opentime_today: '09:00-21:00', tag: '安静', tel: '021-1' },
}
const diningPoi = {
  id: 'B2', name: '老饭店', type: '餐饮服务;中餐厅', location: '121.45,31.23',
  cityname: '上海市', adname: '静安区',
  business: { rating: '4.4', cost: '120', opentime_today: '11:00-21:00', tag: '本帮' },
}

describe('retrieve', () => {
  it('fetches on cache miss, maps real fields, dedups, counts misses', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse({ status: '1', pois: String(url).includes('%E5%92%96%E5%95%A1') ? [cafePoi] : [diningPoi] }),
    )
    const result = await retrieve(
      { keywords: ['静安区 咖啡', '静安区 餐厅'], location: loc, key: 'K' },
      { fetchImpl: fetchMock, readCache: async () => null, writeCache: async () => {} },
    )
    expect(result.pois.map((p) => p.id).sort()).toEqual(['B1', 'B2'])
    expect(result.pois.find((p) => p.id === 'B1')!.rating).toBe(4.6)
    expect(result.cacheMisses).toBe(2)
    expect(result.cacheHits).toBe(0)
    expect(result.amapStatus).toBe('ok')
  })

  it('uses cache on hit and does not call fetch', async () => {
    const fetchMock = vi.fn()
    const result = await retrieve(
      { keywords: ['静安区 咖啡'], location: loc, key: 'K' },
      { fetchImpl: fetchMock as any, readCache: async () => [cafePoi], writeCache: async () => {} },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.cacheHits).toBe(1)
    expect(result.pois[0].id).toBe('B1')
  })

  it('reports not_configured when no key', async () => {
    const result = await retrieve(
      { keywords: ['x'], location: loc, key: '' },
      { fetchImpl: vi.fn() as any, readCache: async () => null, writeCache: async () => {} },
    )
    expect(result.amapStatus).toBe('not_configured')
    expect(result.pois).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/retrieve.test.ts`
Expected: FAIL — cannot resolve `./retrieve`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/retrieve.ts`:
```ts
import { searchPlaceText } from '../amap/client'
import { normalizeCacheKey } from '../amap/cache.js'
import { toEnrichedPOI } from '../amap/poiFeatures'
import type { EnrichedPOI, RetrieveResult } from './types'
import type { ResolvedLocation } from './understand'

export interface RetrieveParams {
  keywords: string[]
  location: ResolvedLocation & { district: string | null }
  key: string
}

export interface RetrieveDeps {
  fetchImpl?: typeof fetch
  readCache?: (key: string) => Promise<any[] | null>
  writeCache?: (key: string, payload: any[]) => Promise<void>
}

function stripCity(name: string): string {
  return (name || '').replace(/(市|地区|自治州|州|盟)$/, '')
}

export async function retrieve(p: RetrieveParams, deps: RetrieveDeps = {}): Promise<RetrieveResult> {
  const { keywords, location, key } = p
  const center = location.center
  if (!key) {
    return { pois: [], center, cacheHits: 0, cacheMisses: 0, amapStatus: 'not_configured' }
  }
  const readCache = deps.readCache ?? (async () => null)
  const writeCache = deps.writeCache ?? (async () => {})

  const byId = new Map<string, EnrichedPOI>()
  let cacheHits = 0
  let cacheMisses = 0
  let sawError = false

  for (const keyword of keywords) {
    const cacheKey = normalizeCacheKey({ city: location.city, keyword, scope: 'place-text' })
    let rawPois = await readCache(cacheKey)
    if (rawPois) {
      cacheHits += 1
    } else {
      const res = await searchPlaceText(
        { keyword, city: location.city, key }, { fetchImpl: deps.fetchImpl },
      )
      cacheMisses += 1
      if (res.status === 'error') { sawError = true; continue }
      rawPois = res.pois
      await writeCache(cacheKey, rawPois)
    }
    for (const raw of rawPois) {
      const poi = toEnrichedPOI(raw, location.city, location.district)
      if (!poi) continue
      if (poi.city && location.city && stripCity(poi.city) !== stripCity(location.city)) continue
      if (!byId.has(poi.id)) byId.set(poi.id, poi)
    }
  }

  const pois = [...byId.values()]
  const amapStatus: RetrieveResult['amapStatus'] = pois.length ? 'ok' : sawError ? 'error' : 'empty'
  return { pois, center, cacheHits, cacheMisses, amapStatus }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/retrieve.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/retrieve.ts api/lib/agent/retrieve.test.ts
git commit -m "feat(backend): retrieve — cached amap recall + real-feature extraction"
```

---

## Task 11: `score` — ported, popularity/queue removed, weights reallocated

Ports `scorePOIs` but **deletes `popularity` (reviews) and `ugcBonus`/`queue`** — the deleted weight (10 + 3) is reallocated to `quality` (+7) and `prefMatch` (+6). Operates on `EnrichedPOI` (real `rating`/`perCapita` may be `null` → neutral handling, no fabrication). Emits a per-field provenance map for each `ScoredPOI`.

**Files:**
- Create: `api/lib/agent/score.ts`
- Test: `api/lib/agent/score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/score.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/score.test.ts`
Expected: FAIL — cannot resolve `./score`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/score.ts`:
```ts
import type { Constraints, ScoredPOI, FieldSource } from '../../../contract/index'
import type { EnrichedPOI, Persona, SceneTag } from './types'
import { haversineM } from './geo'

/** Weights after deleting popularity(10)+ugcBonus(3): +7→quality, +6→prefMatch. Sums to 100. */
export const SCORE_WEIGHTS = {
  quality: 25,
  sceneFit: 22,
  prefMatch: 28,
  budgetFit: 12,
  proximity: 8,
  companionFit: 5,
} as const

function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x))
}

/** rating may be null → neutral 0.5, never invented. */
function qualityScore(p: EnrichedPOI): number {
  if (p.rating == null) return 0.5
  return clamp((p.rating - 3.6) / (5 - 3.6))
}

function sceneFitScore(p: EnrichedPOI, persona: Persona): { v: number; hits: SceneTag[] } {
  let sum = 0
  const hits: SceneTag[] = []
  for (const tag of p.sceneTags) {
    const w = persona.sceneWeights[tag] ?? 0
    sum += w
    if (w >= 0.5) hits.push(tag)
  }
  return { v: clamp((sum + 1.2) / 3.2), hits }
}

function prefMatchScore(p: EnrichedPOI, c: Constraints): { v: number; hits: string[] } {
  if (c.prefs.length === 0) return { v: 0.5, hits: [] }
  const hits = c.prefs.filter((t) => (p.sceneTags as string[]).includes(t))
  let v = hits.length / c.prefs.length
  const avoidHit = c.avoid.filter((t) => (p.sceneTags as string[]).includes(t))
  v -= avoidHit.length * 0.25
  return { v: clamp(v), hits }
}

/** perCapita may be null → neutral. */
function budgetFitScore(p: EnrichedPOI, c: Constraints, persona: Persona): { v: number; over: boolean } {
  if (p.perCapita == null) return { v: 0.5, over: false }
  const budget = c.budgetPerCapita ?? (p.category === 'dining' ? c.diningBudgetPerCapita : null)
  if (budget == null) return { v: clamp(1 - p.perCapita / 600), over: false }
  const ratio = p.perCapita / budget
  if (ratio <= 1) return { v: clamp(0.6 + 0.4 * (1 - Math.abs(0.7 - ratio))), over: false }
  const penalty = (ratio - 1) * (1 + persona.budgetSensitivity * 2)
  return { v: clamp(1 - penalty), over: true }
}

function proximityScore(p: EnrichedPOI, centerLat: number, centerLng: number): number {
  return clamp(1 - haversineM(centerLat, centerLng, p.lat, p.lng) / 6000)
}

function companionFitScore(p: EnrichedPOI, c: Constraints): number {
  const party = c.party
  if (party >= 4) {
    let v = 0.5
    if (p.sceneTags.includes('lively')) v += 0.25
    if (p.sceneTags.includes('budget')) v += 0.1
    if (p.sceneTags.includes('quiet')) v -= 0.2
    return clamp(v)
  }
  if (party <= 1) {
    let v = 0.5
    if (p.sceneTags.includes('quiet')) v += 0.2
    if (p.sceneTags.includes('cultural')) v += 0.15
    if (p.sceneTags.includes('lively')) v -= 0.15
    return clamp(v)
  }
  let v = 0.55
  if (p.sceneTags.includes('romantic')) v += 0.15
  if (p.sceneTags.includes('photo')) v += 0.05
  return clamp(v)
}

const SCENE_LABEL: Record<string, string> = {
  romantic: '浪漫', quiet: '安静', photo: '拍照', family: '亲子', lively: '热闹',
  cultural: '文化', trendy: '潮流', local: '本地', upscale: '精致', budget: '实惠',
  nature: '自然', nightlife: '夜生活', foodie: '美食',
}

function buildReasons(
  p: EnrichedPOI, c: Constraints, persona: Persona, prefHits: string[], over: boolean,
): string[] {
  const r: string[] = []
  if (prefHits.length) r.push(`命中你的需求：${prefHits.map((t) => SCENE_LABEL[t] ?? t).join('、')}`)
  if (p.perCapita != null && c.diningBudgetPerCapita != null && p.category === 'dining') {
    r.push(over ? `正餐人均 ¥${p.perCapita}，略超吃饭预算` : `正餐人均 ¥${p.perCapita}，在 ¥${c.diningBudgetPerCapita} 预算内`)
  } else if (p.perCapita != null && c.budgetPerCapita != null) {
    r.push(over ? `人均 ¥${p.perCapita}，略超预算需留意` : `人均 ¥${p.perCapita}，在 ¥${c.budgetPerCapita} 预算内`)
  }
  if (p.rating != null && p.rating >= 4.5) r.push(`评分 ${p.rating}，口碑突出`)
  if (r.length === 0) {
    r.push(p.rating != null ? `综合评分 ${p.rating}` : `贴合「${persona.label}」这次的安排`)
  }
  return r.slice(0, 4)
}

export function scorePOI(
  p: EnrichedPOI, c: Constraints, persona: Persona, centerLat: number, centerLng: number,
): ScoredPOI {
  const quality = qualityScore(p)
  const { v: sceneFit } = sceneFitScore(p, persona)
  const { v: prefMatch, hits: prefHits } = prefMatchScore(p, c)
  const { v: budgetFit, over } = budgetFitScore(p, c, persona)
  const proximity = proximityScore(p, centerLat, centerLng)
  const companionFit = companionFitScore(p, c)
  const catBoost = 1 + (persona.categoryPriority[p.category] ?? 0) * 0.12

  const total =
    quality * SCORE_WEIGHTS.quality +
    sceneFit * SCORE_WEIGHTS.sceneFit * catBoost +
    prefMatch * SCORE_WEIGHTS.prefMatch +
    budgetFit * SCORE_WEIGHTS.budgetFit +
    proximity * SCORE_WEIGHTS.proximity +
    companionFit * SCORE_WEIGHTS.companionFit

  const sources: Record<string, FieldSource> = {
    rating: 'amap', perCapita: 'amap', sceneTags: 'derived', proximity: 'amap',
  }
  return {
    poi: p,
    score: Math.max(0, Math.min(100, +total.toFixed(1))),
    reasons: buildReasons(p, c, persona, prefHits, over),
    sources,
  }
}

export function scorePOIs(
  pois: EnrichedPOI[], c: Constraints, persona: Persona, centerLat: number, centerLng: number,
): ScoredPOI[] {
  return pois
    .map((p) => scorePOI(p, c, persona, centerLat, centerLng))
    .sort((a, b) => b.score - a.score)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/score.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/score.ts api/lib/agent/score.test.ts
git commit -m "feat(backend): score — popularity/queue removed, weights reallocated, null-safe"
```

---

## Task 12: `build` — beam search + materialize to contract Route

Ports `buildRouteCandidates` + `materializeRoute`, but: legs use the ported `travelEstimate` (the loop replaces them with real Amap walking legs later — Task 16); open-hour gating treats `openHour == null` as "always open" (no fabrication); output is the **contract `Route`** shape (`stops[].poi`, `arrive`, `depart`, `legFromPrev{distM,minutes,mode}`, `reasons`, `sources`). No `src/data` (mock) imports.

**Files:**
- Create: `api/lib/agent/build.ts`
- Test: `api/lib/agent/build.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/build.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildRouteCandidates, materializeRoute } from './build'
import { scorePOIs } from './score'
import { personaFor } from './persona'
import type { EnrichedPOI } from './types'
import type { Constraints } from '../../../contract/index'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap', sceneTags: [], avgDuration: 50, ...over,
  }
}

const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['cafe', 'dining', 'culture'], pace: 'normal', personaId: 'couple', raw: '安静',
}

const persona = personaFor('couple')

const pois: EnrichedPOI[] = [
  poi({ id: 'cafe1', category: 'cafe', sceneTags: ['quiet'], lat: 31.221, lng: 121.441 }),
  poi({ id: 'cafe2', category: 'cafe', sceneTags: ['quiet'], lat: 31.222, lng: 121.442 }),
  poi({ id: 'dine1', category: 'dining', perCapita: 120, lat: 31.223, lng: 121.443 }),
  poi({ id: 'dine2', category: 'dining', perCapita: 160, lat: 31.224, lng: 121.444 }),
  poi({ id: 'cult1', category: 'culture', perCapita: 0, lat: 31.225, lng: 121.445, avgDuration: 90 }),
  poi({ id: 'cult2', category: 'culture', perCapita: 0, lat: 31.226, lng: 121.446, avgDuration: 90 }),
]

describe('buildRouteCandidates', () => {
  it('produces routes that are contract-shaped with >=3 stops', () => {
    const scored = scorePOIs(pois, c, persona, 31.22, 121.44)
    const { routes } = buildRouteCandidates(scored, c, persona)
    expect(routes.length).toBeGreaterThan(0)
    const r = routes[0]
    expect(r.stops.length).toBeGreaterThanOrEqual(3)
    expect(r.stops[0].poi.source).toBe('amap')
    expect(r.stops[1].legFromPrev).not.toBeNull()
    expect(typeof r.totalCost).toBe('number')
    expect(Array.isArray(r.coverage)).toBe(true)
  })
})

describe('materializeRoute', () => {
  it('treats null openHour as always-open (no fabrication)', () => {
    const scored = scorePOIs(
      [poi({ id: 'a', category: 'cafe', openHour: null, closeHour: null }),
       poi({ id: 'b', category: 'dining', openHour: null, closeHour: null, perCapita: 90 }),
       poi({ id: 'd', category: 'culture', openHour: null, closeHour: null, perCapita: 0 })],
      c, persona, 31.22, 121.44,
    )
    const route = materializeRoute(scored, c, persona, 0)
    expect(route.stops.every((s) => Number.isFinite(s.arrive) && Number.isFinite(s.depart))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/build.test.ts`
Expected: FAIL — cannot resolve `./build`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/build.ts`:
```ts
import type { Category, Constraints, Route, RouteStop, ScoredPOI } from '../../../contract/index'
import type { Persona } from './types'
import { distBetween, travelEstimate } from './geo'

const BEAM = 6
const TOPK_PER_SLOT = 7
const OUTPUT = 6

const OPEN_FALLBACK = 0      // null openHour ⇒ treat as open from 00:00
const CLOSE_FALLBACK = 24    // null closeHour ⇒ treat as open until 24:00

function openOf(p: ScoredPOI['poi']): number { return p.openHour ?? OPEN_FALLBACK }
function closeOf(p: ScoredPOI['poi']): number { return p.closeHour ?? CLOSE_FALLBACK }
function durOf(p: ScoredPOI): number { return (p.poi as any).avgDuration ?? 60 }

export function planSlots(c: Constraints, persona: Persona): Category[] {
  const durH = c.durationMin / 60
  let n = durH <= 2.5 ? 3 : durH <= 4 ? 4 : 5
  if (c.pace === 'relaxed') n = Math.max(durH <= 3 ? 2 : 3, n - 1)
  if (c.pace === 'packed') n = Math.min(5, n + 1)

  const slots: Category[] = [...c.mustCategories]
  const fillers: Category[] = ['culture', 'dining', 'cafe', 'shopping', 'entertainment']
  for (const f of fillers) {
    if (slots.length >= n) break
    if (!slots.includes(f)) slots.push(f)
  }
  return slots.slice(0, n)
}

function topKForSlots(slots: Category[], scored: ScoredPOI[]): Map<number, ScoredPOI[]> {
  const byCat = new Map<Category, ScoredPOI[]>()
  for (const s of scored) {
    const arr = byCat.get(s.poi.category) ?? []
    arr.push(s)
    byCat.set(s.poi.category, arr)
  }
  const result = new Map<number, ScoredPOI[]>()
  slots.forEach((cat, idx) => {
    result.set(idx, (byCat.get(cat) ?? []).slice(0, TOPK_PER_SLOT))
  })
  return result
}

interface PartialRoute {
  picks: ScoredPOI[]
  usedIds: Set<string>
  scoreSum: number
  penalty: number
}

function estimateEta(picks: ScoredPOI[], c: Constraints, persona: Persona): number {
  let clock = c.startTime
  for (let i = 0; i < picks.length; i++) {
    if (i > 0) {
      const d = distBetween(picks[i - 1].poi, picks[i].poi)
      clock += travelEstimate(d, persona.walkTolerance).minutes / 60
    }
    clock = Math.max(clock, openOf(picks[i].poi)) + durOf(picks[i]) / 60
  }
  return clock + 0.2
}

function effectiveLatestEnd(c: Constraints, persona: Persona): number {
  return Math.min(persona.latestEnd, c.startTime + c.durationMin / 60 + 0.25)
}

export function buildRouteCandidates(
  scored: ScoredPOI[], c: Constraints, persona: Persona,
): { slots: Category[]; routes: Route[] } {
  const slots = planSlots(c, persona)
  const slotPools = topKForSlots(slots, scored)
  const latestEnd = effectiveLatestEnd(c, persona)
  let beams: PartialRoute[] = [{ picks: [], usedIds: new Set(), scoreSum: 0, penalty: 0 }]

  for (let i = 0; i < slots.length; i++) {
    const pool = slotPools.get(i) ?? []
    const next: PartialRoute[] = []
    for (const beam of beams) {
      if (pool.length === 0) { next.push(beam); continue }
      const eta = estimateEta(beam.picks, c, persona)
      const feasible = pool.filter((cand) => {
        const arrive = Math.max(eta, openOf(cand.poi))
        if (arrive >= closeOf(cand.poi) - 0.01) return false
        if (arrive + durOf(cand) / 60 > latestEnd + 0.5) return false
        return true
      })
      const usePool = feasible.length ? feasible : pool
      for (const cand of usePool) {
        if (beam.usedIds.has(cand.poi.id)) continue
        let legPenalty = 0
        const prev = beam.picks[beam.picks.length - 1]
        if (prev) {
          const d = distBetween(prev.poi, cand.poi)
          legPenalty = travelEstimate(d, persona.walkTolerance).minutes * 0.25
        }
        const waitPenalty = Math.max(0, openOf(cand.poi) - eta) * 6
        next.push({
          picks: [...beam.picks, cand],
          usedIds: new Set(beam.usedIds).add(cand.poi.id),
          scoreSum: beam.scoreSum + cand.score,
          penalty: beam.penalty + legPenalty + waitPenalty,
        })
      }
    }
    next.sort((a, b) => (b.scoreSum - b.penalty) - (a.scoreSum - a.penalty))
    const seen = new Set<string>()
    beams = []
    for (const b of next) {
      const k = b.picks.map((p) => p.poi.id).sort().join('|')
      if (seen.has(k)) continue
      seen.add(k)
      beams.push(b)
      if (beams.length >= BEAM) break
    }
  }

  const minStops = c.pace === 'relaxed' && slots.length <= 2 ? 2 : 3
  const routes = beams
    .filter((b) => b.picks.length >= minStops)
    .slice(0, OUTPUT)
    .map((b, idx) => materializeRoute(b.picks, c, persona, idx))
  return { slots, routes }
}

function orderStops(picks: ScoredPOI[], c: Constraints): ScoredPOI[] {
  const night = picks.filter((p) => p.poi.category === 'nightscape')
  const meals = picks.filter((p) => p.poi.category === 'dining')
  const rest = picks.filter((p) => p.poi.category !== 'nightscape' && p.poi.category !== 'dining')

  const nnOrder: ScoredPOI[] = []
  const remaining = [...rest]
  if (remaining.length) {
    let curr = remaining.shift()!
    nnOrder.push(curr)
    while (remaining.length) {
      let bestIdx = 0
      let bestD = Infinity
      remaining.forEach((cand, idx) => {
        const d = distBetween(curr.poi, cand.poi)
        if (d < bestD) { bestD = d; bestIdx = idx }
      })
      curr = remaining.splice(bestIdx, 1)[0]
      nnOrder.push(curr)
    }
  }
  if (c.startTime >= 18) return [...meals, ...nnOrder, ...night]
  const mid = Math.floor(nnOrder.length / 2)
  return [...nnOrder.slice(0, mid), ...meals, ...nnOrder.slice(mid), ...night]
}

export function materializeRoute(
  picks: ScoredPOI[], c: Constraints, persona: Persona, seq: number,
): Route {
  const ordered = orderStops(picks, c)
  const stops: RouteStop[] = []
  let clock = c.startTime
  let totalWalk = 0
  let totalTransit = 0
  let cost = 0

  ordered.forEach((sp, i) => {
    let leg: RouteStop['legFromPrev'] = null
    if (i > 0) {
      const d = distBetween(ordered[i - 1].poi, sp.poi)
      const t = travelEstimate(d, persona.walkTolerance)
      leg = { distM: Math.round(d), minutes: t.minutes, mode: t.mode }
      clock += t.minutes / 60
      if (t.mode === 'walk') totalWalk += t.minutes; else totalTransit += t.minutes
    }
    const arrive = Math.max(clock, sp.poi.openHour ?? OPEN_FALLBACK)
    const depart = arrive + durOf(sp) / 60
    clock = depart
    cost += sp.poi.perCapita ?? 0
    stops.push({
      poi: sp.poi,
      arrive,
      depart,
      legFromPrev: leg,
      reasons: sp.reasons,
      sources: sp.sources,
    })
  })

  const coverage = [...new Set(stops.map((s) => s.poi.category))]
  return {
    id: `route-${seq}`,
    stops,
    totalCost: Math.round(cost),
    totalWalkMin: totalWalk,
    totalTransitMin: totalTransit,
    endTime: clock,
    coverage,
    checks: [],
    explanation: '',
    risks: [],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/build.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/build.ts api/lib/agent/build.test.ts
git commit -m "feat(backend): build — beam search + materialize to contract Route (null-open safe)"
```

---

## Task 13: `validate` — ported checks with the queue check deleted

Ports `validateRoute` to the contract `Route`/`Check` shapes. **The `queue` (排队风险) check is removed** (no queue data). Open-hour checks skip POIs with `openHour == null` (unknown ≠ violation). Budget/mobility/coverage/count/schedule checks kept.

**Files:**
- Create: `api/lib/agent/validate.ts`
- Test: `api/lib/agent/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/validate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateRoute } from './validate'
import { personaFor } from './persona'
import type { Constraints, Route } from '../../../contract/index'

const persona = personaFor('couple')
const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: [], avoid: [],
  mustCategories: ['cafe', 'dining'], pace: 'normal', personaId: 'couple', raw: '人均200',
}

function route(over: Partial<Route> = {}): Route {
  const stop = {
    poi: { id: 'p1', name: '咖啡', category: 'cafe' as const, city: '上海', area: '静安区',
      lat: 31.2, lng: 121.4, rating: 4.5, perCapita: 78, tags: [], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' as const },
    arrive: 14, depart: 15, legFromPrev: null, reasons: [], sources: {},
  }
  return {
    id: 'r', stops: [stop], totalCost: 78, totalWalkMin: 0, totalTransitMin: 0, endTime: 15,
    coverage: ['cafe'], checks: [], explanation: '', risks: [], ...over,
  }
}

describe('validateRoute', () => {
  it('never emits a queue check', () => {
    const checks = validateRoute(route(), c, persona)
    expect(checks.find((k) => k.key === 'queue')).toBeUndefined()
  })

  it('flags budget overrun as warn/fail', () => {
    const checks = validateRoute(route({ totalCost: 260 }), c, persona)
    const budget = checks.find((k) => k.key === 'budget')!
    expect(['warn', 'fail']).toContain(budget.status)
  })

  it('does not fail open check when openHour is null', () => {
    const r = route()
    r.stops[0].poi = { ...r.stops[0].poi, openHour: null, closeHour: null }
    const open = validateRoute(r, c, persona).find((k) => k.key === 'open')!
    expect(open.status).toBe('pass')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/validate.test.ts`
Expected: FAIL — cannot resolve `./validate`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/validate.ts`:
```ts
import type { Check, Constraints, Route } from '../../../contract/index'
import type { Persona } from './types'

function fmtH(h: number): string {
  const hh = Math.floor(h) % 24
  const mm = Math.round((h - Math.floor(h)) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const CATEGORY_LABEL: Record<string, string> = {
  dining: '餐饮', cafe: '咖啡', culture: '文化', entertainment: '娱乐', shopping: '购物', nightscape: '夜景',
}

const MAX_LEG_DISTANCE_M = 12000
const MAX_LEG_MINUTES = 45
const MAX_WALK_MINUTES = 25

export function validateRoute(route: Route, c: Constraints, persona: Persona): Check[] {
  const checks: Check[] = []

  // 1) Open hours — skip POIs with unknown (null) hours.
  let openFail = 0, openWarn = 0
  const openDetails: string[] = []
  for (const s of route.stops) {
    const { openHour, closeHour, name } = s.poi
    if (openHour == null || closeHour == null) continue
    if (s.arrive < openHour - 0.01) { openFail++; openDetails.push(`${name} 未开门（${fmtH(openHour)} 营业）`) }
    else if (s.depart > closeHour + 0.01) {
      if (s.arrive < closeHour) { openWarn++; openDetails.push(`${name} 游玩跨越打烊（${fmtH(closeHour)}）`) }
      else { openFail++; openDetails.push(`${name} 已打烊（${fmtH(closeHour)}）`) }
    }
  }
  checks.push({
    key: 'open', label: '营业时间',
    status: openFail ? 'fail' : openWarn ? 'warn' : 'pass',
    detail: openFail || openWarn ? openDetails.join('；') : '全程均在营业时间内（未知营业时间的店未参与判定）',
  })

  // 2) Budget
  if (c.budgetPerCapita != null) {
    const ratio = route.totalCost / c.budgetPerCapita
    let status: Check['status'] = 'pass'
    if (ratio > 1.15) status = 'fail'
    else if (ratio > 1.0) status = 'warn'
    checks.push({
      key: 'budget', label: '预算', status,
      detail: `人均合计 ¥${route.totalCost} / 预算 ¥${c.budgetPerCapita}（${Math.round(ratio * 100)}%）`,
    })
  } else {
    checks.push({ key: 'budget', label: '预算', status: 'pass', detail: `未设预算 · 人均合计 ¥${route.totalCost}` })
  }

  // 3) Mobility
  const mobilityProblems = route.stops
    .filter((s) => {
      const leg = s.legFromPrev
      if (!leg) return false
      if (leg.distM > MAX_LEG_DISTANCE_M) return true
      if (leg.minutes > MAX_LEG_MINUTES) return true
      if (leg.mode === 'walk' && leg.minutes > MAX_WALK_MINUTES) return true
      return false
    })
    .map((s) => `${s.poi.name} 前一段 ${s.legFromPrev!.minutes} 分钟/${(s.legFromPrev!.distM / 1000).toFixed(1)}km`)
  const totalMove = route.totalWalkMin + route.totalTransitMin
  const durMin = Math.max(1, c.durationMin)
  checks.push({
    key: 'mobility', label: '移动距离',
    status: mobilityProblems.length || totalMove >= 100 ? 'fail' : totalMove > Math.min(90, durMin * 0.35) ? 'warn' : 'pass',
    detail: mobilityProblems.length
      ? `移动过长：${mobilityProblems.join('；')}`
      : totalMove >= 100 ? `总移动约 ${totalMove} 分钟，明显不适合作为本地路线`
      : `单段移动可控，总移动约 ${totalMove} 分钟`,
  })

  // 4) Coverage
  const cov = new Set(route.coverage)
  const missMust = c.mustCategories.filter((m) => !cov.has(m))
  checks.push({
    key: 'coverage', label: '类目覆盖',
    status: missMust.length ? 'warn' : cov.size >= 3 ? 'pass' : 'warn',
    detail: missMust.length
      ? `缺少你要求的类目：${missMust.map((m) => CATEGORY_LABEL[m] ?? m).join('、')}`
      : `覆盖 ${[...cov].map((x) => CATEGORY_LABEL[x] ?? x).join('、')}`,
  })

  // 5) Count
  const minStops = c.pace === 'relaxed' && c.durationMin <= 240 ? 2 : 3
  checks.push({
    key: 'count', label: 'POI 数量',
    status: route.stops.length >= minStops ? 'pass' : 'fail',
    detail: `${route.stops.length} 个 POI${route.stops.length >= minStops ? `（满足 ≥${minStops}）` : `（不足 ${minStops} 个）`}`,
  })

  // 6) Schedule window
  const plannedEnd = c.startTime + c.durationMin / 60
  if (route.endTime > plannedEnd + 0.5) {
    checks.push({ key: 'schedule', label: '时间窗口', status: 'fail', detail: `预计 ${fmtH(route.endTime)} 结束，明显超出本次 ${fmtH(plannedEnd)} 左右的时间窗口` })
  } else if (route.endTime > plannedEnd + 0.01) {
    checks.push({ key: 'schedule', label: '时间窗口', status: 'warn', detail: `预计 ${fmtH(route.endTime)} 结束，略超出本次 ${fmtH(plannedEnd)} 左右的时间窗口` })
  }

  return checks
}

export function checkSummary(checks: Check[]): { pass: number; warn: number; fail: number } {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/validate.ts api/lib/agent/validate.test.ts
git commit -m "feat(backend): validate — queue check deleted, null-open safe checks"
```

---

## Task 14: `repair` — ported auto-repair on budget/open/count fails

Ports `repairIfNeeded`. Works on the contract `Route` (re-runs `materializeRoute` + `validateRoute`). Replacements come from the real scored pool only. `perCapita == null` is treated as 0 cost for budget math (unknown price is never invented as expensive).

**Files:**
- Create: `api/lib/agent/repair.ts`
- Test: `api/lib/agent/repair.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/repair.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { repairIfNeeded } from './repair'
import { materializeRoute } from './build'
import { validateRoute } from './validate'
import { scorePOIs } from './score'
import { personaFor } from './persona'
import type { EnrichedPOI } from './types'
import type { Constraints } from '../../../contract/index'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap', sceneTags: [], avgDuration: 50, ...over,
  }
}

const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: [], avoid: [],
  mustCategories: ['cafe'], pace: 'normal', personaId: 'couple', raw: '人均200',
}
const persona = personaFor('couple')

describe('repairIfNeeded', () => {
  it('swaps an over-budget stop for a cheaper same-category candidate', () => {
    const pool: EnrichedPOI[] = [
      poi({ id: 'expensive', category: 'cafe', perCapita: 180 }),
      poi({ id: 'cheap', category: 'cafe', perCapita: 40, lat: 31.221, lng: 121.441 }),
      poi({ id: 'dine', category: 'dining', perCapita: 120, lat: 31.222, lng: 121.442 }),
      poi({ id: 'cult', category: 'culture', perCapita: 0, lat: 31.223, lng: 121.443, avgDuration: 90 }),
    ]
    const scored = scorePOIs(pool, c, persona, 31.22, 121.44)
    const picks = [scored.find((s) => s.poi.id === 'expensive')!, scored.find((s) => s.poi.id === 'dine')!, scored.find((s) => s.poi.id === 'cult')!]
    let route = materializeRoute(picks, c, persona, 0)
    route = { ...route, checks: validateRoute(route, c, persona) }
    const { route: fixed, logs } = repairIfNeeded(route, c, persona, scored)
    expect(fixed.totalCost).toBeLessThanOrEqual(route.totalCost)
    expect(logs.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/repair.test.ts`
Expected: FAIL — cannot resolve `./repair`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/repair.ts`:
```ts
import type { Constraints, Route, ScoredPOI } from '../../../contract/index'
import type { Persona } from './types'
import { materializeRoute } from './build'
import { validateRoute } from './validate'

export interface RepairLog {
  round: number
  trigger: string
  action: string
  before: string
  after: string
  resolved: boolean
}

const CATEGORY_LABEL: Record<string, string> = {
  dining: '餐饮', cafe: '咖啡', culture: '文化', entertainment: '娱乐', shopping: '购物', nightscape: '夜景',
}

function price(p: ScoredPOI): number { return p.poi.perCapita ?? 0 }
function durOf(p: ScoredPOI): number { return (p.poi as any).avgDuration ?? 60 }

function rebuild(picks: ScoredPOI[], c: Constraints, persona: Persona, seq: number): Route {
  const route = materializeRoute(picks, c, persona, seq)
  return { ...route, checks: validateRoute(route, c, persona) }
}

function names(route: Route): string {
  return route.stops.map((s) => s.poi.name).join(' → ')
}

function mealRequested(c: Constraints): boolean {
  return /吃饭|午饭|午餐|晚饭|晚餐|正餐|美食/.test(c.raw) || c.mustCategories.includes('dining')
}

function replacementPool(route: Route, allScored: ScoredPOI[], cat: string): ScoredPOI[] {
  const used = new Set(route.stops.map((s) => s.poi.id))
  return allScored.filter((s) => s.poi.category === cat && !used.has(s.poi.id))
}

function canDropStop(picks: ScoredPOI[], idx: number, c: Constraints): boolean {
  const stop = picks[idx]
  const minStops = c.pace === 'relaxed' && c.durationMin <= 180 ? 2 : 3
  if (picks.length <= minStops) return false
  if (stop.poi.category === 'dining' && mealRequested(c)) return false
  const remaining = picks.filter((_, i) => i !== idx)
  for (const cat of c.mustCategories) {
    if (!remaining.some((p) => p.poi.category === cat)) return false
  }
  return true
}

function openAtSlot(route: Route, idx: number, cand: ScoredPOI): boolean {
  const arrive = route.stops[idx]?.arrive
  if (arrive == null) return true
  const open = cand.poi.openHour ?? 0
  const close = cand.poi.closeHour ?? 24
  return arrive >= open - 0.01 && arrive + durOf(cand) / 60 <= close + 0.01
}

export function repairIfNeeded(
  route: Route, constraints: Constraints, persona: Persona, allScored: ScoredPOI[],
): { route: Route; logs: RepairLog[] } {
  let current = route
  const logs: RepairLog[] = []
  const maxRounds = constraints.budgetPerCapita != null ? 5 : 2

  for (let round = 1; round <= maxRounds; round++) {
    const budgetIssue = constraints.budgetPerCapita != null && current.totalCost > constraints.budgetPerCapita
      ? current.checks.find((k) => k.key === 'budget')
      : undefined
    const issue = budgetIssue ?? current.checks.find((k) => k.status === 'fail')
    if (!issue) break

    const before = names(current)
    let picks = current.stops.map((s) => ({
      poi: s.poi, score: 0, reasons: s.reasons, sources: s.sources,
    })) as ScoredPOI[]
    // restore real scores/avgDuration from the pool where possible
    picks = picks.map((p) => allScored.find((s) => s.poi.id === p.poi.id) ?? p)
    let action = ''

    if (issue.key === 'budget') {
      const sortedByPrice = picks.map((pick, idx) => ({ pick, idx })).sort((a, b) => price(b.pick) - price(a.pick))
      let patch: { idx: number; old: ScoredPOI; repl?: ScoredPOI; mode: 'same' | 'drop' } | null = null
      for (const { pick, idx } of sortedByPrice) {
        const repl = replacementPool(current, allScored, pick.poi.category)
          .filter((s) => price(s) < price(pick) && openAtSlot(current, idx, s))
          .sort((a, b) => price(a) - price(b) || b.score - a.score)[0]
        if (repl) { patch = { idx, old: pick, repl, mode: 'same' }; break }
      }
      if (!patch) {
        const drop = sortedByPrice.find(({ idx }) => canDropStop(picks, idx, constraints))
        if (drop) patch = { idx: drop.idx, old: drop.pick, mode: 'drop' }
      }
      if (!patch) {
        logs.push({ round, trigger: issue.label, action: '该区域内已无更低价候选，建议提高预算或减少站点', before, after: before, resolved: false })
        break
      }
      if (patch.mode === 'drop') {
        picks = picks.filter((_, idx) => idx !== patch!.idx)
        action = `预算超限，移除非必要站「${patch.old.poi.name}」`
      } else if (patch.repl) {
        picks[patch.idx] = patch.repl
        action = `预算超限，将「${patch.old.poi.name}」换成更低价「${patch.repl.poi.name}」`
      }
    } else if (issue.key === 'open') {
      const victim = current.stops.find((s) => issue.detail.includes(s.poi.name))
      if (!victim) break
      const idx = current.stops.findIndex((s) => s.poi.id === victim.poi.id)
      const arrive = victim.arrive
      const repl = replacementPool(current, allScored, victim.poi.category)
        .filter((s) => arrive >= (s.poi.openHour ?? 0) && arrive + durOf(s) / 60 <= (s.poi.closeHour ?? 24))
        .sort((a, b) => b.score - a.score)[0]
      if (!repl) { logs.push({ round, trigger: issue.label, action: '未找到营业时间匹配的同类候选', before, after: before, resolved: false }); break }
      picks[idx] = repl
      action = `营业时间冲突，将「${victim.poi.name}」替换为同类可营业的「${repl.poi.name}」`
    } else if (issue.key === 'count') {
      const used = new Set(picks.map((s) => s.poi.id))
      const add = allScored.find((s) => !used.has(s.poi.id))
      if (!add) break
      picks.push(add)
      action = `POI 数不足，补入高分候选「${add.poi.name}」`
    } else {
      logs.push({ round, trigger: issue.label, action: '保留路线，交给用户局部调整', before, after: before, resolved: false })
      break
    }

    current = rebuild(picks, constraints, persona, round)
    const after = names(current)
    const resolved = !current.checks.some((k) => k.key === issue.key && k.status !== 'pass')
    logs.push({ round, trigger: issue.label, action, before, after, resolved })
  }

  return { route: current, logs }
}
```

> Note: `CATEGORY_LABEL` is referenced for parity with the source engine's richer messages; the action strings above already inline店名, so it is intentionally available for future downgrade messaging without re-importing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/repair.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/repair.ts api/lib/agent/repair.test.ts
git commit -m "feat(backend): repair — budget/open/count auto-repair on contract Route"
```

---

## Task 15: `rank` — ported route ranking

Ports `rankRoutes` ranking math (check score + pace + compactness + budget). Drops the `src/data` anchor/semantic-verdict couplings (those relied on mock area maps). Re-numbers routes so `route-0` is the recommendation.

**Files:**
- Create: `api/lib/agent/rank.ts`
- Test: `api/lib/agent/rank.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/rank.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { rankRoutes } from './rank'
import { personaFor } from './persona'
import type { Constraints, Route } from '../../../contract/index'

const persona = personaFor('couple')
const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: [], avoid: [],
  mustCategories: ['cafe'], pace: 'normal', personaId: 'couple', raw: '人均200',
}

function route(id: string, totalCost: number, checks: Route['checks']): Route {
  return {
    id, stops: [], totalCost, totalWalkMin: 10, totalTransitMin: 0, endTime: 18,
    coverage: ['cafe'], checks, explanation: '', risks: [],
  }
}

describe('rankRoutes', () => {
  it('ranks the in-budget, all-pass route first and renames it route-0', () => {
    const good = route('a', 180, [{ key: 'budget', label: '预算', status: 'pass', detail: '' }])
    const bad = route('b', 320, [{ key: 'budget', label: '预算', status: 'fail', detail: '' }])
    const ranked = rankRoutes([bad, good], c, persona)
    expect(ranked[0].totalCost).toBe(180)
    expect(ranked[0].id).toBe('route-0')
    expect(ranked[1].id).toBe('route-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/rank.test.ts`
Expected: FAIL — cannot resolve `./rank`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/rank.ts`:
```ts
import type { Constraints, Route } from '../../../contract/index'
import type { Persona } from './types'
import { checkSummary } from './validate'

/** Composite rank: avg quality proxy (via checks) + pace fit + compactness + budget. Renumbers ids. */
export function rankRoutes(routes: Route[], c: Constraints, persona: Persona): Route[] {
  const scored = routes.map((r) => {
    const sum = checkSummary(r.checks)
    const checkScore = sum.pass * 3 - sum.warn * 4 - sum.fail * 15

    const actualMin = (r.endTime - c.startTime) * 60
    const overrun = actualMin - c.durationMin
    let paceScore = 0
    if (c.pace === 'relaxed') paceScore = -Math.abs(overrun) * 0.05
    else if (c.pace === 'packed') paceScore = overrun >= -30 ? 4 : -4
    else paceScore = -Math.max(0, overrun - 30) * 0.05

    const moveMin = r.totalWalkMin + r.totalTransitMin
    const compactScore = -moveMin * 0.06

    let budgetScore = 0
    if (c.budgetPerCapita != null && c.budgetPerCapita > 0) {
      const ratio = r.totalCost / c.budgetPerCapita
      budgetScore = ratio <= 1 ? 3 : -(ratio - 1) * 38 * (0.8 + persona.budgetSensitivity)
    }

    const rankScore = +(checkScore + paceScore + compactScore + budgetScore).toFixed(1)
    return { route: r, rankScore }
  })

  scored.sort((a, b) => b.rankScore - a.rankScore)
  return scored.map((s, i) => ({ ...s.route, id: `route-${i}` }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/rank.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/rank.ts api/lib/agent/rank.test.ts
git commit -m "feat(backend): rank — check/pace/compact/budget composite, route-0 = best"
```

---

## Task 16: DeepSeek client (injectable fetch, stream + reasoning_content)

Default model `deepseek-v4-flash`, ~20s timeout, handles `reasoning_content`. Two entry points: `chatJson` (used by `understand`, small/fast, JSON mode) and `chatStream` (used by `explain`, async-iterates content deltas, ignoring `reasoning_content`). Injectable `fetchImpl` keeps tests offline.

**Files:**
- Create: `api/lib/deepseek/client.ts`
- Test: `api/lib/deepseek/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/deepseek/client.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { chatJson, chatStream } from './client'

function sseStream(chunks: string[]) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

describe('chatJson', () => {
  it('parses a JSON object from the model content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"city":"上海","keywords":["静安 咖啡"]}' } }] }),
    } as Response))
    const out = await chatJson({ apiKey: 'K', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl: fetchMock })
    expect(out).toEqual({ city: '上海', keywords: ['静安 咖啡'] })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.model).toBe('deepseek-v4-flash')
  })

  it('returns null when not configured', async () => {
    const out = await chatJson({ apiKey: '', messages: [] }, { fetchImpl: vi.fn() as any })
    expect(out).toBeNull()
  })
})

describe('chatStream', () => {
  it('yields content deltas and skips reasoning_content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: sseStream([
        'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"先到"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"咖啡馆"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    } as unknown as Response))
    const deltas: string[] = []
    for await (const d of chatStream({ apiKey: 'K', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl: fetchMock })) {
      deltas.push(d)
    }
    expect(deltas).toEqual(['先到', '咖啡馆'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/deepseek/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement**

Create `api/lib/deepseek/client.ts`:
```ts
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_TIMEOUT_MS = 20000

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface DeepSeekDeps {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  model?: string
}

export interface ChatParams {
  apiKey: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

function modelOf(deps: DeepSeekDeps): string {
  return deps.model ?? process.env.DEEPSEEK_MODEL?.trim() ?? DEFAULT_MODEL
}

function extractJson(text: string): any {
  try { return JSON.parse(text) } catch { /* try fenced/braced */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) return JSON.parse(fenced)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
  throw new Error('model content is not JSON')
}

/** Small JSON call (understand). Returns parsed object or null when unconfigured/failed. */
export async function chatJson(p: ChatParams, deps: DeepSeekDeps = {}): Promise<any | null> {
  if (!p.apiKey) return null
  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetchImpl(DEEPSEEK_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelOf(deps),
        temperature: p.temperature ?? 0.2,
        max_tokens: p.maxTokens ?? 400,
        response_format: { type: 'json_object' },
        messages: p.messages,
      }),
    })
    if (!(res as Response).ok) return null
    const data = await (res as Response).json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null
    return extractJson(content)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Streamed chat (explain). Async-yields content deltas only (skips reasoning_content). */
export async function* chatStream(p: ChatParams, deps: DeepSeekDeps = {}): AsyncGenerator<string> {
  if (!p.apiKey) return
  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetchImpl(DEEPSEEK_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelOf(deps),
        temperature: p.temperature ?? 0.4,
        max_tokens: p.maxTokens ?? 600,
        stream: true,
        messages: p.messages,
      }),
    })
    const body = (res as Response).body
    if (!(res as Response).ok || !body) return
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const blocks = buf.split('\n\n')
      buf = blocks.pop() ?? ''
      for (const block of blocks) {
        const line = block.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const payload = line.slice(line.indexOf(':') + 1).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json?.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch { /* ignore malformed keep-alive */ }
      }
    }
  } catch {
    return
  } finally {
    clearTimeout(timer)
  }
}

export { DEFAULT_MODEL }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/deepseek/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/deepseek/client.ts api/lib/deepseek/client.test.ts
git commit -m "feat(backend): deepseek client — v4-flash json + streamed content (skips reasoning)"
```

---

## Task 17: `explain` — deterministic fallback text + LLM stream wiring

`explain` builds a deterministic Chinese reason from the route (always available, no LLM needed) and exposes `streamExplanation` that prefers DeepSeek `chatStream`, falling back to yielding the deterministic text in one chunk when the LLM is unconfigured/fails. We unit-test the deterministic builder and the fallback path (injected empty stream).

**Files:**
- Create: `api/lib/agent/explain.ts`
- Test: `api/lib/agent/explain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/explain.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deterministicExplanation, streamExplanation } from './explain'
import type { Constraints, Route } from '../../../contract/index'

const c: Constraints = {
  city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['cafe', 'dining'], pace: 'normal', personaId: 'couple', raw: '安静咖啡',
}

const route: Route = {
  id: 'route-0',
  stops: [
    { poi: { id: 'a', name: '安静咖啡馆', category: 'cafe', city: '上海', area: '静安区', lat: 31.2, lng: 121.4, rating: 4.6, perCapita: 78, tags: [], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' }, arrive: 14, depart: 15, legFromPrev: null, reasons: ['命中你的需求：安静'], sources: {} },
    { poi: { id: 'b', name: '老饭店', category: 'dining', city: '上海', area: '静安区', lat: 31.21, lng: 121.41, rating: 4.4, perCapita: 130, tags: [], openHour: 11, closeHour: 21, photos: [], tel: null, source: 'amap' }, arrive: 15.5, depart: 16.8, legFromPrev: { distM: 600, minutes: 8, mode: 'walk' }, reasons: [], sources: {} },
  ],
  totalCost: 208, totalWalkMin: 8, totalTransitMin: 0, endTime: 16.8,
  coverage: ['cafe', 'dining'], checks: [], explanation: '', risks: [],
}

describe('deterministicExplanation', () => {
  it('mentions every stop name in order', () => {
    const text = deterministicExplanation(route, c)
    expect(text.indexOf('安静咖啡馆')).toBeLessThan(text.indexOf('老饭店'))
    expect(text.length).toBeGreaterThan(10)
  })
})

describe('streamExplanation', () => {
  it('falls back to deterministic text when llm yields nothing', async () => {
    const deltas: string[] = []
    for await (const d of streamExplanation(route, c, { apiKey: '', stream: async function* () {} })) {
      deltas.push(d)
    }
    expect(deltas.join('')).toBe(deterministicExplanation(route, c))
  })

  it('passes through llm deltas when present', async () => {
    const deltas: string[] = []
    async function* fake() { yield '先到'; yield '咖啡馆。' }
    for await (const d of streamExplanation(route, c, { apiKey: 'K', stream: fake })) deltas.push(d)
    expect(deltas).toEqual(['先到', '咖啡馆。'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/explain.test.ts`
Expected: FAIL — cannot resolve `./explain`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/explain.ts`:
```ts
import type { Constraints, Route } from '../../../contract/index'
import { chatStream, type ChatMessage } from '../deepseek/client'

const CATEGORY_LABEL: Record<string, string> = {
  dining: '正餐', cafe: '咖啡', culture: '文化点', entertainment: '娱乐', shopping: '逛街', nightscape: '夜景',
}

function fmtH(h: number): string {
  const hh = Math.floor(h) % 24
  const mm = Math.round((h - Math.floor(h)) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Always-available deterministic reasoning text — no LLM, no fabrication. */
export function deterministicExplanation(route: Route, c: Constraints): string {
  const parts: string[] = []
  route.stops.forEach((s, i) => {
    const when = fmtH(s.arrive)
    const cat = CATEGORY_LABEL[s.poi.category] ?? '一站'
    const price = s.poi.perCapita != null ? `（人均¥${s.poi.perCapita}）` : ''
    const lead = i === 0 ? `${when} 先到${cat}「${s.poi.name}」${price}` : `随后约 ${when} 前往「${s.poi.name}」${price}`
    const reason = s.reasons[0] ? `，${s.reasons[0]}` : ''
    parts.push(`${lead}${reason}。`)
  })
  const budget = c.diningBudgetPerCapita != null
    ? `全程正餐预算控制在 ¥${c.diningBudgetPerCapita} 内。`
    : c.budgetPerCapita != null ? `人均合计约 ¥${route.totalCost}，在 ¥${c.budgetPerCapita} 预算内。` : ''
  return parts.join('') + budget
}

function buildPrompt(route: Route, c: Constraints): ChatMessage[] {
  const stops = route.stops.map((s) => ({
    name: s.poi.name, category: s.poi.category, area: s.poi.area,
    rating: s.poi.rating, perCapita: s.poi.perCapita, reasons: s.reasons,
  }))
  return [
    { role: 'system', content: '你是本地路线讲解员。用温暖、具体的中文写一段推荐理由，扣住用户的需求与每一站的真实信息，不要编造数据，不要 Markdown。' },
    { role: 'user', content: JSON.stringify({ request: c.raw, constraints: { prefs: c.prefs, party: c.party, budgetPerCapita: c.budgetPerCapita, diningBudgetPerCapita: c.diningBudgetPerCapita }, stops }) },
  ]
}

export interface ExplainDeps {
  apiKey: string
  /** Injectable stream for tests; defaults to deepseek chatStream. */
  stream?: (messages: ChatMessage[]) => AsyncGenerator<string>
}

/** Streams explanation deltas: LLM if it produces anything, else the deterministic text. */
export async function* streamExplanation(route: Route, c: Constraints, deps: ExplainDeps): AsyncGenerator<string> {
  const messages = buildPrompt(route, c)
  const streamFn = deps.stream
    ?? ((m: ChatMessage[]) => chatStream({ apiKey: deps.apiKey, messages: m }))
  let produced = false
  if (deps.apiKey) {
    for await (const delta of streamFn(messages)) {
      produced = true
      yield delta
    }
  }
  if (!produced) yield deterministicExplanation(route, c)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/explain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/explain.ts api/lib/agent/explain.test.ts
git commit -m "feat(backend): explain — deterministic reasoning + streamed LLM with fallback"
```

---

## Task 18: SSE writer + auth primitives

`sse.js` sets the streaming response headers and writes contract-framed events (via `encodeSSE`). `auth.js` does bcrypt hashing/verify, session-token generation, and bearer parsing. Bcrypt is pure (no DB) so it is unit-tested directly.

**Files:**
- Create: `api/lib/sse.js`
- Create: `api/lib/auth.js`
- Test: `api/lib/auth.test.ts`
- Test: `api/lib/sse.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/lib/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, newToken, parseBearer } from './auth.js'

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret!')
    expect(await verifyPassword('s3cret!', hash)).toBe(true)
    expect(await verifyPassword('nope', hash)).toBe(false)
  })
})

describe('tokens', () => {
  it('newToken returns a long unique hex string', () => {
    const a = newToken()
    const b = newToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })
  it('parseBearer extracts the token', () => {
    expect(parseBearer('Bearer abc.def')).toBe('abc.def')
    expect(parseBearer('')).toBeNull()
    expect(parseBearer('Basic x')).toBeNull()
  })
})
```

Create `api/lib/sse.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { openSSE } from './sse.js'

function fakeRes() {
  return {
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    statusCode: 0,
    setHeader(k: string, v: string) { this.headers[k] = v },
    writeHead(code: number) { this.statusCode = code; return this },
    write(s: string) { this.chunks.push(s); return true },
    end() { this.ended = true },
    ended: false,
  }
}

describe('openSSE', () => {
  it('sets event-stream headers and frames events', () => {
    const res = fakeRes()
    const sse = openSSE(res as any)
    expect(res.headers['Content-Type']).toBe('text/event-stream')
    sse.send({ type: 'stage', key: 'understand', label: '读懂需求', status: 'ok' })
    expect(res.chunks.join('')).toContain('event: stage\n')
    sse.close()
    expect(res.ended).toBe(true)
  })

  it('rejects an event that violates the contract schema', () => {
    const res = fakeRes()
    const sse = openSSE(res as any)
    expect(() => sse.send({ type: 'mystery' } as any)).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/lib/auth.test.ts api/lib/sse.test.ts`
Expected: FAIL — cannot resolve `./auth.js` / `./sse.js`.

- [ ] **Step 3: Implement**

Create `api/lib/auth.js`:
```js
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false
  return bcrypt.compare(plain, hash)
}

/** Opaque session/device token. */
export function newToken() {
  return randomBytes(24).toString('hex')
}

/** Extract a bearer token from an Authorization header value. */
export function parseBearer(header) {
  const value = typeof header === 'string' ? header.trim() : ''
  const m = value.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/** Session expiry: 30 days from now (ISO). */
export function sessionExpiry() {
  return new Date(Date.now() + 30 * 86400_000).toISOString()
}
```

Create `api/lib/sse.js`:
```js
import { encodeSSE, SSEEventSchema } from '../../contract/index'

/** Open an SSE stream on a Vercel/Node res. Returns { send, comment, close }. */
export function openSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (typeof res.writeHead === 'function') res.writeHead(200)

  return {
    /** Validate against the frozen contract, then write the framed event. */
    send(event) {
      const parsed = SSEEventSchema.parse(event)
      res.write(encodeSSE(parsed))
    },
    /** SSE comment line — keep-alive, never parsed by clients. */
    comment(text = 'keep-alive') {
      res.write(`: ${text}\n\n`)
    },
    close() {
      res.end()
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/lib/auth.test.ts api/lib/sse.test.ts`
Expected: PASS (4 + 2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/auth.js api/lib/sse.js api/lib/auth.test.ts api/lib/sse.test.ts
git commit -m "feat(backend): sse writer (contract-validated) + bcrypt/session auth primitives"
```

---

## Task 19: DB data-access (users / plans / history / sessions / guests)

CRUD + history-migration on the schema from Task 8. DB-touching tests skip when `DATABASE_URL` is unset; they truncate between runs to stay independent.

**Files:**
- Create: `api/lib/db/users.js`
- Create: `api/lib/db/plans.js`
- Create: `api/lib/db/history.js`
- Test: `api/lib/db/dataaccess.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/db/dataaccess.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getSql, hasDatabase } from './client.js'
import { createUser, findUserByUsername, createSession, userForSession } from './users.js'
import { createGuest } from './users.js'
import { savePlan } from './plans.js'
import { listHistory, getPlan, migrateGuestPlans } from './history.js'
import { hashPassword, newToken, sessionExpiry } from '../auth.js'

const maybe = hasDatabase() ? describe : describe.skip

maybe('db data access', () => {
  beforeEach(async () => {
    const sql = getSql()
    await sql`TRUNCATE plans, sessions, guests, users RESTART IDENTITY CASCADE`
  })

  it('creates and looks up a user, issues a session', async () => {
    const user = await createUser({ username: 'amy', passwordHash: await hashPassword('pw'), prefs: ['quiet'], budgetPref: 200 })
    expect(user.username).toBe('amy')
    const again = await findUserByUsername('amy')
    expect(again!.id).toBe(user.id)
    const token = newToken()
    await createSession(token, user.id, sessionExpiry())
    const resolved = await userForSession(token)
    expect(resolved!.id).toBe(user.id)
  })

  it('saves plans and lists/gets history; migrates guest plans to a user', async () => {
    const device = newToken()
    await createGuest(device)
    await savePlan({ id: 'plan-1', userId: null, deviceToken: device, request: 'r', constraints: { city: '上海' }, routes: [], dataSources: {} })
    let hist = await listHistory({ deviceToken: device })
    expect(hist).toHaveLength(1)
    const got = await getPlan('plan-1')
    expect(got!.request).toBe('r')

    const user = await createUser({ username: 'bob', passwordHash: await hashPassword('pw'), prefs: [], budgetPref: null })
    await migrateGuestPlans(device, user.id)
    const userHist = await listHistory({ userId: user.id })
    expect(userHist).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/db/dataaccess.test.ts`
Expected: FAIL — cannot resolve the modules. (Skipped to green when `DATABASE_URL` unset — in that case temporarily set it per Preconditions to exercise these.)

- [ ] **Step 3: Implement**

Create `api/lib/db/users.js`:
```js
import { getSql } from './client.js'

export async function createUser({ username, passwordHash, prefs = [], budgetPref = null }) {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO users (username, password_hash, prefs, budget_pref)
    VALUES (${username}, ${passwordHash}, ${JSON.stringify(prefs)}::jsonb, ${budgetPref})
    RETURNING id, username, prefs, budget_pref, created_at
  `
  return rows[0]
}

export async function findUserByUsername(username) {
  const sql = getSql()
  const rows = await sql`SELECT id, username, password_hash, prefs, budget_pref FROM users WHERE username = ${username}`
  return rows[0] ?? null
}

export async function createSession(token, userId, expiresAt) {
  const sql = getSql()
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expiresAt})`
}

export async function userForSession(token) {
  if (!token) return null
  const sql = getSql()
  const rows = await sql`
    SELECT u.id, u.username, u.prefs, u.budget_pref
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()
  `
  return rows[0] ?? null
}

export async function createGuest(deviceToken, prefs = []) {
  const sql = getSql()
  await sql`
    INSERT INTO guests (device_token, prefs) VALUES (${deviceToken}, ${JSON.stringify(prefs)}::jsonb)
    ON CONFLICT (device_token) DO NOTHING
  `
  return { deviceToken }
}
```

Create `api/lib/db/plans.js`:
```js
import { getSql } from './client.js'

export async function savePlan({ id, userId = null, deviceToken = null, request, constraints, routes, dataSources }) {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO plans (id, user_id, device_token, request, constraints, routes, data_sources)
    VALUES (${id}, ${userId}, ${deviceToken}, ${request},
            ${JSON.stringify(constraints)}::jsonb, ${JSON.stringify(routes)}::jsonb, ${JSON.stringify(dataSources)}::jsonb)
    RETURNING id, created_at
  `
  return rows[0]
}
```

Create `api/lib/db/history.js`:
```js
import { getSql } from './client.js'

/** List a user's or guest's plans, newest first. */
export async function listHistory({ userId = null, deviceToken = null, limit = 30 }) {
  const sql = getSql()
  if (userId != null) {
    return sql`
      SELECT id, request, constraints, created_at FROM plans
      WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}
    `
  }
  if (deviceToken) {
    return sql`
      SELECT id, request, constraints, created_at FROM plans
      WHERE device_token = ${deviceToken} ORDER BY created_at DESC LIMIT ${limit}
    `
  }
  return []
}

export async function getPlan(id) {
  const sql = getSql()
  const rows = await sql`SELECT id, request, constraints, routes, data_sources, created_at FROM plans WHERE id = ${id}`
  return rows[0] ?? null
}

/** Attach a guest's anonymous plans to a user after login. */
export async function migrateGuestPlans(deviceToken, userId) {
  const sql = getSql()
  await sql`UPDATE plans SET user_id = ${userId} WHERE device_token = ${deviceToken} AND user_id IS NULL`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (with `DATABASE_URL` set + schema applied): `npx vitest run api/lib/db/dataaccess.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/db/users.js api/lib/db/plans.js api/lib/db/history.js api/lib/db/dataaccess.test.ts
git commit -m "feat(backend): db data access — users/sessions/guests/plans/history + guest migration"
```

---

## Task 20: `loop` orchestrator — yields the SSE event sequence

The heart of the backend: an async generator that runs the stages and **yields contract `SSEEvent`s** in the spec's order (`stage` → `constraints` → `candidates` → `route` → `explanation`… → `done`/`error`). It calls injected dependencies (`resolveLocation`, `understand`, `retrieve`, `streamExplanation`, `savePlan`) so the whole pipeline is testable offline with no network/DB. **No fallback fake routes**: `needs-clarification` when no city, `insufficient-data` when real POIs < 2, `upstream-unavailable` when Amap errors with zero data.

The `route` event is yielded right after `rank` (seconds), then `explanation` deltas stream, then `done`. This ordering is the spec's key timing guarantee.

**Files:**
- Create: `api/lib/agent/loop.ts`
- Test: `api/lib/agent/loop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/loop.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runPlanLoop } from './loop'
import { SSEEventSchema } from '../../../contract/index'
import type { EnrichedPOI } from './types'

function poi(over: Partial<EnrichedPOI>): EnrichedPOI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [], openHour: 9, closeHour: 22,
    photos: [], tel: null, source: 'amap', sceneTags: ['quiet'], avgDuration: 50, ...over,
  }
}

const realPois: EnrichedPOI[] = [
  poi({ id: 'cafe1', category: 'cafe', sceneTags: ['quiet'] }),
  poi({ id: 'dine1', category: 'dining', perCapita: 120, lat: 31.223, lng: 121.443 }),
  poi({ id: 'cult1', category: 'culture', perCapita: 0, lat: 31.225, lng: 121.445, avgDuration: 90 }),
]

const baseDeps = {
  resolveLocation: async () => ({ status: 'resolved', city: '上海', district: '静安区', center: { lat: 31.22, lng: 121.44 } }),
  understand: async () => ({
    constraints: {
      city: '上海', district: '静安区', startTime: 14, durationMin: 300, party: 2,
      budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
      mustCategories: ['cafe', 'dining', 'culture'], pace: 'normal', personaId: 'couple', raw: '安静咖啡',
    },
    keywords: ['静安区 咖啡'], llmUsed: false,
  }),
  retrieve: async () => ({ pois: realPois, center: { lat: 31.22, lng: 121.44 }, cacheHits: 1, cacheMisses: 1, amapStatus: 'ok' as const }),
  streamExplanation: async function* () { yield '推荐理由。' },
  savePlan: async () => ({ id: 'plan-1' }),
  planId: () => 'plan-1',
}

const request = {
  request: '周末下午静安找个安静咖啡，再吃顿本帮菜',
  preferences: { personaPick: 'couple' as const, prefs: ['quiet'], budgetPref: null },
  previousPlan: null,
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('runPlanLoop', () => {
  it('emits a contract-valid event sequence ending in done, route before explanation', async () => {
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, baseDeps as any))
    for (const e of events) expect(() => SSEEventSchema.parse(e)).not.toThrow()
    const types = events.map((e) => e.type)
    expect(types).toContain('constraints')
    expect(types).toContain('candidates')
    expect(types.indexOf('route')).toBeLessThan(types.indexOf('explanation'))
    expect(types.at(-1)).toBe('done')
  })

  it('emits needs-clarification when no city resolves (no fake fallback)', async () => {
    const deps = { ...baseDeps, resolveLocation: async () => ({ status: 'needs-clarification', city: null, message: '需要城市' }) }
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, deps as any))
    const err = events.find((e) => e.type === 'error')
    expect(err.code).toBe('needs-clarification')
    expect(events.some((e) => e.type === 'route')).toBe(false)
  })

  it('emits insufficient-data when fewer than 2 real POIs', async () => {
    const deps = { ...baseDeps, retrieve: async () => ({ pois: [realPois[0]], center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'ok' as const }) }
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, deps as any))
    expect(events.find((e) => e.type === 'error').code).toBe('insufficient-data')
  })

  it('emits upstream-unavailable when amap errors with no data', async () => {
    const deps = { ...baseDeps, retrieve: async () => ({ pois: [], center: { lat: 31.22, lng: 121.44 }, cacheHits: 0, cacheMisses: 1, amapStatus: 'error' as const }) }
    const events = await collect(runPlanLoop(request, { deviceToken: 'd', userId: null }, deps as any))
    expect(events.find((e) => e.type === 'error').code).toBe('upstream-unavailable')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/loop.test.ts`
Expected: FAIL — cannot resolve `./loop`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/loop.ts`:
```ts
import type { Constraints, DataSources, PlanRequest, Route, SSEEvent } from '../../../contract/index'
import type { EnrichedPOI, RetrieveResult, UnderstandResult } from './types'
import { personaFor } from './persona'
import { scorePOIs } from './score'
import { buildRouteCandidates } from './build'
import { validateRoute } from './validate'
import { repairIfNeeded } from './repair'
import { rankRoutes } from './rank'

export interface LoopDeps {
  resolveLocation: (raw: string) => Promise<{ status: string; city: string | null; district?: string | null; center?: { lat: number; lng: number }; message?: string }>
  understand: (raw: string, loc: any, persona: any, preferences: any) => Promise<UnderstandResult>
  retrieve: (keywords: string[], loc: any) => Promise<RetrieveResult>
  streamExplanation: (route: Route, c: Constraints) => AsyncGenerator<string>
  savePlan: (record: any) => Promise<{ id: string }>
  planId: () => string
}

export interface LoopIdentity { deviceToken: string | null; userId: number | null }

function stage(key: string, label: string, status: 'running' | 'ok' | 'skip' | 'fail', extra: Partial<SSEEvent> = {}): SSEEvent {
  return { type: 'stage', key, label, status, ...extra } as SSEEvent
}

export async function* runPlanLoop(
  req: PlanRequest, identity: LoopIdentity, deps: LoopDeps,
): AsyncGenerator<SSEEvent> {
  const persona = personaFor(req.preferences.personaPick)

  // 1) resolveLocation
  yield stage('resolve', '定位城市', 'running')
  const loc = await deps.resolveLocation(req.request)
  if (loc.status !== 'resolved' || !loc.city || !loc.center) {
    yield stage('resolve', '定位城市', 'fail')
    yield { type: 'error', code: 'needs-clarification', message: loc.message || '需要补充具体城市或区域，未默认回退。', recoverable: true }
    return
  }
  yield stage('resolve', '定位城市', 'ok', { summary: loc.city })

  // 2) understand
  yield stage('understand', '读懂需求', 'running')
  const understood = await deps.understand(req.request, loc, persona, req.preferences)
  const constraints = understood.constraints
  yield stage('understand', '读懂需求', 'ok', { summary: understood.llmUsed ? 'LLM 解析' : '规则解析' })
  yield { type: 'constraints', constraints }

  // 3) retrieve
  yield stage('retrieve', '召回真实地点', 'running')
  const retrieved = await deps.retrieve(understood.keywords, { ...loc, district: loc.district ?? constraints.district })
  if (retrieved.pois.length < 2) {
    yield stage('retrieve', '召回真实地点', 'fail')
    if (retrieved.amapStatus === 'error' || retrieved.amapStatus === 'not_configured') {
      yield { type: 'error', code: 'upstream-unavailable', message: '高德 POI 服务暂不可用，未编造地点。', recoverable: true }
    } else {
      yield { type: 'error', code: 'insufficient-data', message: '该区域真实地点不足，无法组成路线。', recoverable: true }
    }
    return
  }
  yield stage('retrieve', '召回真实地点', 'ok', { summary: `${retrieved.pois.length} 家真实店` })

  // 4) score
  yield stage('score', '打分', 'running')
  const pois: EnrichedPOI[] = retrieved.pois
  const scored = scorePOIs(pois, constraints, persona, retrieved.center.lat, retrieved.center.lng)
  yield stage('score', '打分', 'ok')
  yield { type: 'candidates', candidates: scored }

  // 5) build
  yield stage('build', '组合路线', 'running')
  const { routes: built } = buildRouteCandidates(scored, constraints, persona)
  if (built.length === 0) {
    yield stage('build', '组合路线', 'fail')
    yield { type: 'error', code: 'insufficient-data', message: '真实候选无法组成满足约束的路线。', recoverable: true }
    return
  }
  yield stage('build', '组合路线', 'ok', { summary: `${built.length} 条候选` })

  // 6) validate + repair
  yield stage('validate', '体检', 'running')
  const validated = built.map((r) => ({ ...r, checks: validateRoute(r, constraints, persona) }))
  yield stage('validate', '体检', 'ok')

  yield stage('repair', '修复', 'running')
  const repaired = validated.map((r) => repairIfNeeded(r, constraints, persona, scored).route)
  yield stage('repair', '修复', 'ok')

  // 7) rank → route event (seconds; before explanation)
  const ranked = rankRoutes(repaired, constraints, persona)
  const best = ranked[0]
  yield { type: 'route', route: best }

  // 8) explanation (streamed, after route)
  yield stage('explain', '写推荐理由', 'running')
  let explanation = ''
  for await (const delta of deps.streamExplanation(best, constraints)) {
    explanation += delta
    yield { type: 'explanation', routeId: best.id, delta }
  }
  yield stage('explain', '写推荐理由', 'ok')

  // 9) persist + done
  const finalRoutes: Route[] = ranked.map((r, i) => (i === 0 ? { ...r, explanation } : r))
  const dataSources: DataSources = {
    amapPoi: { configured: true, used: retrieved.amapStatus === 'ok', status: retrieved.amapStatus },
    amapRoute: { configured: true, used: best.stops.some((s) => s.legFromPrev?.mode === 'walk'), status: 'ok' },
    deepseek: { configured: !!explanation, used: !!explanation, status: explanation ? 'ok' : 'fallback' },
    cache: { hits: retrieved.cacheHits, misses: retrieved.cacheMisses },
  }
  const planId = deps.planId()
  await deps.savePlan({
    id: planId, userId: identity.userId, deviceToken: identity.deviceToken,
    request: req.request, constraints, routes: finalRoutes, dataSources,
  })
  yield { type: 'done', planId, routes: finalRoutes, dataSources }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/loop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/loop.ts api/lib/agent/loop.test.ts
git commit -m "feat(backend): agent loop — contract event sequence, route-before-explanation, honest errors"
```

---

## Task 21: `understand` LLM wiring (DeepSeek → constraints+keywords, fallback on failure)

The real `understand` entry: ask DeepSeek (small, fast, JSON) to turn raw text + preferences into `{ prefs, mustCategories, startHour, durationMin, party, budget, keywords }`, then **merge over the deterministic fallback** so a timeout/failure degrades gracefully to the regex parser (spec §10). City/district always come from `resolveLocation`, never the LLM.

**Files:**
- Create: `api/lib/agent/understandLLM.ts`
- Test: `api/lib/agent/understandLLM.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/lib/agent/understandLLM.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { understand } from './understandLLM'
import { personaFor } from './persona'

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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/lib/agent/understandLLM.test.ts`
Expected: FAIL — cannot resolve `./understandLLM`.

- [ ] **Step 3: Implement**

Create `api/lib/agent/understandLLM.ts`:
```ts
import type { Category, Constraints } from '../../../contract/index'
import type { Persona, UnderstandResult } from './types'
import { parseConstraintsFallback, fallbackKeywords, type ResolvedLocation } from './understand'
import { chatJson } from '../deepseek/client'

export interface UnderstandDeps {
  apiKey?: string
  chatJson?: (messages: any[]) => Promise<any | null>
}

const VALID_CATS: Category[] = ['dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape']

function prompt(raw: string, loc: ResolvedLocation, persona: Persona, prefs: any) {
  return [
    { role: 'system', content: '你把中文出行需求解析成结构化 JSON。只输出 JSON。不要给城市/区县（后端已定位）。字段：prefs(string[]) mustCategories(取自 dining|cafe|culture|entertainment|shopping|nightscape) startHour(0-24) durationMin party diningBudget(number|null) totalBudget(number|null) keywords(高德搜索关键词数组，含区县前缀)。' },
    { role: 'user', content: JSON.stringify({ request: raw, district: loc.district, persona: persona.id, userPrefs: prefs.prefs, budgetPref: prefs.budgetPref }) },
  ]
}

/** LLM-first constraints+keywords, merged over the deterministic fallback. */
export async function understand(
  raw: string, loc: ResolvedLocation, persona: Persona, prefs: any, deps: UnderstandDeps = {},
): Promise<UnderstandResult> {
  const base = parseConstraintsFallback(raw, loc, persona)
  // merge explicit user-picked prefs (always honoured)
  for (const p of prefs.prefs ?? []) if (!base.prefs.includes(p)) base.prefs.push(p)

  const call = deps.chatJson ?? ((m: any[]) => chatJson({ apiKey: deps.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '', messages: m }))
  let llm: any = null
  try { llm = await call(prompt(raw, loc, persona, prefs)) } catch { llm = null }

  if (!llm || typeof llm !== 'object') {
    return { constraints: base, keywords: fallbackKeywords(base), llmUsed: false }
  }

  const mustCategories = Array.isArray(llm.mustCategories)
    ? (llm.mustCategories.filter((c: any) => VALID_CATS.includes(c)) as Category[])
    : base.mustCategories
  const merged: Constraints = {
    ...base,
    startTime: Number.isFinite(llm.startHour) ? Number(llm.startHour) : base.startTime,
    durationMin: Number.isFinite(llm.durationMin) ? Number(llm.durationMin) : base.durationMin,
    party: Number.isFinite(llm.party) && llm.party > 0 ? Number(llm.party) : base.party,
    diningBudgetPerCapita: llm.diningBudget != null ? Number(llm.diningBudget) : base.diningBudgetPerCapita,
    budgetPerCapita: llm.totalBudget != null ? Number(llm.totalBudget) : base.budgetPerCapita,
    prefs: [...new Set([...(Array.isArray(llm.prefs) ? llm.prefs : []), ...base.prefs])].map(String),
    mustCategories: mustCategories.length ? mustCategories : base.mustCategories,
  }
  const keywords = Array.isArray(llm.keywords) && llm.keywords.length
    ? llm.keywords.filter((k: any) => typeof k === 'string').slice(0, 8)
    : fallbackKeywords(merged)
  return { constraints: merged, keywords, llmUsed: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/lib/agent/understandLLM.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/agent/understandLLM.ts api/lib/agent/understandLLM.test.ts
git commit -m "feat(backend): understand — LLM constraints+keywords merged over regex fallback"
```

---

## Task 22: HTTP handlers (`api/plan.js`, auth, history) + `vercel.json`

The thin Vercel function wiring. `api/plan.js` resolves identity from the bearer/device token, opens SSE, drives `runPlanLoop` with the real dependencies, and streams events. Auth + history handlers are plain JSON. These are integration glue (no new logic), verified by `vercel dev` smoke; no separate unit test (the units are all covered above).

**Files:**
- Create: `api/plan.js`
- Create: `api/auth/register.js`, `api/auth/login.js`, `api/auth/guest.js`, `api/auth/me.js`
- Create: `api/history/index.js`, `api/history/[id].js`
- Create: `vercel.json`

- [ ] **Step 1: Implement `api/plan.js`**

Create `api/plan.js`:
```js
import { randomUUID } from 'node:crypto'
import { PlanRequestSchema } from '../contract/index'
import { resolveLocation, getAmapKey } from './lib/locationResolver.js'
import { openSSE } from './lib/sse.js'
import { parseBearer } from './lib/auth.js'
import { userForSession, createGuest } from './lib/db/users.js'
import { savePlan } from './lib/db/plans.js'
import { hasDatabase } from './lib/db/client.js'
import { runPlanLoop } from './lib/agent/loop.ts'
import { understand } from './lib/agent/understandLLM.ts'
import { retrieve } from './lib/agent/retrieve.ts'
import { streamExplanation } from './lib/agent/explain.ts'
import { readCache, writeCache } from './lib/amap/cache.js'

function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return req.body
}

async function identityFromReq(req) {
  const token = parseBearer(req.headers?.authorization)
  if (token && hasDatabase()) {
    const user = await userForSession(token)
    if (user) return { userId: Number(user.id), deviceToken: null }
  }
  const device = String(req.headers?.['x-device-token'] || '').trim() || randomUUID()
  if (hasDatabase()) await createGuest(device).catch(() => {})
  return { userId: null, deviceToken: device }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Device-Token')
    return res.status(204).end()
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST /api/plan' })

  const parsed = PlanRequestSchema.safeParse(readBody(req))
  if (!parsed.success) {
    const sse = openSSE(res)
    sse.send({ type: 'error', code: 'bad-request', message: '请求格式不正确。', recoverable: false })
    return sse.close()
  }

  const identity = await identityFromReq(req)
  const sse = openSSE(res)
  const key = getAmapKey()
  const deps = {
    resolveLocation,
    understand: (raw, loc, persona, preferences) => understand(raw, loc, persona, preferences, {}),
    retrieve: (keywords, loc) => retrieve({ keywords, location: loc, key }, {
      readCache: (k) => readCache(k), writeCache: (k, payload) => writeCache(k, payload),
    }),
    streamExplanation: (route, c) => streamExplanation(route, c, { apiKey: process.env.DEEPSEEK_API_KEY ?? '' }),
    savePlan: (record) => (hasDatabase() ? savePlan(record) : Promise.resolve({ id: record.id })),
    planId: () => `plan-${randomUUID()}`,
  }

  try {
    for await (const event of runPlanLoop(parsed.data, identity, deps)) {
      sse.send(event)
    }
  } catch (err) {
    sse.send({ type: 'error', code: 'upstream-unavailable', message: '规划过程出现异常，请稍后再试。', recoverable: true })
  } finally {
    sse.close()
  }
}
```

- [ ] **Step 2: Implement the auth handlers**

Create `api/auth/register.js`:
```js
import { hashPassword, newToken, sessionExpiry } from '../lib/auth.js'
import { createUser, findUserByUsername, createSession } from '../lib/db/users.js'
import { migrateGuestPlans } from '../lib/db/history.js'
import { hasDatabase } from '../lib/db/client.js'

function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  if (!hasDatabase()) return res.status(503).json({ error: 'database not configured' })
  const { username, password, deviceToken } = readBody(req)
  if (!username || !password || String(password).length < 6) {
    return res.status(400).json({ error: '用户名必填，密码至少 6 位。' })
  }
  if (await findUserByUsername(username)) return res.status(409).json({ error: '用户名已存在。' })
  const user = await createUser({ username, passwordHash: await hashPassword(password) })
  const token = newToken()
  await createSession(token, user.id, sessionExpiry())
  if (deviceToken) await migrateGuestPlans(deviceToken, user.id).catch(() => {})
  return res.status(201).json({ token, user: { id: user.id, username: user.username } })
}
```

Create `api/auth/login.js`:
```js
import { verifyPassword, newToken, sessionExpiry } from '../lib/auth.js'
import { findUserByUsername, createSession } from '../lib/db/users.js'
import { migrateGuestPlans } from '../lib/db/history.js'
import { hasDatabase } from '../lib/db/client.js'

function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  if (!hasDatabase()) return res.status(503).json({ error: 'database not configured' })
  const { username, password, deviceToken } = readBody(req)
  const user = await findUserByUsername(username)
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码不正确。' })
  }
  const token = newToken()
  await createSession(token, user.id, sessionExpiry())
  if (deviceToken) await migrateGuestPlans(deviceToken, user.id).catch(() => {})
  return res.status(200).json({ token, user: { id: user.id, username: user.username } })
}
```

Create `api/auth/guest.js`:
```js
import { randomUUID } from 'node:crypto'
import { createGuest } from '../lib/db/users.js'
import { hasDatabase } from '../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  const deviceToken = randomUUID()
  if (hasDatabase()) await createGuest(deviceToken).catch(() => {})
  return res.status(201).json({ deviceToken })
}
```

Create `api/auth/me.js`:
```js
import { parseBearer } from '../lib/auth.js'
import { userForSession } from '../lib/db/users.js'
import { hasDatabase } from '../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  const token = parseBearer(req.headers?.authorization)
  if (!token || !hasDatabase()) return res.status(200).json({ user: null })
  const user = await userForSession(token)
  return res.status(200).json({ user: user ? { id: user.id, username: user.username, prefs: user.prefs, budgetPref: user.budget_pref } : null })
}
```

- [ ] **Step 3: Implement the history handlers**

Create `api/history/index.js`:
```js
import { parseBearer } from '../lib/auth.js'
import { userForSession } from '../lib/db/users.js'
import { listHistory } from '../lib/db/history.js'
import { hasDatabase } from '../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  if (!hasDatabase()) return res.status(200).json({ plans: [] })
  const token = parseBearer(req.headers?.authorization)
  const user = token ? await userForSession(token) : null
  const deviceToken = String(req.headers?.['x-device-token'] || '').trim() || null
  const plans = await listHistory(user ? { userId: Number(user.id) } : { deviceToken })
  return res.status(200).json({ plans })
}
```

Create `api/history/[id].js`:
```js
import { getPlan } from '../lib/db/history.js'
import { hasDatabase } from '../lib/db/client.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  if (!hasDatabase()) return res.status(404).json({ error: 'not found' })
  const id = req.query?.id
  const plan = await getPlan(String(id))
  if (!plan) return res.status(404).json({ error: 'not found' })
  return res.status(200).json({ plan })
}
```

- [ ] **Step 4: Implement `vercel.json`**

Create `vercel.json`:
```json
{
  "functions": {
    "api/**/*.js": { "runtime": "nodejs20.x", "maxDuration": 60 }
  }
}
```

- [ ] **Step 5: Typecheck and run the full suite**

Run:
```bash
npx tsc --noEmit
npm test
```
Expected: typecheck clean; all backend + contract unit tests PASS (DB tests pass or skip per `DATABASE_URL`).

- [ ] **Step 6: Smoke the endpoint with `vercel dev`**

Run (with `.env.local` populated):
```bash
vercel dev &
sleep 4
curl -N -X POST http://localhost:3000/api/plan \
  -H 'Content-Type: application/json' \
  -d '{"request":"周末下午在静安找个安静咖啡，再吃顿本帮菜，人均300内吃饭","preferences":{"personaPick":"couple","prefs":["quiet"],"budgetPref":null},"previousPlan":null}'
```
Expected: an SSE stream with `event: stage`, `event: constraints`, `event: candidates`, `event: route` (within seconds), `event: explanation` deltas, then `event: done`. With no Amap key, expect a single `event: error` with `upstream-unavailable` — never a fake route.

- [ ] **Step 7: Commit**

```bash
git add api/plan.js api/auth api/history vercel.json
git commit -m "feat(backend): http handlers (plan SSE + auth + history) and vercel maxDuration 60"
```

---

## Self-Review

### Spec §4 coverage map

| Spec §4 item | Covered by |
|---|---|
| `api/plan.js` SSE entry | Task 22 |
| `api/auth/{register,login,guest,me}.js` | Task 22 |
| `api/history/{index,[id]}.js` | Task 22 |
| `agent/loop.js` (stages + SSE) | Task 20 |
| `agent/understand.js` (LLM intent + keywords, replaces keywordsFor + hardcoded anchors) | Task 5 (fallback) + Task 21 (LLM merge) |
| `agent/retrieve.js` (Amap recall + cache + features) | Task 10 |
| `agent/score.js` (ported, no-mock feature set) | Task 11 |
| `agent/build.js` (beam search) | Task 12 |
| `agent/validate.js` (queue check deleted) | Task 13 |
| `agent/repair.js` / `rank.js` | Tasks 14 / 15 |
| `agent/explain.js` (DeepSeek stream + deterministic fallback) | Task 17 |
| `agent/persona.js` (user-pick driven weights) | Task 3 |
| `amap/{client,poiFeatures,cache}.js` | Tasks 7 / 6 / 9 |
| `deepseek/client.js` (v4-flash, ~20s, reasoning_content, stream) | Task 16 |
| `db/{schema.sql,client,users,plans,history}.js` | Tasks 8 / 19 |
| `sse.js` / `errors.js` / `auth.js` | Tasks 18 / 2 / 18 |
| `vercel.json` maxDuration 60 | Task 22 |
| Delete popularity + queue features, reallocate weights | Task 11 (SCORE_WEIGHTS), Task 13 (queue check gone), Task 6 (no reviews/queue produced) |
| Real `business` fields only, null when absent | Task 6 |
| `poi_cache` TTL 14–30 days; walking legs cached | Task 9 |
| DeepSeek default model / timeout / reasoning / stream | Task 16 |
| Neon schema (users/sessions/guests/plans/poi_cache) | Task 8 |
| Auth: username+password bcrypt, session token, guest device token, login migration | Tasks 18 / 19 / 22 |
| SSE via contract `encodeSSE`; events validated by contract schema | Task 18 (openSSE validates), Tasks 20/22 |
| no-mock error states (needs-clarification / insufficient-data / upstream-unavailable) | Task 20 (loop branches), Task 2 (PlanError codes) |
| `route` seconds-first, `explanation` non-blocking after | Task 20 (yield order asserted in loop.test) |

Forgot-password is intentionally **out of scope** per spec §4 ("找回密码暂不做").

### Placeholder scan

No `TBD`/`TODO`/"similar to Task N"/"add appropriate error handling". Every code step is complete and runnable. The one explanatory note (Task 14 `CATEGORY_LABEL`) documents an intentionally-available constant, not a gap.

### Type consistency

- All `agent/*` modules import data types from `../../../contract/index` — `Constraints`, `POI`, `ScoredPOI`, `Route`, `RouteStop`, `Check`, `DataSources`, `Category`, `FieldSource`, `SSEEvent`, `PlanRequest`. Nothing re-defines a contract type.
- `EnrichedPOI extends POI` (Task 2) adds only `sceneTags` + `avgDuration`; the deterministic core reads `avgDuration` defensively (`(p.poi as any).avgDuration ?? 60`) so a plain contract `POI` still works.
- `ScoredPOI` shape (`poi`, `score`, `reasons`, `sources`) is produced by `score.ts` and consumed unchanged by `build`/`repair`; `RouteStop` (`poi`, `arrive`, `depart`, `legFromPrev`, `reasons`, `sources`) is produced by `materializeRoute` and validated by the contract in `loop.test`/`sse.test`.
- `LegSchema` (`{distM, minutes, mode:'walk'|'transit'}`) matches `materializeRoute`'s leg objects.
- The SSE event objects yielded by `runPlanLoop` and written by `openSSE.send` are parsed by `SSEEventSchema` in three tests (loop, sse, plan handler path), guaranteeing seam conformance.
- `personaId` / `personaPick` enums align with the contract (`couple|family|friends|solo` + `auto` only on the request side, mapped in `personaFor`).

### Known risks / spec gaps surfaced

1. **`understand` on the critical path** (spec §10): mitigated — `understandLLM` always merges over the deterministic `parseConstraintsFallback`, and `chatJson` returns `null` on timeout (~20s cap), so a slow/failed LLM degrades to the regex parser instead of stalling. Consider lowering the `understand` timeout below the global 20s in production.
2. **Amap v5 field names** (`opentime_today`, `business.cost`, `cost.duration` on walking): assumed from spec's `show_fields=business,photos`. If real responses differ, only `poiFeatures.ts` / `client.ts` change — both are isolated and unit-tested with injected fixtures. Validate against one live call during Task 22 smoke.
3. **`.ts` imports from `.js` handlers** (`api/plan.js` importing `loop.ts`): relies on Vercel's Node runtime resolving `.ts`. If a build step is required, add `tsx`/`esbuild` precompile to the function or rename the agent modules to compiled `.js`; the boundary is intentionally thin.
4. **5000/month Amap search quota**: cache (Task 9) is the only protection. The loop counts hits/misses into `dataSources.cache`; monitor in production and widen TTL toward 30 days or pre-warm popular city+keyword keys if misses spike.

**Task count: 22.** All of spec §4 is covered.
