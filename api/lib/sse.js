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
