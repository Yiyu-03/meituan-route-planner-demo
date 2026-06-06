import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { PlannerView } from './PlannerView'

vi.mock('../map/AmapProvider', () => ({
  AmapProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAmap: () => ({ status: 'missing-key', AMap: null }),
}))

afterEach(() => vi.restoreAllMocks())

const identity = { token: 't', kind: 'guest' as const, name: '访客' }

describe('PlannerView', () => {
  it('streams the happy-path fixture into a rendered itinerary', async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '静安安静咖啡')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(await findByText('看得到风景的咖啡馆')).toBeInTheDocument()
  })

  it('renders the honest empty state from the clarification fixture', async () => {
    const { getByPlaceholderText, getByRole, findByText } = render(
      <PlannerView identity={identity} onLogout={() => {}} fixtureOverride="needs-clarification" />,
    )
    await userEvent.type(getByPlaceholderText(/静安/), '随便')
    await userEvent.click(getByRole('button', { name: '生成路线' }))
    expect(await findByText('再说清楚一点')).toBeInTheDocument()
  })
})
