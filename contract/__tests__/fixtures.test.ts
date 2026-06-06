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
