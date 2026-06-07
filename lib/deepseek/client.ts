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
