import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhyDrawer } from './WhyDrawer'
import type { Route, Constraints, DataSources } from '../../contract'

const constraints: Constraints = {
  city: '上海', district: '静安寺', startTime: 14, durationMin: 330, party: 2,
  budgetPerCapita: null, diningBudgetPerCapita: 300, prefs: ['quiet'], avoid: [],
  mustCategories: ['dining'], pace: 'normal', personaId: 'couple', raw: 'x',
}
const route: Route = {
  id: 'route-0', stops: [], totalCost: 215, totalWalkMin: 0, totalTransitMin: 0, endTime: 19,
  coverage: ['cafe'], checks: [{ key: 'budget', label: '预算', status: 'pass', detail: '人均 ¥215' }],
  explanation: '', risks: [],
}
const dataSources: DataSources = {
  amapPoi: { configured: true, used: true, status: 'ok' },
  amapRoute: { configured: true, used: true, status: 'ok' },
  deepseek: { configured: true, used: true, status: 'ok' },
  cache: { hits: 1, misses: 2 },
}

describe('WhyDrawer', () => {
  it('is collapsed by default and expands on click', async () => {
    const { getByRole, queryByText, getByText } = render(
      <WhyDrawer route={route} constraints={constraints} dataSources={dataSources} />,
    )
    expect(queryByText(/人均 ¥215/)).toBeNull()
    await userEvent.click(getByRole('button', { name: /规划依据/ }))
    expect(getByText(/人均 ¥215/)).toBeInTheDocument()
    expect(getByText(/缓存命中/)).toBeInTheDocument()
  })
})
