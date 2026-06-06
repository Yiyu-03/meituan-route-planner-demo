# Plan B · Frontend Worktree — Login / Amap Map / SSE Consumption / v2 手帐 Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Vite + React frontend as a pure presentation layer (zero planning logic): delete `src/engine` / `src/data` / `src/mock`; split routing into `/login` (hard gate + guest entry) and `/app` (planner) behind an `AuthGate`; load real 高德 JS map tiles via a dedicated JS key; consume the frozen `contract/` SSE stream (`parseSSE` thinking, browser `fetch` + `ReadableStream`); render streamed `stage / constraints / candidates / route / explanation / done / error` events into a map-primary layout (desktop right-rail timeline, mobile bottom sheet); and固化 the v2 "漫游·手帐" design system (朱砂印章 logo, LXGW WenKai + Fraunces + Noto Sans SC, 暖纸+墨黑+朱砂红, 横格纸纹+胶带+印章, 拍立得 photos, lucide-react icons, no emoji). Frontend develops fully offline against `contract/fixtures/`.

**Architecture:** Two pages (`LoginView`, `PlannerView`) mounted by a tiny hash/router in `App.tsx`; `AuthGate` reads session from `src/api/auth.ts` and redirects unauthenticated `/app` visits to `/login`. The planner calls `streamPlan()` in `src/api/planStream.ts`, which in dev reads a recorded fixture from `contract/fixtures/` (selected by a `VITE_PLAN_SOURCE=fixtures` flag) and in live mode does `fetch('/api/plan', {method:'POST'})` then reads the `ReadableStream` body, splitting on `\n\n` and feeding each frame through the contract's `parseSSE` logic. Every emitted event is validated with `SSEEventSchema` (imported from `contract/`). A single `usePlanStream` reducer hook turns the event sequence into UI state (`stages`, `constraints`, `candidates`, `route`, `explanation`, `error`, `done`). Each event type drives a distinct piece of UI: `stage`→`ProgressTrail` dots; `constraints`→understood chips; `candidates`→`RouteMap` markers; `route`→map polyline + `Itinerary`; `explanation`→typewriter append per `StopCard`; `error`→`EmptyState`. All data/event types are imported from `contract/` — never redefined here. No mock data, no fabricated POI features, no hardcoded city anchors, no fake routes — `EmptyState` renders honest empty states for the three error codes.

**Tech Stack:** TypeScript (ESM), React 18, Vite 5, Tailwind 3, lucide-react (already installed), zod + `contract/` (from Plan 0), 高德 JS API 2.0 (loaded at runtime, no npm dep), vitest + @testing-library/react + jsdom (new devDeps).

---

## Preconditions

- **Plan 0 (contract seam) is merged on `main`.** `contract/index.ts` exports `PlanRequest`, `PlanRequestSchema`, `SSEEvent`, `SSEEventSchema`, `parseSSE`, `encodeSSE`, `Constraints`, `ScoredPOI`, `Route`, `RouteStop`, `POI`, `Check`, `DataSources`, `Category`, plus the fixtures `contract/fixtures/shanghai-quiet-cafe.sse.txt` and `contract/fixtures/needs-clarification.sse.txt`. This plan imports those names; it does not define them.
- This plan runs inside the `feat/frontend-redesign` git worktree (created per spec §8). All commands assume repo root as CWD.
- `vitest.config.ts` already exists from Plan 0 with `include: ['contract/**/*.test.ts', 'src/**/*.test.ts']`.

---

## File Structure (end state)

```
src/
  api/
    planStream.ts        # streamPlan(): fixtures-mode + live-mode SSE consumer
    auth.ts              # session token storage + login/register/guest/me/logout
    history.ts           # list/get saved plans
  map/
    AmapProvider.tsx     # loads 高德 JS SDK with dedicated JS key + security code
    RouteMap.tsx         # polyline + numbered markers + candidate dots
  components/
    InputBar.tsx         # structured prompt + one-tap example + persona/pref chips
    ProgressTrail.tsx    # stage dots (replaces 调试面板 vibe)
    PlanSummary.tsx      # route cover: 印章 stamp + budget/walk summary
    Itinerary.tsx        # the timeline / list of StopCard
    StopCard.tsx         # one stop: 拍立得 photo + per-field source label + user actions
    WhyDrawer.tsx        # collapses trace/constraints/dataSources/checks
    AccountMenu.tsx      # identity + logout + history
    EmptyState.tsx       # honest empty states for error codes
  views/
    LoginView.tsx        # /login — 翻开手帐第一页 仪式感
    PlannerView.tsx      # /app — map-primary planner
  design/
    tokens.css           # v2 design tokens (fonts + colors + textures)
    icons.tsx            # lucide-react icon wrappers (no emoji anywhere)
  hooks/
    usePlanStream.ts     # event-sequence → UI state reducer
  App.tsx                # router + AuthGate
  main.tsx              # imports design/tokens.css
```

Deleted: `src/engine/`, `src/data/`, `src/mock/`, `src/eval/`, `src/lib/`, `src/views/MainDashboard.tsx`, `src/types/index.ts`, and every file under `src/components/` except those listed above (all rebuilt). `scripts/runEval.ts` and `scripts/test-planner-regressions.js` references in `package.json` are removed.

---

## Task 1: Add test tooling + delete the old frontend

**Files:**
- Modify: `package.json` (devDeps + scripts)
- Create: `vitest.setup.ts`
- Modify: `vitest.config.ts` (jsdom env + setup for `src/`)
- Delete: `src/engine/`, `src/data/`, `src/mock/`, `src/eval/`, `src/lib/`, old components, old views/types

- [ ] **Step 1: Install test deps**

Run:
```bash
npm install -D @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.3 @testing-library/user-event@^14.5.2 jsdom@^25.0.1
```
Expected: 4 packages added to `devDependencies`, no peer-dep errors (React 18 satisfies @testing-library/react 16).

- [ ] **Step 2: Replace the planner-eval scripts in `package.json`**

In `package.json`, replace the `"scripts"` block with:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Create the vitest setup file**

Create `vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 4: Teach vitest to run React tests in jsdom**

Replace `vitest.config.ts` with:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['contract/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['src/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
```

- [ ] **Step 5: Delete the old planning frontend (no-mock cleanup, spec §5/§7)**

Run:
```bash
git rm -r src/engine src/data src/mock src/eval src/lib \
  src/views/MainDashboard.tsx src/types/index.ts \
  src/components scripts
```
Expected: all listed paths removed from the index. `src/App.tsx`, `src/main.tsx`, `src/index.css` remain (rebuilt in later tasks).

- [ ] **Step 6: Confirm no `src` tests exist yet and suite still runs contract tests**

Run:
```bash
npm test
```
Expected: contract tests PASS; no `src/**` test files found yet (that is fine — vitest reports only the contract files).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(frontend): add RTL+jsdom tooling, delete engine/data/mock/old-ui

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 固化 v2 design tokens (`design/tokens.css`)

Spec §5 "v2 设计规范": brand 漫游·手帐, 朱砂印章, LXGW WenKai + Fraunces + Noto Sans SC, 暖纸+墨黑+朱砂红 palette, 横格纸纹+颗粒噪点+胶带+印章 textures.

**Files:**
- Create: `src/design/tokens.css`
- Modify: `src/main.tsx` (import tokens before index.css)
- Test: `src/design/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/design/tokens.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

describe('v2 design tokens', () => {
  it('defines the warm-paper / ink / 朱砂红 palette variables', () => {
    expect(css).toContain('--paper-base: #efe7d4')
    expect(css).toContain('--paper-card: #fbf6ea')
    expect(css).toContain('--ink: #241f17')
    expect(css).toContain('--cinnabar: #bb3a2c')
    expect(css).toContain('--amber: #bd7c22')
    expect(css).toContain('--sage: #5e7757')
  })

  it('imports the three brand fonts', () => {
    expect(css).toContain('LXGW WenKai')
    expect(css).toContain('Fraunces')
    expect(css).toContain('Noto Sans SC')
  })

  it('exposes paper-line + tape + stamp material helpers', () => {
    expect(css).toContain('--paper-lines')
    expect(css).toContain('.tape')
    expect(css).toContain('.stamp')
    expect(css).toContain('.polaroid')
  })

  it('contains no emoji glyphs', () => {
    // eslint-disable-next-line no-control-regex
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emoji.test(css)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/design/tokens.test.ts`
Expected: FAIL — cannot read `tokens.css`.

- [ ] **Step 3: Implement the tokens**

Create `src/design/tokens.css`:
```css
/* ============================================================
   漫游·手帐 / Stroll · Shanghai — v2 design tokens (spec §5)
   暖纸 + 墨黑 + 朱砂红;横格纸纹 + 颗粒噪点 + 胶带 + 印章;拍立得照片。
   ============================================================ */

/* Fonts: 霞鹜文楷(标题/手写感) · Fraunces(拉丁/数字,斜体) · Noto Sans SC(正文) */
@import url('https://chinese-fonts-cdn.deno.dev/packages/lxgwwenkai/dist/LXGWWenKai-Regular/result.css');
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,400;1,9..144,600&family=Noto+Sans+SC:wght@400;500;700&display=swap');

:root {
  /* palette */
  --paper-base: #efe7d4;     /* 暖纸基底 */
  --paper-card: #fbf6ea;     /* 卡片纸 */
  --ink: #241f17;            /* 墨黑(正文/三站点之一) */
  --ink-soft: #5b5040;       /* 次级墨色 */
  --cinnabar: #bb3a2c;       /* 主强调:朱砂红(印章/marker) */
  --amber: #bd7c22;          /* 次强调:琥珀 */
  --sage: #5e7757;           /* 次强调:鼠尾草 */
  --hairline: rgba(36, 31, 23, 0.14);

  /* type */
  --font-hand: 'LXGW WenKai', 'Noto Sans SC', serif;   /* 标题/手写感 */
  --font-latin: 'Fraunces', Georgia, serif;            /* 拉丁字与数字(斜体) */
  --font-body: 'Noto Sans SC', -apple-system, 'PingFang SC', sans-serif;

  /* materials */
  --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
  --paper-lines:
    linear-gradient(transparent 27px, rgba(36, 31, 23, 0.08) 28px) 0 0 / 100% 28px,
    linear-gradient(90deg, rgba(187, 58, 44, 0.10) 1px, transparent 1px) 38px 0 / 38px 100%;

  --radius: 6px;
  --shadow-paper: 0 14px 36px rgba(62, 45, 25, 0.16);
  --shadow-stamp: 0 1px 0 rgba(36, 31, 23, 0.12);
}

/* 暖纸 + 横格 + 颗粒噪点 底纹 */
.paper-surface {
  background-color: var(--paper-base);
  background-image: var(--grain), var(--paper-lines);
  color: var(--ink);
  font-family: var(--font-body);
}

.paper-card {
  background: var(--paper-card);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--shadow-paper);
}

/* 拉丁字/数字用 Fraunces 斜体 */
.latin {
  font-family: var(--font-latin);
  font-style: italic;
  font-variant-numeric: lining-nums;
}

/* 手写感标题 */
.hand {
  font-family: var(--font-hand);
  letter-spacing: 0.02em;
}

/* 胶带:压在拍立得/纸片一角 */
.tape {
  position: absolute;
  width: 64px;
  height: 22px;
  background: rgba(189, 124, 34, 0.28);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  transform: rotate(-4deg);
  mix-blend-mode: multiply;
}

/* 朱砂印章:盖戳质感(品牌 logo + 路线状态 stamp) */
.stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--cinnabar);
  border: 2px solid var(--cinnabar);
  border-radius: 8px;
  padding: 4px 10px;
  font-family: var(--font-hand);
  letter-spacing: 0.08em;
  transform: rotate(-6deg);
  box-shadow: var(--shadow-stamp);
  opacity: 0.92;
}

/* 门店真实照片以拍立得样式呈现:白边 + 微旋转 + 压胶带 */
.polaroid {
  position: relative;
  background: #fff;
  padding: 6px 6px 22px;
  border: 1px solid var(--hairline);
  box-shadow: 0 6px 16px rgba(62, 45, 25, 0.2);
  transform: rotate(-1.6deg);
}
.polaroid img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 三站点圆点:墨黑 / 朱砂 / 鼠尾草 — 与地图 pin 对应 */
.dot-ink { background: var(--ink); }
.dot-cinnabar { background: var(--cinnabar); }
.dot-sage { background: var(--sage); }
```

