import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CategoryIcon, BrandStamp, ActionIcons } from './icons'

describe('icon wrappers', () => {
  it('renders an svg for every contract category', () => {
    for (const c of ['dining', 'cafe', 'culture', 'entertainment', 'shopping', 'nightscape'] as const) {
      const { container } = render(<CategoryIcon category={c} />)
      expect(container.querySelector('svg')).not.toBeNull()
    }
  })
  it('exposes the user-action icons used by StopCard', () => {
    expect(ActionIcons.navigate).toBeTypeOf('object')
    expect(ActionIcons.book).toBeTypeOf('object')
    expect(ActionIcons.call).toBeTypeOf('object')
    expect(ActionIcons.save).toBeTypeOf('object')
  })
  it('renders the 朱砂 brand stamp text', () => {
    const { getByText } = render(<BrandStamp />)
    expect(getByText('漫游·手帐')).toBeInTheDocument()
  })
})
