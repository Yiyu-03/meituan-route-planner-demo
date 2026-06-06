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
