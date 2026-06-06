import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { AmapProvider, useAmap } from './AmapProvider'

function Probe() {
  const { status } = useAmap()
  return <span>status:{status}</span>
}

afterEach(() => {
  vi.unstubAllEnvs()
  document.head.innerHTML = ''
})

describe('AmapProvider', () => {
  it('reports missing-key when no JS key is configured', async () => {
    vi.stubEnv('VITE_AMAP_JS_KEY', '')
    const { getByText } = render(<AmapProvider><Probe /></AmapProvider>)
    await waitFor(() => expect(getByText('status:missing-key')).toBeInTheDocument())
  })
  it('injects the loader script and sets the security code when a key exists', async () => {
    vi.stubEnv('VITE_AMAP_JS_KEY', 'js-key-123')
    vi.stubEnv('VITE_AMAP_SECURITY_CODE', 'sec-456')
    render(<AmapProvider><Probe /></AmapProvider>)
    await waitFor(() => {
      const script = document.querySelector('script[src*="webapi.amap.com/maps"]')
      expect(script).not.toBeNull()
    })
    expect(window._AMapSecurityConfig?.securityJsCode).toBe('sec-456')
  })
})
