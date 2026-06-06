import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountMenu } from './AccountMenu'

describe('AccountMenu', () => {
  it('shows the identity name and fires logout', async () => {
    const onLogout = vi.fn()
    const { getByText, getByRole } = render(
      <AccountMenu identity={{ token: 't', kind: 'user', name: 'ada' }} onLogout={onLogout} onOpenHistory={() => {}} />,
    )
    expect(getByText('ada')).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: '退出登录' }))
    expect(onLogout).toHaveBeenCalled()
  })
  it('labels a guest identity', () => {
    const { getByText } = render(
      <AccountMenu identity={{ token: 'd', kind: 'guest', name: '访客' }} onLogout={() => {}} onOpenHistory={() => {}} />,
    )
    expect(getByText('访客')).toBeInTheDocument()
  })
})
