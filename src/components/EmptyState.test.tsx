import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the clarification copy and fires retry with the typed city', async () => {
    const onClarify = vi.fn()
    const { getByText, getByPlaceholderText, getByRole } = render(
      <EmptyState error={{ code: 'needs-clarification', message: '需要补充城市', recoverable: true }} onClarifyCity={onClarify} />,
    )
    expect(getByText('需要补充城市')).toBeInTheDocument()
    await userEvent.type(getByPlaceholderText('补充城市，例如：上海'), '上海')
    await userEvent.click(getByRole('button', { name: '用这个城市重试' }))
    expect(onClarify).toHaveBeenCalledWith('上海')
  })
  it('renders insufficient-data without inventing a route', () => {
    const { getByText, queryByText } = render(
      <EmptyState error={{ code: 'insufficient-data', message: '真实地点不足', recoverable: true }} onClarifyCity={() => {}} />,
    )
    expect(getByText('真实地点不足')).toBeInTheDocument()
    expect(queryByText(/示例路线|默认/)).toBeNull()
  })
  it('renders upstream-unavailable guidance', () => {
    const { getByText } = render(
      <EmptyState error={{ code: 'upstream-unavailable', message: '高德暂不可用', recoverable: true }} onClarifyCity={() => {}} />,
    )
    expect(getByText('高德暂不可用')).toBeInTheDocument()
  })
})
