import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { PlannerView } from './PlannerView'
import * as planStreamApi from '../api/planStream'
import * as historyApi from '../api/history'
import type { HistoryRecord } from '../api/history'

vi.mock('../map/AmapProvider', () => ({
  AmapProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAmap: () => ({ status: 'missing-key', AMap: null }),
}))

vi.mock('../api/history')

afterEach(() => vi.restoreAllMocks())

const identity = { token: 't', kind: 'guest' as const, name: '访客' }

const historyRecord: HistoryRecord = {
  planId: 'p-hist',
  request: '外滩夜景散步',
  createdAt: '2026-05-20T00:00:00Z',
  constraints: {
    city: '上海', district: '黄浦', startTime: 18, durationMin: 180, party: 2,
    budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: [], avoid: [],
    mustCategories: [], pace: 'normal', personaId: 'couple', raw: '外滩夜景散步',
  },
  routes: [{
    id: 'r-hist', stops: [], totalCost: 166, totalWalkMin: 22, totalTransitMin: 0,
    endTime: 21, coverage: ['nightscape'], checks: [], explanation: '历史路线说明', risks: [],
  }],
  dataSources: {
    amapPoi: { configured: true, used: true, status: 'ok' },
    amapRoute: { configured: true, used: true, status: 'ok' },
    deepseek: { configured: true, used: true, status: 'ok' },
    cache: { hits: 0, misses: 0 },
  },
}

beforeEach(() => {
  vi.mocked(historyApi.listHistory).mockResolvedValue([])
  vi.mocked(historyApi.getHistory).mockResolvedValue(historyRecord)
})

describe('PlannerView', () => {
  it('streams the happy-path fixture into a rendered itinerary', async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(await findByText('看得到风景的咖啡馆')).toBeInTheDocument()
  })

  it('renders the honest empty state from the clarification fixture', async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} fixtureOverride="needs-clarification" />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '随便')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(await findByText('再说清楚一点')).toBeInTheDocument()
  })

  it('shows RefineBar once a route exists and refines with previousPlan = current route', async () => {
    const { getByPlaceholderText, getByRole, findByText, findByPlaceholderText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    await findByText('看得到风景的咖啡馆')

    // RefineBar is now visible
    const refineInput = await findByPlaceholderText(/微调这条路线/)

    // Spy streamPlan to capture the refine request payload
    const spy = vi.spyOn(planStreamApi, 'streamPlan').mockResolvedValue(undefined)
    await userEvent.type(refineInput, '换更便宜的')
    await userEvent.click(getByRole('button', { name: /微调这条路线/ }))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [req] = spy.mock.calls[0]
    expect(req.request).toBe('换更便宜的')
    expect(req.previousPlan).not.toBeNull()
    expect(req.previousPlan?.id).toBe('route-0')
  })

  it('loads a plan from the shelf into the main view', async () => {
    vi.mocked(historyApi.listHistory).mockResolvedValue([
      { planId: 'p-hist', request: '外滩夜景散步', createdAt: '2026-05-20T00:00:00Z' },
    ])
    const { findByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    const tag = await findByRole('button', { name: /外滩夜景散步/ })
    await userEvent.click(tag)
    // loaded route content appears (constraints city + refine bar)
    expect(await findByText(/微调这条路线/)).toBeInTheDocument()
    expect(await findByText(/黄浦/)).toBeInTheDocument()
  })
})
