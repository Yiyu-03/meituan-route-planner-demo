import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StopCard } from './StopCard'
import type { RouteStop } from '../../contract'

const stop: RouteStop = {
  poi: {
    id: 'B0LBRRKLFC', name: '看得到风景的咖啡馆', category: 'cafe', city: '上海', area: '静安寺',
    lat: 31.224, lng: 121.443, rating: 4.5, perCapita: 78, tags: ['安静'],
    openHour: 9, closeHour: 20, photos: ['https://example.com/a.jpg'], tel: '021-0000', source: 'amap',
  },
  arrive: 14, depart: 15, legFromPrev: null,
  reasons: ['命中你的需求：安静'],
  sources: { rating: 'amap', perCapita: 'amap', sceneTags: 'derived' },
}

describe('StopCard', () => {
  it('renders the real store name and rating', () => {
    const { getByText } = render(<StopCard index={0} stop={stop} explanation="" />)
    expect(getByText('看得到风景的咖啡馆')).toBeInTheDocument()
    expect(getByText('4.5')).toBeInTheDocument()
  })
  it('renders a polaroid photo when amap returns one', () => {
    const { container } = render(<StopCard index={0} stop={stop} explanation="" />)
    expect(container.querySelector('.polaroid img')).not.toBeNull()
  })
  it('labels each field source as 高德 or 估算', () => {
    const { getByText, queryByText } = render(<StopCard index={0} stop={stop} explanation="" />)
    expect(getByText('场景标签 · 估算')).toBeInTheDocument()
    expect(getByText('人均 · 高德')).toBeInTheDocument()
    expect(queryByText(/排队/)).toBeNull()
  })
  it('shows user-action buttons and streamed explanation', () => {
    const { getByLabelText, getByText } = render(
      <StopCard index={0} stop={stop} explanation="先到靠窗坐下" />,
    )
    expect(getByLabelText('导航')).toBeInTheDocument()
    expect(getByLabelText('拨打电话')).toBeInTheDocument()
    expect(getByText('先到靠窗坐下')).toBeInTheDocument()
  })
  it('calls onSelect with its index when the card is clicked (map locate)', async () => {
    const onSelect = vi.fn()
    const { getByText } = render(<StopCard index={2} stop={stop} explanation="" onSelect={onSelect} />)
    await userEvent.click(getByText('看得到风景的咖啡馆'))
    expect(onSelect).toHaveBeenCalledWith(2)
  })
  it('marks the active card with aria-current', () => {
    const { container } = render(<StopCard index={0} stop={stop} explanation="" active />)
    expect(container.querySelector('[aria-current="true"]')).not.toBeNull()
  })
})
