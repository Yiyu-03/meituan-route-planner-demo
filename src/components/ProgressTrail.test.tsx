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
