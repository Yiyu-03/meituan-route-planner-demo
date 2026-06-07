import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AgentThinking } from './AgentThinking'
import type { AgentStep } from '../hooks/usePlanStream'

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
})
