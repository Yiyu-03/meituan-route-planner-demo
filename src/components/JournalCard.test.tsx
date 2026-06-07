import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JournalCard } from './JournalCard'
import type { Route, Constraints, RouteStop, POI } from '../../contract'

function poi(over: Partial<POI> = {}): POI {
  return {
    id: 'p', name: '看得到风景的咖啡馆', category: 'cafe', city: '上海', area: '静安寺',
    lat: 31.2, lng: 121.4, rating: 4.5, perCapita: 78, tags: [], openHour: 9,
    closeHour: 20, photos: [], tel: null, source: 'amap', ...over,
  }
}
function stop(over: Partial<RouteStop> = {}): RouteStop {
  return {
    poi: poi(over.poi), arrive: 14, depart: 15.5, legFromPrev: null,
    reasons: [], sources: {}, ...over,
  }
}

const constraints: Constraints = {
  city: '上海', district: '静安寺', startTime: 14, durationMin: 330, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: ['quiet'], avoid: [],
  mustCategories: ['cafe'], pace: 'normal', personaId: 'couple', raw: '静安安静咖啡',
}

const route: Route = {
  id: 'route-0',
  stops: [
    stop({ poi: poi({ name: '看得到风景的咖啡馆', category: 'cafe' }) }),
    stop({ poi: poi({ id: 'p2', name: '老弄堂本帮菜', category: 'dining' }), arrive: 17, depart: 18.5 }),
  ],
  totalCost: 198, totalWalkMin: 18, totalTransitMin: 12, endTime: 19,
  coverage: ['cafe', 'dining'],
  checks: [], explanation: '', risks: [],
}

afterEach(() => vi.restoreAllMocks())

describe('JournalCard', () => {
  it('renders a cover title with the city and brand', () => {
    const { getByText, getAllByText } = render(<JournalCard route={route} constraints={constraints} />)
    expect(getByText(/上海/)).toBeInTheDocument()
    expect(getAllByText(/漫游·手帐/).length).toBeGreaterThan(0)
  })

  it('renders the cinnabar stamp and a date', () => {
    const { container } = render(<JournalCard route={route} constraints={constraints} />)
    expect(container.querySelector('.stamp')).toBeTruthy()
    // a year is shown somewhere on the card
    expect(container.textContent).toMatch(/20\d{2}/)
  })

  it('lists every stop name', () => {
    const { getByText } = render(<JournalCard route={route} constraints={constraints} />)
    expect(getByText('看得到风景的咖啡馆')).toBeInTheDocument()
    expect(getByText('老弄堂本帮菜')).toBeInTheDocument()
  })

  it('offers a save / share entry', () => {
    const { getByRole } = render(<JournalCard route={route} constraints={constraints} />)
    expect(getByRole('button', { name: /保存|分享|截图/ })).toBeInTheDocument()
  })

  it('opens the share-card sheet when the entry is clicked', async () => {
    const { getByRole, queryByRole } = render(<JournalCard route={route} constraints={constraints} />)
    expect(queryByRole('dialog')).toBeNull()
    await userEvent.click(getByRole('button', { name: /保存|分享|截图/ }))
    // the stitched-card modal renders as a dialog with its own 保存/分享 action
    const dialog = getByRole('dialog', { name: /分享/ })
    expect(dialog).toBeInTheDocument()
  })
})
