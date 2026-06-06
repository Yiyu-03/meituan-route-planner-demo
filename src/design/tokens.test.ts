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
