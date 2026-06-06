import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginView } from './LoginView'
import * as auth from '../api/auth'

afterEach(() => vi.restoreAllMocks())

describe('LoginView', () => {
  it('logs in and calls onAuthed with the identity', async () => {
    const id = { token: 't', kind: 'user' as const, name: 'ada' }
    vi.spyOn(auth, 'login').mockResolvedValue(id)
    const onAuthed = vi.fn()
    const { getByPlaceholderText, getByRole } = render(<LoginView onAuthed={onAuthed} />)
    await userEvent.type(getByPlaceholderText('用户名'), 'ada')
    await userEvent.type(getByPlaceholderText('密码'), 'pw')
    await userEvent.click(getByRole('button', { name: '登入手帐' }))
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(id))
  })
  it('continues as guest', async () => {
    const id = { token: 'd', kind: 'guest' as const, name: '访客' }
    vi.spyOn(auth, 'guest').mockResolvedValue(id)
    const onAuthed = vi.fn()
    const { getByRole } = render(<LoginView onAuthed={onAuthed} />)
    await userEvent.click(getByRole('button', { name: '访客继续' }))
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(id))
  })
  it('shows the brand and a login error', async () => {
    vi.spyOn(auth, 'login').mockRejectedValue(new Error('用户名或密码错误'))
    const { getByText, getByPlaceholderText, getByRole } = render(<LoginView onAuthed={() => {}} />)
    expect(getByText('漫游·手帐')).toBeInTheDocument()
    await userEvent.type(getByPlaceholderText('用户名'), 'ada')
    await userEvent.type(getByPlaceholderText('密码'), 'bad')
    await userEvent.click(getByRole('button', { name: '登入手帐' }))
    await waitFor(() => expect(getByText('用户名或密码错误')).toBeInTheDocument())
  })
})