- [ ] **Step 4: Wire it into the app entry**

Replace `src/main.tsx` with:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './design/tokens.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/design/tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/design/tokens.css src/main.tsx src/design/tokens.test.ts
git commit -m "feat(frontend): v2 漫游手帐 design tokens (fonts/palette/textures)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: lucide-react icon wrappers (`design/icons.tsx`, no emoji)

Spec §5: lucide 线性图标,禁用 emoji. Centralize so no component reaches for an emoji.

**Files:**
- Create: `src/design/icons.tsx`
- Test: `src/design/icons.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/design/icons.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CategoryIcon, BrandStamp, ActionIcons } from './icons'

describe('icon wrappers', () => {
  it('renders an svg for every contract category', () => {
    for (const c of ['dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape'] as const) {
      const { container } = render(<CategoryIcon category={c} />)
      expect(container.querySelector('svg')).not.toBeNull()
    }
  })
  it('exposes the user-action icons used by StopCard', () => {
    expect(ActionIcons.navigate).toBeTypeOf('object')
    expect(ActionIcons.book).toBeTypeOf('object')
    expect(ActionIcons.call).toBeTypeOf('object')
    expect(ActionIcons.save).toBeTypeOf('object')
  })
  it('renders the 朱砂 brand stamp text', () => {
    const { getByText } = render(<BrandStamp />)
    expect(getByText('漫游·手帐')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/design/icons.test.tsx`
Expected: FAIL — cannot resolve `./icons`.

- [ ] **Step 3: Implement the wrappers**

Create `src/design/icons.tsx`:
```tsx
import type { LucideIcon } from 'lucide-react'
import {
  Utensils, Coffee, Landmark, Ticket, ShoppingBag, Moon,
  Navigation, CalendarCheck, Phone, BookmarkPlus,
  MapPin, Footprints, Wallet, Clock, Stamp,
} from 'lucide-react'
import type { Category } from '../../contract'

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  dining: Utensils,
  cafe: Coffee,
  culture: Landmark,
  entertainment: Ticket,
  shopping: ShoppingBag,
  nightscape: Moon,
}

export function CategoryIcon({ category, size = 18 }: { category: Category; size?: number }) {
  const Icon = CATEGORY_ICON[category]
  return <Icon size={size} strokeWidth={1.7} aria-hidden />
}

/** User-action icons for StopCard (导航/订座/电话/收藏) — spec §5 product review. */
export const ActionIcons = {
  navigate: Navigation,
  book: CalendarCheck,
  call: Phone,
  save: BookmarkPlus,
} satisfies Record<string, LucideIcon>

export const MetaIcons = {
  pin: MapPin,
  walk: Footprints,
  wallet: Wallet,
  clock: Clock,
} satisfies Record<string, LucideIcon>

/** 朱砂印章 logo — not a "rounded square with an icon". */
export function BrandStamp() {
  return (
    <span className="stamp hand inline-flex items-center gap-1 text-[15px]">
      <Stamp size={16} strokeWidth={1.8} aria-hidden />
      漫游·手帐
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/design/icons.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/design/icons.tsx src/design/icons.test.tsx
git commit -m "feat(frontend): lucide icon wrappers + 朱砂 brand stamp (no emoji)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Auth client (`api/auth.ts`)

Spec §5: `/login` 硬门槛 + 访客入口; `AuthGate` 守卫. Backend endpoints `auth/register|login|guest|me` (spec §4) return a session/device token. This client wraps them and persists the token.

**Files:**
- Create: `src/api/auth.ts`
- Test: `src/api/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api/auth.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { getToken, setSession, clearSession, currentIdentity, login, guest, authHeader } from './auth'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('session token storage', () => {
  it('starts with no token', () => {
    expect(getToken()).toBeNull()
    expect(currentIdentity()).toBeNull()
  })
  it('persists then clears a session', () => {
    setSession({ token: 't1', kind: 'user', name: 'ada' })
    expect(getToken()).toBe('t1')
    expect(currentIdentity()).toEqual({ token: 't1', kind: 'user', name: 'ada' })
    expect(authHeader()).toEqual({ Authorization: 'Bearer t1' })
    clearSession()
    expect(getToken()).toBeNull()
  })
})

describe('login', () => {
  it('posts credentials and stores the returned token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'sess-9', kind: 'user', name: 'ada' }),
    })) as unknown as typeof fetch)
    const id = await login('ada', 'pw')
    expect(id).toEqual({ token: 'sess-9', kind: 'user', name: 'ada' })
    expect(getToken()).toBe('sess-9')
  })
  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ message: '用户名或密码错误' }),
    })) as unknown as typeof fetch)
    await expect(login('ada', 'bad')).rejects.toThrow('用户名或密码错误')
  })
})

describe('guest', () => {
  it('obtains and stores an anonymous device token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ token: 'dev-1', kind: 'guest', name: '访客' }),
    })) as unknown as typeof fetch)
    const id = await guest()
    expect(id.kind).toBe('guest')
    expect(getToken()).toBe('dev-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Implement the client**

Create `src/api/auth.ts`:
```ts
export type IdentityKind = 'user' | 'guest'

export interface Identity {
  token: string
  kind: IdentityKind
  name: string
}

const STORAGE_KEY = 'stroll-shanghai-session-v1'

export function currentIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Identity>
    if (!parsed.token || !parsed.kind) return null
    return { token: parsed.token, kind: parsed.kind, name: parsed.name ?? '' }
  } catch {
    return null
  }
}

export function getToken(): string | null {
  return currentIdentity()?.token ?? null
}

export function setSession(identity: Identity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function authHeader(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function postIdentity(path: string, body: unknown): Promise<Identity> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detail?.message ?? `请求失败 (${res.status})`)
  }
  const identity = (await res.json()) as Identity
  setSession(identity)
  return identity
}

export function register(username: string, password: string): Promise<Identity> {
  return postIdentity('/api/auth/register', { username, password })
}

export function login(username: string, password: string): Promise<Identity> {
  return postIdentity('/api/auth/login', { username, password })
}

export function guest(): Promise<Identity> {
  return postIdentity('/api/auth/guest', {})
}

export async function logout(): Promise<void> {
  clearSession()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/auth.ts src/api/auth.test.ts
git commit -m "feat(frontend): auth client (login/register/guest + token storage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: SSE plan stream client (`api/planStream.ts`)

Spec §5/§6: consume the contract SSE stream; dev runs offline against `contract/fixtures/`. Browser uses `fetch` + `ReadableStream`, splitting on `\n\n` and validating each frame with the contract's `SSEEventSchema` (same logic as `parseSSE`).

**Files:**
- Create: `src/api/planStream.ts`
- Test: `src/api/planStream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api/planStream.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { streamPlan } from './planStream'
import type { SSEEvent } from '../../contract'

const fixture = readFileSync(
  join(__dirname, '..', '..', 'contract', 'fixtures', 'shanghai-quiet-cafe.sse.txt'),
  'utf8',
)

function streamFromText(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // emit in two chunks, splitting mid-frame to prove the buffer reassembles
      const mid = Math.floor(text.length / 2)
      controller.enqueue(new TextEncoder().encode(text.slice(0, mid)))
      controller.enqueue(new TextEncoder().encode(text.slice(mid)))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => vi.restoreAllMocks())

describe('streamPlan over a live ReadableStream', () => {
  it('reassembles chunked frames and yields validated events in order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamFromText(fixture)) as unknown as typeof fetch)
    const got: SSEEvent[] = []
    await streamPlan(
      { request: 'x', preferences: { personaPick: 'auto', prefs: [], budgetPref: null }, previousPlan: null },
      { source: 'live', onEvent: (e) => got.push(e) },
    )
    expect(got[0].type).toBe('stage')
    expect(got.at(-1)?.type).toBe('done')
  })

  it('surfaces an error event from the clarification fixture in fixtures mode', async () => {
    const got: SSEEvent[] = []
    await streamPlan(
      { request: '随便', preferences: { personaPick: 'auto', prefs: [], budgetPref: null }, previousPlan: null },
      { source: 'fixtures', fixture: 'needs-clarification', onEvent: (e) => got.push(e) },
    )
    expect(got.some((e) => e.type === 'error' && e.code === 'needs-clarification')).toBe(true)
  })

  it('rejects a frame that violates the contract schema', async () => {
    const bad = 'event: stage\ndata: {"type":"stage"}\n\n'
    vi.stubGlobal('fetch', vi.fn(async () => streamFromText(bad)) as unknown as typeof fetch)
    await expect(
      streamPlan(
        { request: 'x', preferences: { personaPick: 'auto', prefs: [], budgetPref: null }, previousPlan: null },
        { source: 'live', onEvent: () => {} },
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/planStream.test.ts`
Expected: FAIL — cannot resolve `./planStream`.

- [ ] **Step 3: Implement the stream client**

Create `src/api/planStream.ts`:
```ts
import { SSEEventSchema, type SSEEvent, type PlanRequest } from '../../contract'
import { authHeader } from './auth'

const FIXTURES = import.meta.glob('../../contract/fixtures/*.sse.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export type PlanSource = 'live' | 'fixtures'

export interface StreamPlanOptions {
  /** 'fixtures' = offline dev against recorded streams; 'live' = POST /api/plan. */
  source?: PlanSource
  /** fixtures-mode: which recorded stream, e.g. 'shanghai-quiet-cafe'. */
  fixture?: string
  onEvent: (event: SSEEvent) => void
  signal?: AbortSignal
}

/** Default source comes from the build flag so prod ships live mode. */
function defaultSource(): PlanSource {
  return import.meta.env.VITE_PLAN_SOURCE === 'live' ? 'live' : 'fixtures'
}

/** Parse one SSE block ("event: x\ndata: {...}") into a validated event, or null for keep-alives. */
function parseBlock(block: string): SSEEvent | null {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return null
  const json = dataLine.slice(dataLine.indexOf(':') + 1).trim()
  if (!json) return null
  return SSEEventSchema.parse(JSON.parse(json))
}

function lookupFixture(name: string): string {
  const key = Object.keys(FIXTURES).find((k) => k.endsWith(`/${name}.sse.txt`))
  if (!key) throw new Error(`未找到离线流: ${name}`)
  return FIXTURES[key]
}

async function streamFromFixture(name: string, onEvent: (e: SSEEvent) => void): Promise<void> {
  const text = lookupFixture(name)
  for (const block of text.split('\n\n')) {
    const event = parseBlock(block)
    if (event) onEvent(event)
  }
}

async function streamFromBackend(
  request: PlanRequest,
  onEvent: (e: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeader() },
    body: JSON.stringify(request),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`规划接口不可用 (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const event = parseBlock(block)
      if (event) onEvent(event)
    }
  }
  const tail = parseBlock(buffer)
  if (tail) onEvent(tail)
}

export async function streamPlan(request: PlanRequest, opts: StreamPlanOptions): Promise<void> {
  const source = opts.source ?? defaultSource()
  if (source === 'fixtures') {
    await streamFromFixture(opts.fixture ?? 'shanghai-quiet-cafe', opts.onEvent)
    return
  }
  await streamFromBackend(request, opts.onEvent, opts.signal)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/planStream.test.ts`
Expected: PASS (3 tests). The bad-frame case throws because `SSEEventSchema.parse` rejects a `stage` event missing `key/label/status`.

- [ ] **Step 5: Commit**

```bash
git add src/api/planStream.ts src/api/planStream.test.ts
git commit -m "feat(frontend): SSE plan stream client (fixtures + live ReadableStream)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: History client (`api/history.ts`)

Spec §5: AccountMenu + 历史同步; backend `history/index.js` + `history/[id].js` (spec §4). Returns saved `PlanResult`-shaped records keyed by `planId`.

**Files:**
- Create: `src/api/history.ts`
- Test: `src/api/history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api/history.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { listHistory, getHistory } from './history'

afterEach(() => vi.restoreAllMocks())

describe('history client', () => {
  it('lists plans for the current identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ([{ planId: 'p1', request: '静安咖啡', createdAt: '2026-06-01T00:00:00Z' }]),
    })) as unknown as typeof fetch)
    const items = await listHistory()
    expect(items).toHaveLength(1)
    expect(items[0].planId).toBe('p1')
  })
  it('fetches one plan by id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ planId: 'p1', routes: [], request: 'x' }),
    })) as unknown as typeof fetch)
    const plan = await getHistory('p1')
    expect(plan.planId).toBe('p1')
  })
  it('throws on a failed list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch)
    await expect(listHistory()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/history.test.ts`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Implement the client**

Create `src/api/history.ts`:
```ts
import type { Route, Constraints, DataSources } from '../../contract'
import { authHeader } from './auth'

export interface HistoryListItem {
  planId: string
  request: string
  createdAt: string
}

export interface HistoryRecord {
  planId: string
  request: string
  constraints: Constraints
  routes: Route[]
  dataSources: DataSources
  createdAt: string
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { ...authHeader() } })
  if (!res.ok) throw new Error(`历史记录接口不可用 (${res.status})`)
  return (await res.json()) as T
}

