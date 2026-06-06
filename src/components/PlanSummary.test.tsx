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
