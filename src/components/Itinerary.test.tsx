import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Itinerary } from './Itinerary'
import type { Route } from '../../contract'

function poi(id: string, name: string) {
  return {
    id, name, category: 'cafe' as const, city: '上海', area: '静安寺', lat: 31.2, lng: 121.4,
    rating: 4.5, perCapita: 78, tags: ['安静'], openHour: 9, closeHour: 20, photos: [], tel: null, source: 'amap' as const,
  }
}
const route: Route = {
  id: 'route-0',
  stops: [
    { poi: poi('a', '咖啡馆'), arrive: 14, depart: 15, legFromPrev: null, reasons: ['安静'], sources: {} },
    { poi: poi('b', '本帮菜'), arrive: 18, depart: 19, legFromPrev: { distM: 500, minutes: 8, mode: 'walk' }, reasons: ['本帮菜'], sources: {} },
  ],
  totalCost: 215, totalWalkMin: 8, totalTransitMin: 0, endTime: 19, coverage: ['cafe', 'dining'],
  checks: [], explanation: '', risks: [],
}

describe('Itinerary', () => {
  it('renders one StopCard per stop', () => {
    const { getByRole } = render(<Itinerary route={route} explanation="" />)
    // Each stop's name renders as a heading; reasons may repeat the text in the
    // per-card explanation, so target the headings specifically.
    expect(getByRole('heading', { name: '咖啡馆' })).toBeInTheDocument()
    expect(getByRole('heading', { name: '本帮菜' })).toBeInTheDocument()
  })
  it('renders nothing when route has no stops', () => {
    const empty = { ...route, stops: [] }
    const { container } = render(<Itinerary route={empty} explanation="" />)
    expect(container.firstChild).toBeNull()
  })
})