export function listHistory(): Promise<HistoryListItem[]> {
  return getJson<HistoryListItem[]>('/api/history')
}

export function getHistory(id: string): Promise<HistoryRecord> {
  return getJson<HistoryRecord>(`/api/history/${encodeURIComponent(id)}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/history.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/history.ts src/api/history.test.ts
git commit -m "feat(frontend): history client (list/get saved plans)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Plan-stream reducer hook (`hooks/usePlanStream.ts`)

Each contract event drives one slice of UI state (spec §5 流式渲染). The reducer is pure and unit-tested without React; the hook wraps `streamPlan`.

**Files:**
- Create: `src/hooks/usePlanStream.ts`
- Test: `src/hooks/usePlanStream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/usePlanStream.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { planReducer, initialPlanState } from './usePlanStream'
import type { SSEEvent } from '../../contract'

const stage: SSEEvent = { type: 'stage', key: 'retrieve', label: '召回', status: 'ok', ms: 120 }
const route: SSEEvent = {
  type: 'route',
  route: {
    id: 'route-0', stops: [], totalCost: 78, totalWalkMin: 0, totalTransitMin: 0,
    endTime: 15, coverage: ['cafe'], checks: [], explanation: '', risks: [],
  },
}
const expl1: SSEEvent = { type: 'explanation', routeId: 'route-0', delta: '先到' }
const expl2: SSEEvent = { type: 'explanation', routeId: 'route-0', delta: '咖啡馆' }
const err: SSEEvent = { type: 'error', code: 'insufficient-data', message: '真实地点不足', recoverable: true }

describe('planReducer', () => {
  it('records stage progress', () => {
    const s = planReducer(initialPlanState(), stage)
    expect(s.stages.find((x) => x.key === 'retrieve')?.status).toBe('ok')
  })
  it('stores the route when it arrives', () => {
    const s = planReducer(initialPlanState(), route)
    expect(s.route?.id).toBe('route-0')
  })
  it('accumulates explanation deltas per routeId', () => {
    let s = planReducer(initialPlanState(), expl1)
    s = planReducer(s, expl2)
    expect(s.explanations['route-0']).toBe('先到咖啡馆')
  })
  it('captures a terminal error', () => {
    const s = planReducer(initialPlanState(), err)
    expect(s.error?.code).toBe('insufficient-data')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/usePlanStream.test.ts`
Expected: FAIL — cannot resolve `./usePlanStream`.

- [ ] **Step 3: Implement the reducer + hook**

Create `src/hooks/usePlanStream.ts`:
```ts
import { useCallback, useReducer, useRef } from 'react'
import type {
  SSEEvent, Constraints, ScoredPOI, Route, DataSources, PlanRequest,
} from '../../contract'
import { streamPlan, type PlanSource } from '../api/planStream'

export interface StageState {
  key: string
  label: string
  status: 'running' | 'ok' | 'skip' | 'fail'
  ms?: number
  summary?: string
}

export interface ErrorState {
  code: 'needs-clarification' | 'insufficient-data' | 'upstream-unavailable' | 'bad-request'
  message: string
  recoverable: boolean
}

export interface PlanState {
  streaming: boolean
  stages: StageState[]
  constraints: Constraints | null
  candidates: ScoredPOI[]
  route: Route | null
  explanations: Record<string, string>
  dataSources: DataSources | null
  planId: string | null
  error: ErrorState | null
}

export function initialPlanState(): PlanState {
  return {
    streaming: false,
    stages: [],
    constraints: null,
    candidates: [],
    route: null,
    explanations: {},
    dataSources: null,
    planId: null,
    error: null,
  }
}

type Action = SSEEvent | { type: 'start' } | { type: 'finish' }

export function planReducer(state: PlanState, action: Action): PlanState {
  switch (action.type) {
    case 'start':
      return { ...initialPlanState(), streaming: true }
    case 'finish':
      return { ...state, streaming: false }
    case 'stage': {
      const others = state.stages.filter((s) => s.key !== action.key)
      return {
        ...state,
        stages: [...others, {
          key: action.key, label: action.label, status: action.status,
          ms: action.ms, summary: action.summary,
        }],
      }
    }
    case 'constraints':
      return { ...state, constraints: action.constraints }
    case 'candidates':
      return { ...state, candidates: action.candidates }
    case 'route':
      return { ...state, route: action.route }
    case 'explanation':
      return {
        ...state,
        explanations: {
          ...state.explanations,
          [action.routeId]: (state.explanations[action.routeId] ?? '') + action.delta,
        },
      }
    case 'done':
      return {
        ...state,
        streaming: false,
        planId: action.planId,
        route: action.routes[0] ?? state.route,
        dataSources: action.dataSources,
      }
    case 'error':
      return {
        ...state,
        streaming: false,
        error: { code: action.code, message: action.message, recoverable: action.recoverable },
      }
    default:
      return state
  }
}

export interface RunOptions {
  source?: PlanSource
  fixture?: string
}

export function usePlanStream() {
  const [state, dispatch] = useReducer(planReducer, undefined, initialPlanState)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async (request: PlanRequest, opts: RunOptions = {}) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'start' })
    try {
      await streamPlan(request, {
        source: opts.source,
        fixture: opts.fixture,
        signal: controller.signal,
        onEvent: (event) => dispatch(event),
      })
      dispatch({ type: 'finish' })
    } catch (err) {
      dispatch({
        type: 'error',
        code: 'upstream-unavailable',
        message: err instanceof Error ? err.message : '规划失败，请稍后重试。',
        recoverable: true,
      })
    }
  }, [])

  return { state, run }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/usePlanStream.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePlanStream.ts src/hooks/usePlanStream.test.ts
git commit -m "feat(frontend): usePlanStream reducer mapping SSE events to UI state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: ProgressTrail (`stage` events → progress dots)

Spec §5: `stage`→进度点亮; replaces 调试面板 feel with a lightweight trail.

**Files:**
- Create: `src/components/ProgressTrail.tsx`
- Test: `src/components/ProgressTrail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ProgressTrail.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ProgressTrail } from './ProgressTrail'
import type { StageState } from '../hooks/usePlanStream'

const stages: StageState[] = [
  { key: 'understand', label: '读懂需求', status: 'ok', ms: 1400 },
  { key: 'retrieve', label: '召回', status: 'running' },
]

describe('ProgressTrail', () => {
  it('shows a dot per stage with its label', () => {
    const { getByText } = render(<ProgressTrail stages={stages} />)
    expect(getByText('读懂需求')).toBeInTheDocument()
    expect(getByText('召回')).toBeInTheDocument()
  })
  it('marks the running stage as active', () => {
    const { getByText } = render(<ProgressTrail stages={stages} />)
    expect(getByText('召回').closest('[data-status]')?.getAttribute('data-status')).toBe('running')
  })
  it('renders nothing when there are no stages', () => {
    const { container } = render(<ProgressTrail stages={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ProgressTrail.test.tsx`
Expected: FAIL — cannot resolve `./ProgressTrail`.

- [ ] **Step 3: Implement the component**

Create `src/components/ProgressTrail.tsx`:
```tsx
import type { StageState } from '../hooks/usePlanStream'

const STATUS_DOT: Record<StageState['status'], string> = {
  running: 'dot-cinnabar animate-pulse',
  ok: 'dot-sage',
  skip: 'bg-[var(--hairline)]',
  fail: 'bg-[var(--cinnabar)]',
}

export function ProgressTrail({ stages }: { stages: StageState[] }) {
  if (stages.length === 0) return null
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-[var(--ink-soft)]">
      {stages.map((stage) => (
        <li key={stage.key} data-status={stage.status} className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[stage.status]}`} />
          <span className="hand">{stage.label}</span>
          {typeof stage.ms === 'number' && (
            <span className="latin text-[11px] text-[var(--hairline)]">{stage.ms}ms</span>
          )}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ProgressTrail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProgressTrail.tsx src/components/ProgressTrail.test.tsx
git commit -m "feat(frontend): ProgressTrail stage dots

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: StopCard (拍立得 photo + per-field source + user actions)

Spec §5: 门店真实照片拍立得样式; StopCard 只留用户动作(导航/订座/电话/收藏); 每字段标来源(`高德`/`估算`); no "排队风险" card.

**Files:**
- Create: `src/components/StopCard.tsx`
- Test: `src/components/StopCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/StopCard.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StopCard } from './StopCard'
import type { RouteStop } from '../../contract'

const stop: RouteStop = {
  poi: {
    id: 'B0LBRRKLFC', name: '看得到风景的咖啡馆', category: 'cafe', city: '上海', area: '静安寺',
    lat: 31.224, lng: 121.443, rating: 4.5, perCapita: 78, tags: ['安静'],
    openHour: 9, closeHour: 20, photos: ['https://example.com/a.jpg'], tel: '021-0000', source: 'amap',
  },
  arrive: 14, depart: 15, legFromPrev: null,
  reasons: ['命中你的需求：安静'],
  sources: { rating: 'amap', perCapita: 'amap', sceneTags: 'derived' },
}

describe('StopCard', () => {
  it('renders the real store name and rating', () => {
    const { getByText } = render(<StopCard index={0} stop={stop} explanation="" />)
    expect(getByText('看得到风景的咖啡馆')).toBeInTheDocument()
    expect(getByText('4.5')).toBeInTheDocument()
  })
  it('renders a polaroid photo when amap returns one', () => {
    const { container } = render(<StopCard index={0} stop={stop} explanation="" />)
    expect(container.querySelector('.polaroid img')).not.toBeNull()
  })
  it('labels each field source as 高德 or 估算', () => {
    const { getByText, queryByText } = render(<StopCard index={0} stop={stop} explanation="" />)
    expect(getByText('场景标签 · 估算')).toBeInTheDocument()
    expect(getByText('人均 · 高德')).toBeInTheDocument()
    expect(queryByText(/排队/)).toBeNull()
  })
  it('shows user-action buttons and streamed explanation', () => {
    const { getByLabelText, getByText } = render(
      <StopCard index={0} stop={stop} explanation="先到靠窗坐下" />,
    )
    expect(getByLabelText('导航')).toBeInTheDocument()
    expect(getByLabelText('拨打电话')).toBeInTheDocument()
    expect(getByText('先到靠窗坐下')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/StopCard.test.tsx`
Expected: FAIL — cannot resolve `./StopCard`.

- [ ] **Step 3: Implement the component**

Create `src/components/StopCard.tsx`:
```tsx
import type { RouteStop, FieldSource } from '../../contract'
import { CategoryIcon, ActionIcons, MetaIcons } from '../design/icons'

const SOURCE_LABEL: Record<FieldSource, string> = {
  amap: '高德',
  user: '你的输入',
  derived: '估算',
}

function fmtHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh}:${String(mm).padStart(2, '0')}`
}

function SourceTag({ label, source }: { label: string; source?: FieldSource }) {
  if (!source) return null
  return (
    <span className="rounded-full border border-[var(--hairline)] px-1.5 py-0.5 text-[10px] text-[var(--ink-soft)]">
      {label} · {SOURCE_LABEL[source]}
    </span>
  )
}

const DOT_BY_INDEX = ['dot-ink', 'dot-cinnabar', 'dot-sage']

export function StopCard({ index, stop, explanation }: {
  index: number
  stop: RouteStop
  explanation: string
}) {
  const { poi, sources } = stop
  const photo = poi.photos[0]
  const { navigate: Nav, book: Book, call: Call, save: Save } = ActionIcons
  const { walk: Walk } = MetaIcons
  return (
    <article className="paper-card relative p-3 sm:p-4">
      <span className={`absolute -left-2 top-4 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold text-white ${DOT_BY_INDEX[index % 3]}`}>
        <span className="latin">{index + 1}</span>
      </span>
      <div className="flex gap-3 pl-3">
        {photo && (
          <div className="polaroid h-24 w-24 shrink-0">
            <span className="tape -top-2 left-6" />
            <img src={photo} alt={poi.name} loading="lazy" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <CategoryIcon category={poi.category} size={16} />
            <h3 className="hand truncate text-[16px]">{poi.name}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-soft)]">
            <span className="latin">{fmtHour(stop.arrive)}–{fmtHour(stop.depart)}</span>
            {poi.rating != null && <span className="latin">{poi.rating}</span>}
            {poi.perCapita != null && <span className="latin">¥{poi.perCapita}</span>}
            {stop.legFromPrev && (
              <span className="inline-flex items-center gap-1">
                <Walk size={13} strokeWidth={1.7} aria-hidden />
                <span className="latin">{stop.legFromPrev.minutes}min</span>
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {poi.rating != null && <SourceTag label="评分" source={sources.rating} />}
            {poi.perCapita != null && <SourceTag label="人均" source={sources.perCapita} />}
            <SourceTag label="场景标签" source={sources.sceneTags} />
          </div>
          {explanation && (
            <p className="mt-2 text-[13px] leading-6 text-[var(--ink)]">{explanation}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-3">
        <a
          aria-label="导航"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]"
          href={`https://uri.amap.com/marker?position=${poi.lng},${poi.lat}&name=${encodeURIComponent(poi.name)}`}
          target="_blank" rel="noreferrer"
        >
          <Nav size={14} strokeWidth={1.7} aria-hidden /> 导航
        </a>
        <button type="button" aria-label="订座" className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]">
          <Book size={14} strokeWidth={1.7} aria-hidden /> 订座
        </button>
        {poi.tel && (
          <a aria-label="拨打电话" className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]" href={`tel:${poi.tel}`}>
            <Call size={14} strokeWidth={1.7} aria-hidden /> 电话
          </a>
        )}
        <button type="button" aria-label="收藏" className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]">
          <Save size={14} strokeWidth={1.7} aria-hidden /> 收藏
        </button>
      </div>
    </article>
  )
}
```

Note: `FieldSource` is exported from `contract/types.ts` (Plan 0 Task 2). If your Plan 0 barrel does not re-export it, add `export type { FieldSource } from './types'` to `contract/index.ts` on `main` and sync both worktrees before continuing — do not redefine it here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/StopCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/StopCard.tsx src/components/StopCard.test.tsx
git commit -m "feat(frontend): StopCard polaroid photo + per-field source + actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Itinerary (timeline of StopCards driven by route + explanations)

Spec §5: `route`→出时间轴; `explanation`→每张卡推荐理由打字式补入. Itinerary distributes the per-route explanation text across stops by index sentence-split, falling back to the route's reasons.

**Files:**
- Create: `src/components/Itinerary.tsx`
- Test: `src/components/Itinerary.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/Itinerary.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Itinerary } from './Itinerary'
import type { Route } from '../../contract'

