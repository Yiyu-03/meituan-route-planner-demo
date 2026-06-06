import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { RouteMap } from './RouteMap'
import type { Route, ScoredPOI } from '../../contract'

vi.mock('./AmapProvider', () => ({
  useAmap: () => ({ status: 'missing-key', AMap: null }),
}))

afterEach(() => vi.restoreAllMocks())

const route: Route = {
  id: 'route-0',
  stops: [{
    poi: { id: 'a', name: '咖啡馆', category: 'cafe', city: '上海', area: '静安寺', lat: 31.22, lng: 121.44,
      rating: 4.5, perCapita: 78, tags: [], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' },
    arrive: 14, depart: 15, legFromPrev: null, reasons: [], sources: {},
  }],
  totalCost: 78, totalWalkMin: 0, totalTransitMin: 0, endTime: 15, coverage: ['cafe'], checks: [], explanation: '', risks: [],
}
const candidates: ScoredPOI[] = []

describe('RouteMap', () => {
  it('shows a configuration notice when the JS key is missing (no fake tiles)', () => {
    const { getByText } = render(<RouteMap route={route} candidates={candidates} />)
    expect(getByText(/地图未配置/)).toBeInTheDocument()
  })
  it('always renders the map container element', () => {
    const { container } = render(<RouteMap route={route} candidates={candidates} />)
    expect(container.querySelector('[data-amap-container]')).not.toBeNull()
  })
})
