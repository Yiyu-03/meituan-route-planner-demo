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
    const { getByPlaceholderText, getByRole, findAllByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    // name appears in StopCard (and is echoed in JournalCard's stop list)
    expect((await findAllByText('看得到风景的咖啡馆')).length).toBeGreaterThan(0)
  })

  it('shows TripInsights and JournalCard once a route exists', async () => {
    const { getByPlaceholderText, getByRole, findAllByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    await findAllByText('看得到风景的咖啡馆')
    // TripInsights heading (rendered in both desktop+stacked slots in jsdom)
    expect((await findAllByText('行程洞察')).length).toBeGreaterThan(0)
    // JournalCard share entry
    expect((await findAllByText(/保存 \/ 分享/)).length).toBeGreaterThan(0)
    // brand line from the journal card cover appears
    expect((await findAllByText(/漫游·手帐/)).length).toBeGreaterThan(0)
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
    const { getByPlaceholderText, getByRole, findAllByText, findByPlaceholderText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    await findAllByText('看得到风景的咖啡馆')

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

  it('生成路线 is always a fresh plan (previousPlan=null) even after a plan exists', async () => {
    const { getByPlaceholderText, getByRole, findAllByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    await findAllByText('看得到风景的咖啡馆')

    // A plan now exists; a second 生成路线 must NOT carry previousPlan (else backend replans).
    const spy = vi.spyOn(planStreamApi, 'streamPlan').mockResolvedValue(undefined)
    await userEvent.clear(getByPlaceholderText(/静安/))
    await userEvent.type(getByPlaceholderText(/静安/), '北京海淀带孩子逛博物馆')
    await userEvent.click(getByRole('button', { name: '生成路线' }))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [req] = spy.mock.calls[0]
    expect(req.request).toBe('北京海淀带孩子逛博物馆')
    expect(req.previousPlan).toBeNull()
  })

  it('renders the agent thinking trail then the finished route from the react fixture', async () => {
    const { getByPlaceholderText, getByRole, findByText, findAllByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} fixtureOverride="react-thinking" />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '北京海淀带孩子')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    // the thinking trail section is present (folds once done, but its header remains)
    expect(await findByText('思考过程')).toBeInTheDocument()
    // and the finished route from the fixture shows up (echoed in JournalCard too)
    expect((await findAllByText('海淀公园')).length).toBeGreaterThan(0)
  })

  it('shows AgentQuestion when the agent asks, and resumes with conversationId + answer', async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} fixtureOverride="react-question" />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '北京海淀公园')
    await userEvent.click(getByRole('button', { name: '生成路线' }))

    // the agent's question appears
    expect(await findByText('海淀的公园里，你更想要哪种？')).toBeInTheDocument()
    const option = await findByText('带娃游乐设施')

    // answering resumes the conversation with conversationId + answer
    const spy = vi.spyOn(planStreamApi, 'streamPlan').mockResolvedValue(undefined)
    await userEvent.click(option)

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [req] = spy.mock.calls[0]
    expect(req.conversationId).toBe('conv-demo-1')
    expect(req.answer).toBe('带娃游乐设施')
  })

  it('loads a plan from the shelf into the main view', async () => {
    vi.mocked(historyApi.listHistory).mockResolvedValue([
      { planId: 'p-hist', request: '外滩夜景散步', createdAt: '2026-05-20T00:00:00Z' },
    ])
    const { findByRole, findByText, findAllByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    const tag = await findByRole('button', { name: /外滩夜景散步/ })
    await userEvent.click(tag)
    // loaded route content appears (constraints city + refine bar)
    expect(await findByText(/微调这条路线/)).toBeInTheDocument()
    expect((await findAllByText(/黄浦/)).length).toBeGreaterThan(0)
  })
})
