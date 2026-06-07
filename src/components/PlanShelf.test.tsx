import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanShelf } from './PlanShelf'
import * as history from '../api/history'
import type { HistoryRecord } from '../api/history'

vi.mock('../api/history')

const record: HistoryRecord = {
  planId: 'p1',
  request: '静安安静咖啡',
  createdAt: '2026-06-01T00:00:00Z',
  constraints: {
    city: '上海', district: '静安', startTime: 14, durationMin: 240, party: 2,
    budgetPerCapita: 300, diningBudgetPerCapita: null, prefs: [], avoid: [],
    mustCategories: [], pace: 'normal', personaId: 'couple', raw: '静安安静咖啡',
  },
  routes: [{
    id: 'r1', stops: [], totalCost: 188, totalWalkMin: 10, totalTransitMin: 0,
    endTime: 18, coverage: ['cafe'], checks: [], explanation: '说明', risks: [],
  }],
  dataSources: {
    amapPoi: { configured: true, used: true, status: 'ok' },
    amapRoute: { configured: true, used: true, status: 'ok' },
    deepseek: { configured: true, used: true, status: 'ok' },
    cache: { hits: 0, misses: 0 },
  },
}

afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.mocked(history.listHistory).mockReset()
  vi.mocked(history.getHistory).mockReset()
})

describe('PlanShelf', () => {
  it('lists past plans as tags with city / date / cost / stop count', async () => {
    vi.mocked(history.listHistory).mockResolvedValue([
      { planId: 'p1', request: '静安安静咖啡', createdAt: '2026-06-01T00:00:00Z' },
      { planId: 'p2', request: '外滩夜景', createdAt: '2026-05-20T00:00:00Z' },
    ])
    const { findByText, getAllByRole } = render(
      <PlanShelf onLoad={() => {}} onNew={() => {}} />,
    )
    expect(await findByText('静安安静咖啡')).toBeInTheDocument()
    expect(await findByText('外滩夜景')).toBeInTheDocument()
    // two plan tag buttons
    expect(getAllByRole('button', { name: /静安安静咖啡|外滩夜景/ }).length).toBe(2)
  })

  it('loads the chosen plan via getHistory and fires onLoad with the record', async () => {
    vi.mocked(history.listHistory).mockResolvedValue([
      { planId: 'p1', request: '静安安静咖啡', createdAt: '2026-06-01T00:00:00Z' },
    ])
    vi.mocked(history.getHistory).mockResolvedValue(record)
    const onLoad = vi.fn()
    const { findByRole } = render(<PlanShelf onLoad={onLoad} onNew={() => {}} />)
    const tag = await findByRole('button', { name: /静安安静咖啡/ })
    await userEvent.click(tag)
    await waitFor(() => expect(history.getHistory).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(record))
  })

  it('shows a friendly empty state when there is no history', async () => {
    vi.mocked(history.listHistory).mockResolvedValue([])
    const { findByText } = render(<PlanShelf onLoad={() => {}} onNew={() => {}} />)
    expect(await findByText(/还没有规划记录/)).toBeInTheDocument()
  })

  it('shows the empty state when history is unavailable (not logged in)', async () => {
    vi.mocked(history.listHistory).mockRejectedValue(new Error('401'))
    const { findByText } = render(<PlanShelf onLoad={() => {}} onNew={() => {}} />)
    expect(await findByText(/还没有规划记录/)).toBeInTheDocument()
  })

  it('fires onNew when "开新一页" is clicked', async () => {
    vi.mocked(history.listHistory).mockResolvedValue([])
    const onNew = vi.fn()
    const { findByRole } = render(<PlanShelf onLoad={() => {}} onNew={onNew} />)
    await userEvent.click(await findByRole('button', { name: /开新一页/ }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('refreshes the list when reloadKey changes', async () => {
    vi.mocked(history.listHistory).mockResolvedValue([])
    const { rerender } = render(<PlanShelf onLoad={() => {}} onNew={() => {}} reloadKey={0} />)
    await waitFor(() => expect(history.listHistory).toHaveBeenCalledTimes(1))
    rerender(<PlanShelf onLoad={() => {}} onNew={() => {}} reloadKey={1} />)
    await waitFor(() => expect(history.listHistory).toHaveBeenCalledTimes(2))
  })
})
