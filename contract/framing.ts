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