function poi(id: string, name: string) {
  return {
    id, name, category: 'cafe' as const, city: '上海', area: '静安寺', lat: 31.2, lng: 121.4,
    rating: 4.5, perCapita: 78, tags: ['安静'], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' as const,
  }
}
const route: Route = {
  id: 'route-0',
  stops: [
    { poi: poi('a', '咖啡馆'), arrive: 14, depart: 15, legFromPrev: null, reasons: ['安静'], sources: {} },
    { poi: poi('b', '本帮菜'), arrive: 18, depart: 19, legFromPrev: { distM: 500, minutes: 8, mode: 'walk' }, reasons: ['本帮菜'], sources: {} },
  ],
  totalCost: 215, totalWalkMin: 8, totalTransitMin: 0, endTime: 19, coverage: ['cafe', 'dining'],
  checks: [], explanation: '', risks: [],
}

describe('Itinerary', () => {
  it('renders one StopCard per stop', () => {
    const { getByText } = render(<Itinerary route={route} explanation="" />)
    expect(getByText('咖啡馆')).toBeInTheDocument()
    expect(getByText('本帮菜')).toBeInTheDocument()
  })
  it('renders nothing when route has no stops', () => {
    const empty = { ...route, stops: [] }
    const { container } = render(<Itinerary route={empty} explanation="" />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Itinerary.test.tsx`
Expected: FAIL — cannot resolve `./Itinerary`.

- [ ] **Step 3: Implement the component**

Create `src/components/Itinerary.tsx`:
```tsx
import type { Route } from '../../contract'
import { StopCard } from './StopCard'

/** Split the streamed per-route explanation into one chunk per stop. */
function explanationForStop(explanation: string, index: number, count: number, fallback: string): string {
  if (!explanation) return fallback
  const parts = explanation.split(/(?<=[。！？])/).filter(Boolean)
  if (parts.length <= 1) return index === 0 ? explanation : fallback
  const per = Math.ceil(parts.length / count)
  const slice = parts.slice(index * per, (index + 1) * per).join('')
  return slice || fallback
}

export function Itinerary({ route, explanation }: { route: Route; explanation: string }) {
  if (route.stops.length === 0) return null
  return (
    <div className="space-y-3">
      {route.stops.map((stop, index) => (
        <StopCard
          key={`${stop.poi.id}-${index}`}
          index={index}
          stop={stop}
          explanation={explanationForStop(explanation, index, route.stops.length, stop.reasons[0] ?? '')}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Itinerary.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Itinerary.tsx src/components/Itinerary.test.tsx
git commit -m "feat(frontend): Itinerary distributes streamed explanation across stops

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: PlanSummary (route cover with 印章 stamp)

Spec §5: 结果优先 + RouteCover 印章; budget/walk summary; 朱砂 stamp tone from checks.

**Files:**
- Create: `src/components/PlanSummary.tsx`
- Test: `src/components/PlanSummary.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/PlanSummary.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanSummary } from './PlanSummary'
import type { Route, Constraints } from '../../contract'

const constraints: Constraints = {
  city: '上海', district: '静安寺', startTime: 14, durationMin: 330, party: 2,
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['dining'], pace: 'normal', personaId: 'couple', raw: 'x',
}
const route: Route = {
  id: 'route-0', stops: [], totalCost: 215, totalWalkMin: 12, totalTransitMin: 0,
  endTime: 19, coverage: ['cafe', 'dining'],
  checks: [{ key: 'budget', label: '预算', status: 'pass', detail: '人均合计 ¥215' }],
  explanation: '', risks: [],
}

describe('PlanSummary', () => {
  it('shows city, party and total cost', () => {
    const { getByText } = render(<PlanSummary route={route} constraints={constraints} />)
    expect(getByText(/上海/)).toBeInTheDocument()
    expect(getByText(/215/)).toBeInTheDocument()
  })
  it('stamps 拿来就走 when no check failed', () => {
    const { getByText } = render(<PlanSummary route={route} constraints={constraints} />)
    expect(getByText('拿来就走')).toBeInTheDocument()
  })
  it('stamps 需调整 when a check failed', () => {
    const bad = { ...route, checks: [{ key: 'budget', label: '预算', status: 'fail' as const, detail: '超支' }] }
    const { getByText } = render(<PlanSummary route={bad} constraints={constraints} />)
    expect(getByText('需调整')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PlanSummary.test.tsx`
Expected: FAIL — cannot resolve `./PlanSummary`.

- [ ] **Step 3: Implement the component**

Create `src/components/PlanSummary.tsx`:
```tsx
import type { Route, Constraints } from '../../contract'
import { MetaIcons } from '../design/icons'

function stampFor(route: Route): '拿来就走' | '建议调整' | '需调整' {
  if (route.checks.some((c) => c.status === 'fail')) return '需调整'
  if (route.checks.some((c) => c.status === 'warn')) return '建议调整'
  return '拿来就走'
}

export function PlanSummary({ route, constraints }: { route: Route; constraints: Constraints }) {
  const { wallet: Wallet, walk: Walk, pin: Pin } = MetaIcons
  const where = [constraints.city, constraints.district].filter(Boolean).join(' · ')
  return (
    <header className="paper-card relative flex items-center justify-between gap-3 p-4">
      <div>
        <div className="flex items-center gap-1.5 text-[13px] text-[var(--ink-soft)]">
          <Pin size={14} strokeWidth={1.7} aria-hidden />
          <span className="hand">{where}</span>
          <span className="latin">· {constraints.party}人</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="inline-flex items-center gap-1">
            <Wallet size={14} strokeWidth={1.7} aria-hidden />
            人均 <span className="latin">¥{route.totalCost}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Walk size={14} strokeWidth={1.7} aria-hidden />
            步行 <span className="latin">{route.totalWalkMin}min</span>
          </span>
        </div>
      </div>
      <span className="stamp text-[14px]">{stampFor(route)}</span>
    </header>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PlanSummary.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/PlanSummary.tsx src/components/PlanSummary.test.tsx
git commit -m "feat(frontend): PlanSummary route cover with 朱砂 stamp

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: WhyDrawer (collapses trace / constraints / checks / dataSources)

Spec §5: agent trace/约束/数据来源/修复记录全收进 WhyDrawer — keep the result-first surface clean.

**Files:**
- Create: `src/components/WhyDrawer.tsx`
- Test: `src/components/WhyDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/WhyDrawer.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhyDrawer } from './WhyDrawer'
import type { Route, Constraints, DataSources } from '../../contract'

const constraints: Constraints = {
  city: '上海', district: '静安寺', startTime: 14, durationMin: 330, party: 2,
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['dining'], pace: 'normal', personaId: 'couple', raw: 'x',
}
const route: Route = {
  id: 'route-0', stops: [], totalCost: 215, totalWalkMin: 0, totalTransitMin: 0, endTime: 19,
  coverage: ['cafe'], checks: [{ key: 'budget', label: '预算', status: 'pass', detail: '人均 ¥215' }],
  explanation: '', risks: [],
}
const dataSources: DataSources = {
  amapPoi: { configured: true, used: true, status: 'ok' },
  amapRoute: { configured: true, used: true, status: 'ok' },
  deepseek: { configured: true, used: true, status: 'ok' },
  cache: { hits: 1, misses: 2 },
}

describe('WhyDrawer', () => {
  it('is collapsed by default and expands on click', async () => {
    const { getByRole, queryByText, getByText } = render(
      <WhyDrawer route={route} constraints={constraints} dataSources={dataSources} />,
    )
    expect(queryByText('人均 ¥215')).toBeNull()
    await userEvent.click(getByRole('button', { name: /规划依据/ }))
    expect(getByText('人均 ¥215')).toBeInTheDocument()
    expect(getByText(/缓存命中/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WhyDrawer.test.tsx`
Expected: FAIL — cannot resolve `./WhyDrawer`.

- [ ] **Step 3: Implement the component**

Create `src/components/WhyDrawer.tsx`:
```tsx
import { useState } from 'react'
import type { Route, Constraints, DataSources, Check } from '../../contract'

const CHECK_TONE: Record<Check['status'], string> = {
  pass: 'text-[var(--sage)]',
  warn: 'text-[var(--amber)]',
  fail: 'text-[var(--cinnabar)]',
}

export function WhyDrawer({ route, constraints, dataSources }: {
  route: Route
  constraints: Constraints
  dataSources: DataSources | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="paper-card p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hand flex w-full items-center justify-between text-[13px]"
      >
        <span>规划依据 · 数据来源</span>
        <span className="latin text-[var(--ink-soft)]">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-[12px] leading-6 text-[var(--ink-soft)]">
          <div>
            <p className="hand text-[var(--ink)]">约束</p>
            <p>
              {constraints.city}{constraints.district ? ` · ${constraints.district}` : ''} ·{' '}
              {constraints.party}人 · 偏好 {constraints.prefs.join('、') || '无'}
            </p>
          </div>
          <div>
            <p className="hand text-[var(--ink)]">体检</p>
            <ul className="space-y-1">
              {route.checks.map((c) => (
                <li key={c.key} className={CHECK_TONE[c.status]}>
                  {c.label}：{c.detail}
                </li>
              ))}
            </ul>
          </div>
          {dataSources && (
            <div>
              <p className="hand text-[var(--ink)]">数据来源</p>
              <p>
                高德 POI {dataSources.amapPoi.status} · 路径 {dataSources.amapRoute.status} ·
                DeepSeek {dataSources.deepseek.status}
              </p>
              <p>缓存命中 {dataSources.cache.hits} · 穿透 {dataSources.cache.misses}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WhyDrawer.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/WhyDrawer.tsx src/components/WhyDrawer.test.tsx
git commit -m "feat(frontend): WhyDrawer collapsing trace/constraints/checks/sources

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: EmptyState (honest empty states for error codes)

Spec §1/§3/§5: 诚实空态 replacing fake routes; map error codes to guidance. `needs-clarification` offers a city retry callback.

**Files:**
- Create: `src/components/EmptyState.tsx`
- Test: `src/components/EmptyState.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/EmptyState.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the clarification copy and fires retry with the typed city', async () => {
    const onClarify = vi.fn()
    const { getByText, getByPlaceholderText, getByRole } = render(
      <EmptyState error={{ code: 'needs-clarification', message: '需要补充城市', recoverable: true }} onClarifyCity={onClarify} />,
    )
    expect(getByText('需要补充城市')).toBeInTheDocument()
    await userEvent.type(getByPlaceholderText('补充城市，例如：上海'), '上海')
    await userEvent.click(getByRole('button', { name: '用这个城市重试' }))
    expect(onClarify).toHaveBeenCalledWith('上海')
  })
  it('renders insufficient-data without inventing a route', () => {
    const { getByText, queryByText } = render(
      <EmptyState error={{ code: 'insufficient-data', message: '真实地点不足', recoverable: true }} onClarifyCity={() => {}} />,
    )
    expect(getByText('真实地点不足')).toBeInTheDocument()
    expect(queryByText(/示例路线|默认/)).toBeNull()
  })
  it('renders upstream-unavailable guidance', () => {
    const { getByText } = render(
      <EmptyState error={{ code: 'upstream-unavailable', message: '高德暂不可用', recoverable: true }} onClarifyCity={() => {}} />,
    )
    expect(getByText('高德暂不可用')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/EmptyState.test.tsx`
Expected: FAIL — cannot resolve `./EmptyState`.

- [ ] **Step 3: Implement the component**

Create `src/components/EmptyState.tsx`:
```tsx
import { useState } from 'react'
import type { ErrorState } from '../hooks/usePlanStream'

const TITLE: Record<ErrorState['code'], string> = {
  'needs-clarification': '再说清楚一点',
  'insufficient-data': '这里真实可去的地方不够',
  'upstream-unavailable': '数据源暂时联系不上',
  'bad-request': '这条需求我没读懂',
}

export function EmptyState({ error, onClarifyCity }: {
  error: ErrorState
  onClarifyCity: (city: string) => void
}) {
  const [city, setCity] = useState('')
  return (
    <div className="paper-card mx-auto max-w-md p-6 text-center">
      <h2 className="hand text-[18px] text-[var(--ink)]">{TITLE[error.code]}</h2>
      <p className="mt-2 text-[13px] leading-6 text-[var(--ink-soft)]">{error.message}</p>
      {error.code === 'needs-clarification' && (
        <div className="mt-4 flex items-center gap-2">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="补充城市，例如：上海"
            className="flex-1 rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none"
          />
          <button
            type="button"
            onClick={() => city.trim() && onClarifyCity(city.trim())}
            className="rounded-md bg-[var(--ink)] px-3 py-2 text-[13px] text-white"
          >
            用这个城市重试
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/EmptyState.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/EmptyState.tsx src/components/EmptyState.test.tsx
git commit -m "feat(frontend): EmptyState honest error states (no fake routes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: InputBar (structured prompt + example + persona/pref chips)

Spec §5: InputBar 结构化提示 + 一键示例 + 画像/偏好 chips. Emits a `PlanRequest.preferences`-shaped payload plus the raw request text.

**Files:**
- Create: `src/components/InputBar.tsx`
- Test: `src/components/InputBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/InputBar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputBar } from './InputBar'

describe('InputBar', () => {
  it('submits the typed request with default preferences', async () => {
    const onSubmit = vi.fn()
    const { getByPlaceholderText, getByRole } = render(<InputBar onSubmit={onSubmit} busy={false} />)
    await userEvent.type(getByPlaceholderText(/静安/), '静安找个安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(onSubmit).toHaveBeenCalledWith({
      request: '静安找个安静咖啡',
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
    })
  })
  it('toggles a preference chip into the payload', async () => {
    const onSubmit = vi.fn()
    const { getByText, getByPlaceholderText, getByRole } = render(<InputBar onSubmit={onSubmit} busy={false} />)
    await userEvent.type(getByPlaceholderText(/静安/), 'x')
    await userEvent.click(getByText('安静'))
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(onSubmit.mock.calls[0][0].preferences.prefs).toContain('quiet')
  })
  it('fills the textarea from the example button', async () => {
    const onSubmit = vi.fn()
    const { getByText, getByPlaceholderText } = render(<InputBar onSubmit={onSubmit} busy={false} />)
    await userEvent.click(getByText('用示例'))
    expect((getByPlaceholderText(/静安/) as HTMLTextAreaElement).value.length).toBeGreaterThan(0)
  })
  it('disables submit while busy', () => {
    const { getByRole } = render(<InputBar onSubmit={() => {}} busy />)
    expect(getByRole('button', { name: /生成路线|生成中/ })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/InputBar.test.tsx`
Expected: FAIL — cannot resolve `./InputBar`.

- [ ] **Step 3: Implement the component**

Create `src/components/InputBar.tsx`:
```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { PlanRequest } from '../../contract'
import { ActionIcons } from '../design/icons'

export type InputSubmit = {
  request: string
  preferences: PlanRequest['preferences']
}

const PERSONAS: { id: PlanRequest['preferences']['personaPick']; label: string }[] = [
  { id: 'auto', label: '自动识别' },
  { id: 'couple', label: '情侣' },
  { id: 'family', label: '亲子' },
  { id: 'friends', label: '朋友' },
  { id: 'solo', label: '一个人' },
]

const PREF_CHIPS: { key: string; label: string }[] = [
  { key: 'quiet', label: '安静' },
  { key: 'budget', label: '省钱' },
  { key: 'photo', label: '出片' },
  { key: 'local', label: '本地烟火' },
]

const EXAMPLE = '周末下午在静安找个安静咖啡，再吃顿本帮菜，人均300内'

export function InputBar({ onSubmit, busy }: { onSubmit: (v: InputSubmit) => void; busy: boolean }) {
  const [text, setText] = useState('')
  const [persona, setPersona] = useState<PlanRequest['preferences']['personaPick']>('auto')
  const [prefs, setPrefs] = useState<string[]>([])

  const togglePref = (key: string) =>
    setPrefs((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const request = text.trim()
    if (!request || busy) return
    onSubmit({ request, preferences: { personaPick: persona, prefs, budgetPref: null } })
  }

  return (
    <form onSubmit={submit} className="paper-card space-y-3 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="周末下午在静安找个安静咖啡，再吃顿本帮菜，人均300内"
        className="w-full resize-none rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] p-3 text-[15px] leading-7 outline-none"
      />
      <div className="flex flex-wrap gap-1.5">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPersona(p.id)}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${persona === p.id ? 'border-[var(--cinnabar)] text-[var(--cinnabar)]' : 'border-[var(--hairline)] text-[var(--ink-soft)]'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PREF_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => togglePref(c.key)}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${prefs.includes(c.key) ? 'border-[var(--sage)] text-[var(--sage)]' : 'border-[var(--hairline)] text-[var(--ink-soft)]'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setText(EXAMPLE)}
          className="rounded-md border border-[var(--hairline)] px-3 py-2 text-[13px] text-[var(--ink-soft)]"
        >
          用示例
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--ink)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60"
        >
          <ActionIcons.navigate size={15} strokeWidth={1.8} aria-hidden />
          {busy ? '生成中' : '生成路线'}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/InputBar.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/InputBar.tsx src/components/InputBar.test.tsx
git commit -m "feat(frontend): InputBar structured prompt + persona/pref chips + example

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: AmapProvider (load 高德 JS SDK with dedicated JS key + security code)

Spec §5: 单独 JS API key (Web 端) + 安全密钥 + 域名白名单, separate from backend key. Loads the SDK once and exposes it via context; renders a configuration EmptyState if the key is missing (no fake map).

**Files:**
- Create: `src/map/AmapProvider.tsx`
- Test: `src/map/AmapProvider.test.tsx`
- Modify: `src/vite-env.d.ts` (typed env vars) — create if absent

- [ ] **Step 1: Declare the env var types**

Create `src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLAN_SOURCE?: 'live' | 'fixtures'
  readonly VITE_AMAP_JS_KEY?: string
  readonly VITE_AMAP_SECURITY_CODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  _AMapSecurityConfig?: { securityJsCode: string }
  AMap?: unknown
}
```

- [ ] **Step 2: Write the failing test**

Create `src/map/AmapProvider.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AmapProvider, useAmap } from './AmapProvider'

function Probe() {
  const { status } = useAmap()
  return <span>status:{status}</span>
}

afterEach(() => {
  vi.unstubAllEnvs()
  document.head.innerHTML = ''
})

describe('AmapProvider', () => {
  it('reports missing-key when no JS key is configured', async () => {
    vi.stubEnv('VITE_AMAP_JS_KEY', '')
    const { getByText } = render(<AmapProvider><Probe /></AmapProvider>)
    await waitFor(() => expect(getByText('status:missing-key')).toBeInTheDocument())
  })
  it('injects the loader script and sets the security code when a key exists', async () => {
    vi.stubEnv('VITE_AMAP_JS_KEY', 'js-key-123')
    vi.stubEnv('VITE_AMAP_SECURITY_CODE', 'sec-456')
    render(<AmapProvider><Probe /></AmapProvider>)
    await waitFor(() => {
      const script = document.querySelector('script[src*="webapi.amap.com/maps"]')
      expect(script).not.toBeNull()
    })
    expect(window._AMapSecurityConfig?.securityJsCode).toBe('sec-456')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/map/AmapProvider.test.tsx`
Expected: FAIL — cannot resolve `./AmapProvider`.

- [ ] **Step 4: Implement the provider**

Create `src/map/AmapProvider.tsx`:
```tsx
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type AmapStatus = 'loading' | 'ready' | 'missing-key' | 'error'

interface AmapContextValue {
  status: AmapStatus
  AMap: unknown
}

const AmapContext = createContext<AmapContextValue>({ status: 'loading', AMap: null })

export function useAmap(): AmapContextValue {
  return useContext(AmapContext)
}

const SCRIPT_ID = 'amap-js-sdk'

export function AmapProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AmapStatus>('loading')
  const [AMap, setAMap] = useState<unknown>(null)

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_JS_KEY
    if (!key) {
      setStatus('missing-key')
      return
    }
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE
    if (securityCode) {
      window._AMapSecurityConfig = { securityJsCode: securityCode }
    }
    if (window.AMap) {
      setAMap(window.AMap)
      setStatus('ready')
      return
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = SCRIPT_ID
      script.async = true
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`
      document.head.appendChild(script)
    }
    const onLoad = () => {
      if (window.AMap) {
        setAMap(window.AMap)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    }
    const onError = () => setStatus('error')
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    return () => {
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }
  }, [])

  return <AmapContext.Provider value={{ status, AMap }}>{children}</AmapContext.Provider>
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/map/AmapProvider.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/map/AmapProvider.tsx src/map/AmapProvider.test.tsx src/vite-env.d.ts
git commit -m "feat(frontend): AmapProvider loads JS SDK with dedicated key + security code

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: RouteMap (polyline + numbered markers + candidate dots)

Spec §5: 地图主视图 — 路线 polyline + 编号 marker; `candidates`→地图撒点. The map-drawing effect is guarded so it no-ops without a ready SDK; the test asserts the honest fallback when the SDK is not configured.

**Files:**
- Create: `src/map/RouteMap.tsx`
- Test: `src/map/RouteMap.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/map/RouteMap.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { RouteMap } from './RouteMap'
import type { Route, ScoredPOI } from '../../contract'

vi.mock('./AmapProvider', () => ({
  useAmap: () => ({ status: 'missing-key', AMap: null }),
}))

afterEach(() => vi.restoreAllMocks())

const route: Route = {
  id: 'route-0',
  stops: [{
    poi: { id: 'a', name: '咖啡馆', category: 'cafe', city: '上海', area: '静安寺', lat: 31.22, lng: 121.44,
      rating: 4.5, perCapita: 78, tags: [], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' },
    arrive: 14, depart: 15, legFromPrev: null, reasons: [], sources: {},
  }],
  totalCost: 78, totalWalkMin: 0, totalTransitMin: 0, endTime: 15, coverage: ['cafe'], checks: [], explanation: '', risks: [],
}
const candidates: ScoredPOI[] = []

describe('RouteMap', () => {
  it('shows a configuration notice when the JS key is missing (no fake tiles)', () => {
    const { getByText } = render(<RouteMap route={route} candidates={candidates} />)
    expect(getByText(/地图未配置/)).toBeInTheDocument()
  })
  it('always renders the map container element', () => {
    const { container } = render(<RouteMap route={route} candidates={candidates} />)
    expect(container.querySelector('[data-amap-container]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/map/RouteMap.test.tsx`
Expected: FAIL — cannot resolve `./RouteMap`.

- [ ] **Step 3: Implement the component**

Create `src/map/RouteMap.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import type { Route, ScoredPOI } from '../../contract'
import { useAmap } from './AmapProvider'

const MARKER_COLORS = ['#241f17', '#bb3a2c', '#5e7757']

/** Minimal shape of the AMap global we use; kept local to avoid an SDK type dep. */
interface AMapNS {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => {
    add: (overlay: unknown) => void
    setFitView: () => void
    destroy: () => void
  }
  Marker: new (opts: Record<string, unknown>) => unknown
  Polyline: new (opts: Record<string, unknown>) => unknown
  CircleMarker: new (opts: Record<string, unknown>) => unknown
}

export function RouteMap({ route, candidates }: { route: Route; candidates: ScoredPOI[] }) {
  const { status, AMap } = useAmap()
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (status !== 'ready' || !AMap || !elRef.current) return
    const ns = AMap as AMapNS
    const map = new ns.Map(elRef.current, { zoom: 13, viewMode: '2D' })

    for (const candidate of candidates) {
      map.add(new ns.CircleMarker({
        center: [candidate.poi.lng, candidate.poi.lat],
        radius: 5,
        fillColor: '#bd7c22',
        fillOpacity: 0.5,
        strokeWeight: 0,
      }))
    }

    const path: [number, number][] = route.stops.map((s) => [s.poi.lng, s.poi.lat])
    route.stops.forEach((stop, i) => {
      map.add(new ns.Marker({
        position: [stop.poi.lng, stop.poi.lat],
        content: `<span style="display:inline-flex;width:22px;height:22px;border-radius:50%;background:${MARKER_COLORS[i % 3]};color:#fff;align-items:center;justify-content:center;font-size:12px;">${i + 1}</span>`,
        offset: [-11, -11],
      }))
    })
    if (path.length > 1) {
      map.add(new ns.Polyline({ path, strokeColor: '#bb3a2c', strokeWeight: 4, strokeOpacity: 0.85 }))
    }
    map.setFitView()
    return () => map.destroy()
  }, [status, AMap, route, candidates])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <div data-amap-container ref={elRef} className="h-full w-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-base)] text-center text-[13px] text-[var(--ink-soft)]">
          {status === 'missing-key'
            ? '地图未配置:缺少高德 JS API key,请在 .env.local 设置 VITE_AMAP_JS_KEY。'
            : status === 'error'
              ? '地图加载失败,请检查 JS key 域名白名单与安全密钥。'
              : '地图加载中…'}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/map/RouteMap.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/map/RouteMap.tsx src/map/RouteMap.test.tsx
git commit -m "feat(frontend): RouteMap polyline + numbered markers + candidate dots

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: AccountMenu (identity + logout + history entry)

Spec §5: AccountMenu + 历史同步, fixing "账户形同虚设".

**Files:**
- Create: `src/components/AccountMenu.tsx`
- Test: `src/components/AccountMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/AccountMenu.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountMenu } from './AccountMenu'

describe('AccountMenu', () => {
  it('shows the identity name and fires logout', async () => {
    const onLogout = vi.fn()
    const { getByText, getByRole } = render(
      <AccountMenu identity={{ token: 't', kind: 'user', name: 'ada' }} onLogout={onLogout} onOpenHistory={() => {}} />,
    )
    expect(getByText('ada')).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: '退出登录' }))
    expect(onLogout).toHaveBeenCalled()
  })
  it('labels a guest identity', () => {
    const { getByText } = render(
      <AccountMenu identity={{ token: 'd', kind: 'guest', name: '访客' }} onLogout={() => {}} onOpenHistory={() => {}} />,
    )
    expect(getByText('访客')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/AccountMenu.test.tsx`
Expected: FAIL — cannot resolve `./AccountMenu`.

- [ ] **Step 3: Implement the component**

Create `src/components/AccountMenu.tsx`:
```tsx
import type { Identity } from '../api/auth'
import { History, LogOut, UserRound } from 'lucide-react'

export function AccountMenu({ identity, onLogout, onOpenHistory }: {
  identity: Identity
  onLogout: () => void
  onOpenHistory: () => void
}) {
  return (
    <div className="paper-card flex items-center gap-2 px-2.5 py-1.5">
      <UserRound size={16} strokeWidth={1.7} aria-hidden />
      <span className="hand text-[13px]">{identity.name || (identity.kind === 'guest' ? '访客' : '我')}</span>
      <button
        type="button"
        onClick={onOpenHistory}
        aria-label="历史记录"
        className="rounded p-1 text-[var(--ink-soft)] hover:text-[var(--ink)]"
      >
        <History size={15} strokeWidth={1.7} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onLogout}
        aria-label="退出登录"
        className="rounded p-1 text-[var(--ink-soft)] hover:text-[var(--cinnabar)]"
      >
        <LogOut size={15} strokeWidth={1.7} aria-hidden />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/AccountMenu.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/AccountMenu.tsx src/components/AccountMenu.test.tsx
git commit -m "feat(frontend): AccountMenu identity + logout + history entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: LoginView (`/login` — 硬门槛 + 访客入口 + 翻开手帐仪式感)

Spec §5: 用户名/密码登入、注册、「访客继续」三个入口; v2 手帐美学.

**Files:**
- Create: `src/views/LoginView.tsx`
- Test: `src/views/LoginView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/views/LoginView.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginView } from './LoginView'
import * as auth from '../api/auth'

afterEach(() => vi.restoreAllMocks())

describe('LoginView', () => {
  it('logs in and calls onAuthed with the identity', async () => {
    const id = { token: 't', kind: 'user' as const, name: 'ada' }
    vi.spyOn(auth, 'login').mockResolvedValue(id)
    const onAuthed = vi.fn()
    const { getByPlaceholderText, getByRole } = render(<LoginView onAuthed={onAuthed} />)
    await userEvent.type(getByPlaceholderText('用户名'), 'ada')
    await userEvent.type(getByPlaceholderText('密码'), 'pw')
    await userEvent.click(getByRole('button', { name: '登入手帐' }))
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(id))
  })
  it('continues as guest', async () => {
    const id = { token: 'd', kind: 'guest' as const, name: '访客' }
    vi.spyOn(auth, 'guest').mockResolvedValue(id)
    const onAuthed = vi.fn()
    const { getByRole } = render(<LoginView onAuthed={onAuthed} />)
    await userEvent.click(getByRole('button', { name: '访客继续' }))
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(id))
  })
  it('shows the brand and a login error', async () => {
    vi.spyOn(auth, 'login').mockRejectedValue(new Error('用户名或密码错误'))
    const { getByText, getByPlaceholderText, getByRole } = render(<LoginView onAuthed={() => {}} />)
    expect(getByText('漫游·手帐')).toBeInTheDocument()
    await userEvent.type(getByPlaceholderText('用户名'), 'ada')
    await userEvent.type(getByPlaceholderText('密码'), 'bad')
    await userEvent.click(getByRole('button', { name: '登入手帐' }))
    await waitFor(() => expect(getByText('用户名或密码错误')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/LoginView.test.tsx`
Expected: FAIL — cannot resolve `./LoginView`.

- [ ] **Step 3: Implement the view**

Create `src/views/LoginView.tsx`:
```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { login, register, guest, type Identity } from '../api/auth'
import { BrandStamp } from '../design/icons'

type Mode = 'login' | 'register'

export function LoginView({ onAuthed }: { onAuthed: (identity: Identity) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const action = mode === 'login' ? login : register
      onAuthed(await action(username.trim(), password))
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失败,请重试。')
    } finally {
      setBusy(false)
    }
  }

  const continueAsGuest = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      onAuthed(await guest())
    } catch (err) {
      setError(err instanceof Error ? err.message : '访客进入失败,请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="paper-surface flex min-h-screen items-center justify-center p-4">
      <div className="paper-card relative w-full max-w-sm p-6">
        <span className="tape -top-3 left-10" />
        <div className="mb-1 flex justify-center"><BrandStamp /></div>
        <p className="latin mb-5 text-center text-[13px] text-[var(--ink-soft)]">Stroll · Shanghai</p>
        <h1 className="hand mb-4 text-center text-[18px]">翻开手帐第一页</h1>

        <form onSubmit={submit} className="space-y-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            autoComplete="username"
            className="w-full rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="密码"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none"
          />
          {error && <p className="text-[12px] text-[var(--cinnabar)]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-[var(--ink)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60"
          >
            {mode === 'login' ? '登入手帐' : '注册并登入'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-[12px] text-[var(--ink-soft)]">
          <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? '没有账号?去注册' : '已有账号?去登入'}
          </button>
          <button type="button" onClick={continueAsGuest} className="text-[var(--cinnabar)]">
            访客继续
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/LoginView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/LoginView.tsx src/views/LoginView.test.tsx
git commit -m "feat(frontend): LoginView hard gate + register + guest entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: PlannerView (`/app` — map-primary layout wiring the stream)

Spec §5: 桌面左地图 + 右时间轴;移动地图顶 + bottom sheet;顶部常驻输入 + 进度条. Wires `usePlanStream`, `InputBar`, `ProgressTrail`, `RouteMap`, `PlanSummary`, `Itinerary`, `WhyDrawer`, `EmptyState`, `AccountMenu`.

**Files:**
- Create: `src/views/PlannerView.tsx`
- Test: `src/views/PlannerView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/views/PlannerView.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerView } from './PlannerView'

vi.mock('../map/AmapProvider', () => ({
  AmapProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAmap: () => ({ status: 'missing-key', AMap: null }),
}))

afterEach(() => vi.restoreAllMocks())

const identity = { token: 't', kind: 'guest' as const, name: '访客' }

describe('PlannerView', () => {
  it('streams the happy-path fixture into a rendered itinerary', async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(await findByText('看得到风景的咖啡馆')).toBeInTheDocument()
  })

  it('renders the honest empty state from the clarification fixture', async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} fixtureOverride="needs-clarification" />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '随便')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(await findByText('再说清楚一点')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/PlannerView.test.tsx`
Expected: FAIL — cannot resolve `./PlannerView`.

- [ ] **Step 3: Implement the view**

Create `src/views/PlannerView.tsx`:
```tsx
import { useState } from 'react'
import type { Identity } from '../api/auth'
import type { PlanRequest } from '../../contract'
import { usePlanStream } from '../hooks/usePlanStream'
import { InputBar, type InputSubmit } from '../components/InputBar'
import { ProgressTrail } from '../components/ProgressTrail'
import { PlanSummary } from '../components/PlanSummary'
import { Itinerary } from '../components/Itinerary'
import { WhyDrawer } from '../components/WhyDrawer'
import { EmptyState } from '../components/EmptyState'
import { AccountMenu } from '../components/AccountMenu'
import { AmapProvider } from '../map/AmapProvider'
import { RouteMap } from '../map/RouteMap'
import { BrandStamp } from '../design/icons'

export function PlannerView({ identity, onLogout, fixtureOverride }: {
  identity: Identity
  onLogout: () => void
  /** test-only: force a specific offline fixture. */
  fixtureOverride?: string
}) {
  const { state, run } = usePlanStream()
  const [lastRequest, setLastRequest] = useState('')

  const submit = (value: InputSubmit) => {
    setLastRequest(value.request)
    const request: PlanRequest = {
      request: value.request,
      preferences: value.preferences,
      previousPlan: state.route,
    }
    run(request, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  const clarifyCity = (city: string) => {
    const request: PlanRequest = {
      request: `城市：${city}，${lastRequest}`,
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: null,
    }
    run(request, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  const routeExplanation = state.route ? (state.explanations[state.route.id] ?? '') : ''

  return (
    <AmapProvider>
      <div className="paper-surface min-h-screen">
        <header className="flex items-center justify-between gap-3 px-4 py-3">
          <BrandStamp />
          <AccountMenu identity={identity} onLogout={onLogout} onOpenHistory={() => {}} />
        </header>

        <div className="px-4">
          <InputBar onSubmit={submit} busy={state.streaming} />
          <div className="mt-2"><ProgressTrail stages={state.stages} /></div>
        </div>

        <main className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section className="h-[320px] lg:h-[calc(100vh-220px)]">
            <RouteMap route={state.route ?? EMPTY_ROUTE} candidates={state.candidates} />
          </section>

          <section className="space-y-3">
            {state.error ? (
              <EmptyState error={state.error} onClarifyCity={clarifyCity} />
            ) : state.route ? (
              <>
                {state.constraints && <PlanSummary route={state.route} constraints={state.constraints} />}
                <Itinerary route={state.route} explanation={routeExplanation} />
                {state.constraints && (
                  <WhyDrawer route={state.route} constraints={state.constraints} dataSources={state.dataSources} />
                )}
              </>
            ) : (
              <p className="paper-card p-6 text-center text-[13px] text-[var(--ink-soft)]">
                写下这次出门的想法,生成你的路线手帐。
              </p>
            )}
          </section>
        </main>
      </div>
    </AmapProvider>
  )
}

const EMPTY_ROUTE = {
  id: 'empty', stops: [], totalCost: 0, totalWalkMin: 0, totalTransitMin: 0,
  endTime: 0, coverage: [], checks: [], explanation: '', risks: [],
} as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/PlannerView.test.tsx`
Expected: PASS (2 tests). Both run in `fixtures` mode (default `VITE_PLAN_SOURCE` unset → fixtures), the first using the default happy-path fixture, the second via `fixtureOverride`.

- [ ] **Step 5: Commit**

```bash
git add src/views/PlannerView.tsx src/views/PlannerView.test.tsx
git commit -m "feat(frontend): PlannerView map-primary layout wiring the SSE stream

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: App router + AuthGate (`/login` vs `/app`)

Spec §5: `/login` 与 `/app` 分离 + `AuthGate` 守卫(未登入访问 `/app` → 重定向 `/login`). A dependency-free hash router avoids adding react-router.

**Files:**
- Create: `src/AuthGate.tsx`
- Modify: `src/App.tsx`
- Test: `src/AuthGate.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/AuthGate.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AuthGate } from './AuthGate'
import * as auth from './api/auth'

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

describe('AuthGate', () => {
  it('routes an unauthenticated /app visit to the login view', () => {
    window.location.hash = '#/app'
    const { getByText } = render(<AuthGate />)
    expect(getByText('翻开手帐第一页')).toBeInTheDocument()
  })
  it('shows the planner once a session exists and hash is /app', async () => {
    auth.setSession({ token: 't', kind: 'guest', name: '访客' })
    window.location.hash = '#/app'
    const { findByPlaceholderText } = render(<AuthGate />)
    expect(await findByPlaceholderText(/静安/)).toBeInTheDocument()
  })
  it('redirects an authenticated /login visit to /app', async () => {
    auth.setSession({ token: 't', kind: 'guest', name: '访客' })
    window.location.hash = '#/login'
    render(<AuthGate />)
    await waitFor(() => expect(window.location.hash).toBe('#/app'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/AuthGate.test.tsx`
Expected: FAIL — cannot resolve `./AuthGate`.

- [ ] **Step 3: Implement the gate**

Create `src/AuthGate.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { currentIdentity, clearSession, type Identity } from './api/auth'
import { LoginView } from './views/LoginView'
import { PlannerView } from './views/PlannerView'

type Route = '/login' | '/app'

function readRoute(): Route {
  return window.location.hash.replace(/^#/, '') === '/app' ? '/app' : '/login'
}

export function AuthGate() {
  const [identity, setIdentity] = useState<Identity | null>(() => currentIdentity())
  const [route, setRoute] = useState<Route>(() => readRoute())

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Authenticated users never sit on /login; unauthenticated never sit on /app.
  useEffect(() => {
    if (identity && route === '/login') window.location.hash = '#/app'
    if (!identity && route === '/app') window.location.hash = '#/login'
  }, [identity, route])

  if (identity && route === '/app') {
    return (
      <PlannerView
        identity={identity}
        onLogout={() => {
          clearSession()
          setIdentity(null)
          window.location.hash = '#/login'
        }}
      />
    )
  }

  return (
    <LoginView
      onAuthed={(id) => {
        setIdentity(id)
        window.location.hash = '#/app'
      }}
    />
  )
}
```

- [ ] **Step 4: Wire it into App**

Replace `src/App.tsx` with:
```tsx
import { AuthGate } from './AuthGate'

export default function App() {
  return <AuthGate />
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/AuthGate.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/AuthGate.tsx src/App.tsx src/AuthGate.test.tsx
git commit -m "feat(frontend): AuthGate hash router splitting /login and /app

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Config — env example, index.html title, Tailwind content globs, full green

**Files:**
- Create: `.env.example`
- Modify: `index.html`
- Modify: `tailwind.config.js`
- Modify: `src/index.css` (drop old `.travel-*` mock styles; keep base)

- [ ] **Step 1: Document the env contract**

Create `.env.example`:
```bash
# Frontend dev: 'fixtures' (offline, default) or 'live' (POST /api/plan via vercel dev)
VITE_PLAN_SOURCE=fixtures

# 高德 JS API key (Web 端) — separate from the backend Web 服务 key.
# Configure 安全密钥 + 域名白名单 in the 高德 console before going live.
VITE_AMAP_JS_KEY=
VITE_AMAP_SECURITY_CODE=
```

- [ ] **Step 2: Update the document title + lang**

Replace `index.html` with:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>漫游·手帐 · Stroll · Shanghai</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Point Tailwind at the new tree only**

Replace `tailwind.config.js` with:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 4: Strip the old mock-era global styles**

Replace `src/index.css` with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
}

html, body, #root {
  height: 100%;
}

body {
  margin: 0;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
```

- [ ] **Step 5: Run the full suite + typecheck + build**

Run:
```bash
npm test && npx tsc --noEmit && npm run build
```
Expected: all vitest files PASS (contract + every `src/**` test added by this plan); `tsc --noEmit` clean; `vite build` succeeds producing `dist/`.

- [ ] **Step 6: Commit**

```bash
git add .env.example index.html tailwind.config.js src/index.css
git commit -m "chore(frontend): env example, brand title, tailwind globs, base css

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

### Spec §5 coverage map

| Spec §5 requirement | Task(s) |
|---|---|
| 前端零规划逻辑;删除 `src/engine`/`src/data`/`src/mock` | Task 1 (git rm) |
| `/login` + `/app` 分离 + `AuthGate` 重定向 | Task 20 |
| 登入页:用户名/密码 + 注册 + 访客继续 + 翻开手帐仪式感 | Task 18 |
| 目录结构(api/ map/ components/ views/ design/) | Tasks 4–6, 15–20, 2–3 |
| 布局:地图主视图(桌面右时间轴 / 移动 bottom-area) | Task 19 |
| `planStream.ts` SSE 消费(fetch + ReadableStream + 契约 parse 思路) | Task 5 |
| 流式渲染:stage→进度 / candidates→撒点 / route→路线+时间轴 / explanation→打字补入 / error→空态 | Tasks 7,16,10/11,10,13 + 19 wiring |
| 产品审查 7 条改法(地图主视图/WhyDrawer/InputBar 引导/校验挂 StopCard/AccountMenu/StopCard 用户动作/移动 sheet) | Tasks 16,12,14,11+9,17,9,19 |
| no-mock 补:删"排队风险"卡片;StopCard 每字段标来源 | Task 9 (asserts no 排队 + 高德/估算 tags) |
| v2:品牌漫游·手帐 + 朱砂印章 logo | Tasks 2,3 (`BrandStamp`) |
| v2:LXGW WenKai + Fraunces + Noto Sans SC 字体引入 | Task 2 (`@import` + CSS vars) |
| v2:暖纸+墨黑+朱砂红配色(单一主强调) | Task 2 (palette vars) |
| v2:横格纸纹+颗粒噪点+胶带+印章材质 | Task 2 (`--paper-lines`,`--grain`,`.tape`,`.stamp`) |
| v2:门店真实照片拍立得样式 | Task 2 (`.polaroid`) + Task 9 (uses it) |
| v2:lucide 图标,禁 emoji | Task 3 (wrappers) + Task 2 test (emoji scan) |
| v2:三站点墨黑/朱砂/鼠尾草,与 pin 对应 | Task 2 (`.dot-*`) + Task 9 (`DOT_BY_INDEX`) + Task 16 (`MARKER_COLORS`) |
| 高德 JS 地图(独立 JS key + 安全密钥 + 域名白名单) | Task 15 (AmapProvider) + Task 16 (RouteMap) + Task 21 (.env.example notes 白名单) |
| 对着 `contract/fixtures/` 离线跑;vitest + RTL | Task 1 (deps) + Task 5 (fixtures mode) + every component test |

Spec §7 cleanup (delete engine/data/mock; remove eval scripts) is Task 1.

### Placeholder scan

No `TBD`/`TODO`/"类似 Task N"/"加适当错误处理". Every step lists exact file paths, full real code, exact commands, and concrete expected output. The one conditional note (Task 9) is an explicit contract-sync instruction with the exact export line to add, not a placeholder.

### Type consistency

- All data/event types are imported from `../../contract` (relative to `src/`) or `contract/` — none are redefined. Names used: `PlanRequest`, `PlanRequestSchema` (not re-declared; only the inferred `PlanRequest` type is imported), `SSEEvent`, `SSEEventSchema`, `Constraints`, `ScoredPOI`, `Route`, `RouteStop`, `POI`, `Check`, `DataSources`, `Category`, `FieldSource`.
- `ErrorState.code` union (Task 7) matches `ErrorEventSchema.code` enum from contract `events.ts` (`needs-clarification | insufficient-data | upstream-unavailable | bad-request`).
- `StageState.status` (Task 7/8) matches `StageEventSchema.status` (`running | ok | skip | fail`).
- `InputBar` emits `preferences` exactly shaped as `PlanRequest['preferences']` (`personaPick: 'auto'|'couple'|'family'|'friends'|'solo'`, `prefs: string[]`, `budgetPref: number|null`); `PlannerView` adds `previousPlan` to form the full `PlanRequest`.
- `streamPlan` validates every frame with `SSEEventSchema` (the seam guard), so any drift from the frozen contract fails a test rather than rendering silently.

### Risks / spec gaps found

1. **`FieldSource` re-export.** Plan 0 defines `FieldSource` in `contract/types.ts` but its Task 2 barrel snippet only guarantees `export * from './types'`, which does re-export it — Task 9's note is a belt-and-suspenders check. Low risk.
2. **Per-field `sources` keys are unconstrained.** Contract `RouteStop.sources` is `z.record(z.string(), FieldSource)`, so the spec's "每字段标来源" relies on the backend populating keys like `rating`/`perCapita`/`sceneTags`. StopCard only renders the keys it knows; if the backend names them differently, some tags silently won't show. Worth pinning exact key names in a contract follow-up.
3. **`previousPlan` type.** Contract `PlanRequestSchema.previousPlan` is `RouteSchema.nullable()` (a single `Route`), but spec §3 calls replan "传上一版" plan. PlannerView passes `state.route` (a single Route), which matches the contract — but if replan needs the full multi-route `PlanResult`, the contract must change on `main`. Flagged, not worked around.
4. **高德 JS 商用授权 (spec §10).** Out of frontend scope but blocks production; `.env.example` documents 安全密钥 + 域名白名单 but legal authorization is a launch gate the team must clear.
5. **Explanation-to-stop distribution is heuristic.** `explanation` events stream a per-route narrative, not per-stop deltas; Itinerary sentence-splits it across stops. If the product wants strict per-stop理由, the contract should carry a stop index in `ExplanationEventSchema` — current frozen schema has only `routeId`. Flagged.
6. **No `@testing-library/react` peer warning risk.** RTL 16 supports React 18/19; pinned versions are compatible, but if Plan 0 bumped React, re-verify on install.
