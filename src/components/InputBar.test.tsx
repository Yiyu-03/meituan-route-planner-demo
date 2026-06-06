import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputBar } from './InputBar'

describe('InputBar', () => {
  it('submits the typed request with default preferences', async () => {
    const onSubmit = vi.fn()
    const { getByPlaceholderText, getByRole } = render(<InputBar onSubmit={onSubmit} busy={false} />)
    await userEvent.type(getByPlaceholderText(/静安/), '静安找个安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(onSubmit).toHaveBeenCalledWith({
      request: '静安找个安静咖啡',
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
    })
  })
  it('toggles a preference chip into the payload', async () => {
    const onSubmit = vi.fn()
    const { getByText, getByPlaceholderText, getByRole } = render(<InputBar onSubmit={onSubmit} busy={false} />)
    await userEvent.type(getByPlaceholderText(/静安/), 'x')
    await userEvent.click(getByText('安静'))
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(onSubmit.mock.calls[0][0].preferences.prefs).toContain('quiet')
  })
  it('fills the textarea from the example button', async () => {
    const onSubmit = vi.fn()
    const { getByText, getByPlaceholderText } = render(<InputBar onSubmit={onSubmit} busy={false} />)
    await userEvent.click(getByText('用示例'))
    expect((getByPlaceholderText(/静安/) as HTMLTextAreaElement).value.length).toBeGreaterThan(0)
  })
  it('disables submit while busy', () => {
    const { getByRole } = render(<InputBar onSubmit={() => {}} busy />)
    expect(getByRole('button', { name: /生成路线|生成中/ })).toBeDisabled()
  })
})
