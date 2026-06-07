import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RefineBar } from './RefineBar'

describe('RefineBar', () => {
  it('submits free text as the refine request', async () => {
    const onRefine = vi.fn()
    const { getByPlaceholderText, getByRole } = render(<RefineBar onRefine={onRefine} busy={false} />)
    await userEvent.type(getByPlaceholderText(/微调/), '换个安静点的')
    await userEvent.click(getByRole('button', { name: /微调这条路线|调整中/ }))
    expect(onRefine).toHaveBeenCalledWith('换个安静点的')
  })

  it('injects the chip phrase as the refine request when a chip is clicked', async () => {
    const onRefine = vi.fn()
    const { getByText } = render(<RefineBar onRefine={onRefine} busy={false} />)
    await userEvent.click(getByText('换更便宜'))
    expect(onRefine).toHaveBeenCalledWith('换更便宜')
  })

  it('appends the chip phrase to existing free text', async () => {
    const onRefine = vi.fn()
    const { getByText, getByPlaceholderText, getByRole } = render(<RefineBar onRefine={onRefine} busy={false} />)
    await userEvent.type(getByPlaceholderText(/微调/), '第二站')
    await userEvent.click(getByText('换更近'))
    await userEvent.click(getByRole('button', { name: /微调这条路线/ }))
    expect(onRefine.mock.calls.at(-1)?.[0]).toContain('第二站')
    expect(onRefine.mock.calls.at(-1)?.[0]).toContain('换更近')
  })

  it('does not submit empty text', async () => {
    const onRefine = vi.fn()
    const { getByRole } = render(<RefineBar onRefine={onRefine} busy={false} />)
    await userEvent.click(getByRole('button', { name: /微调这条路线/ }))
    expect(onRefine).not.toHaveBeenCalled()
  })

  it('disables submit while busy', () => {
    const { getByRole } = render(<RefineBar onRefine={() => {}} busy />)
    expect(getByRole('button', { name: /微调这条路线|调整中/ })).toBeDisabled()
  })
})
