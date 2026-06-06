import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AuthGate } from './AuthGate'
import * as auth from './api/auth'

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

describe('AuthGate', () => {
  it('routes an unauthenticated /app visit to the login view', () => {
    window.location.hash = '#/app'
    const { getByText } = render(<AuthGate />)
    expect(getByText('翻开手帐第一页')).toBeInTheDocument()
  })
  it('shows the planner once a session exists and hash is /app', async () => {
    auth.setSession({ token: 't', kind: 'guest', name: '访客' })
    window.location.hash = '#/app'
    const { findByPlaceholderText } = render(<AuthGate />)
    expect(await findByPlaceholderText(/静安/)).toBeInTheDocument()
  })
  it('redirects an authenticated /login visit to /app', async () => {
    auth.setSession({ token: 't', kind: 'guest', name: '访客' })
    window.location.hash = '#/login'
    render(<AuthGate />)
    await waitFor(() => expect(window.location.hash).toBe('#/app'))
  })
})
