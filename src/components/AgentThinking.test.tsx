import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AgentThinking } from './AgentThinking'
import type { AgentStep } from '../hooks/usePlanStream'

// Typing animation uses requestAnimationFrame/timers; jsdom renders the full
// text immediately (text content is set up-front, glyphs are only masked via
// width animation), so we assert on the typing markers, not on partial text.

const steps: AgentStep[] = [
  { kind: 'thought', text: '先找亲子餐厅' },
  { kind: 'action', tool: 'searchPOI', args: '海淀 亲子餐厅' },
  { kind: 'observation', summary: '找到 5 家亲子餐厅', count: 5 },
]

describe('AgentThinking', () => {
  it('renders nothing when there are no steps', () => {
    const { container } = render(<AgentThinking steps={[]} streaming={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders thought / action / observation text in order', () => {
    const { getByText } = render(<AgentThinking steps={steps} streaming />)
    expect(getByText('先找亲子餐厅')).toBeInTheDocument()
    expect(getByText(/海淀 亲子餐厅/)).toBeInTheDocument()
    expect(getByText(/找到 5 家亲子餐厅/)).toBeInTheDocument()
  })

  it('shows the observation hit count while streaming', () => {
    const { getByText } = render(<AgentThinking steps={steps} streaming />)
    // the count is rendered as its own node (exact '5')
    expect(getByText('5')).toBeInTheDocument()
  })

  it('expands while streaming and is collapsible once done', () => {
    // streaming: content visible
    const live = render(<AgentThinking steps={steps} streaming />)
    expect(live.queryByText('先找亲子餐厅')).toBeInTheDocument()
    live.unmount()
    // done: a toggle exists so it can fold into a drawer
    const done = render(<AgentThinking steps={steps} streaming={false} />)
    expect(done.getByRole('button')).toBeInTheDocument()
  })

  it('shows a blinking cursor and a "正在思考" pulse while streaming', () => {
    const { container, getByText } = render(<AgentThinking steps={steps} streaming />)
    expect(container.querySelector('[data-cursor]')).not.toBeNull()
    expect(getByText('正在思考')).toBeInTheDocument()
  })

  it('hides the cursor and "正在思考" once done', () => {
    const { container, queryByText } = render(<AgentThinking steps={steps} streaming={false} />)
    expect(container.querySelector('[data-cursor]')).toBeNull()
    expect(queryByText('正在思考')).toBeNull()
  })

  it('only the latest step is animated as typing', () => {
    const { container } = render(<AgentThinking steps={steps} streaming />)
    const typing = container.querySelectorAll('[data-typing="true"]')
    // exactly one step (the last) carries the active typing marker
    expect(typing.length).toBe(1)
    // and it is the last step's text
    expect(typing[0].textContent).toContain('找到 5 家亲子餐厅')
  })

  it('places the cursor on the latest step, not earlier ones', () => {
    const { container } = render(<AgentThinking steps={steps} streaming />)
    const cursors = container.querySelectorAll('[data-cursor]')
    expect(cursors.length).toBe(1)
  })

  it('does not animate typing when not streaming (all steps static)', () => {
    const { container } = render(<AgentThinking steps={steps} streaming={false} />)
    expect(container.querySelectorAll('[data-typing="true"]').length).toBe(0)
  })
})
