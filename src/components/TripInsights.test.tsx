import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TripInsights } from './TripInsights'
import type { Route, Constraints, RouteStop, POI } from '../../contract'

function poi(over: Partial<POI> = {}): POI {
  return {
    id: 'p', name: '咖啡馆', category: 'cafe', city: '上海', area: '静安寺',
    lat: 31.2, lng: 121.4, rating: 4.5, perCapita: 78, tags: [], openHour: 9,
    closeHour: 20, photos: [], tel: null, source: 'amap', ...over,
  }
}
function stop(over: Partial<RouteStop> = {}): RouteStop {
  return {
    poi: poi(over.poi), arrive: 14, depart: 15, legFromPrev: null,
    reasons: [], sources: {}, ...over,
  }
}

const constraints: Constraints = {
  city: '上海', district: '静安寺', startTime: 14, durationMin: 330, party: 2,
  budgetPerCapita: 200, diningBudgetPerCapita: null, prefs: ['quiet'], avoid: [],
  mustCategories: ['cafe'], pace: 'normal', personaId: 'couple', raw: 'x',
}

const route: Route = {
  id: 'route-0',
  stops: [
    stop({ poi: poi({ category: 'cafe', perCapita: 78 }) }),
    stop({ poi: poi({ id: 'p2', name: '本帮菜', category: 'dining', perCapita: 120 }) }),
  ],
  totalCost: 198, totalWalkMin: 18, totalTransitMin: 12, endTime: 19,
  coverage: ['cafe', 'dining'],
  checks: [
    { key: 'budget', label: '预算', status: 'pass', detail: '人均合计 ¥198' },
    { key: 'pace', label: '节奏', status: 'warn', detail: '行程偏紧，注意预留时间' },
  ],
  explanation: '', risks: ['夜间打车可能较难'],
}

describe('TripInsights', () => {
  it('shows per-capita total against the budget', () => {
    const { getByText } = render(<TripInsights route={route} constraints={constraints} />)
    expect(getByText(/198/)).toBeInTheDocument()
    expect(getByText(/200/)).toBeInTheDocument() // budget reference
  })

  it('warns when the per-capita total exceeds the budget', () => {
    const over: Route = { ...route, totalCost: 260 }
    const { getByText } = render(<TripInsights route={over} constraints={constraints} />)
    expect(getByText(/超支/)).toBeInTheDocument()
  })

  it('does not warn when within budget', () => {
    const { queryByText } = render(<TripInsights route={route} constraints={constraints} />)
    expect(queryByText(/超支/)).not.toBeInTheDocument()
  })

  it('renders a category badge for each covered category label', () => {
    const { getByText } = render(<TripInsights route={route} constraints={constraints} />)
    expect(getByText('咖啡')).toBeInTheDocument()
    expect(getByText('餐饮')).toBeInTheDocument()
  })

  it('splits movement into walking vs transit minutes', () => {
    const { getByText } = render(<TripInsights route={route} constraints={constraints} />)
    expect(getByText(/步行/)).toBeInTheDocument()
    expect(getByText('18min')).toBeInTheDocument() // walk minutes
    expect(getByText(/车程/)).toBeInTheDocument()
    expect(getByText('12min')).toBeInTheDocument() // transit minutes
  })

  it('surfaces warn/fail check details and risks as reminders', () => {
    const { getByText } = render(<TripInsights route={route} constraints={constraints} />)
    expect(getByText(/行程偏紧/)).toBeInTheDocument()
    expect(getByText(/夜间打车/)).toBeInTheDocument()
  })
})
