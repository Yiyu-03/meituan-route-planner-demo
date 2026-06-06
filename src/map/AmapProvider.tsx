import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type AmapStatus = 'loading' | 'ready' | 'missing-key' | 'error'

interface AmapContextValue {
  status: AmapStatus
  AMap: unknown
}

const AmapContext = createContext<AmapContextValue>({ status: 'loading', AMap: null })

export function useAmap(): AmapContextValue {
  return useContext(AmapContext)
}

const SCRIPT_ID = 'amap-js-sdk'

export function AmapProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AmapStatus>('loading')
  const [AMap, setAMap] = useState<unknown>(null)

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_JS_KEY
    if (!key) {
      setStatus('missing-key')
      return
    }
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE
    if (securityCode) {
      window._AMapSecurityConfig = { securityJsCode: securityCode }
    }
    if (window.AMap) {
      setAMap(window.AMap)
      setStatus('ready')
      return
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = SCRIPT_ID
      script.async = true
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`
      document.head.appendChild(script)
    }
    const onLoad = () => {
      if (window.AMap) {
        setAMap(window.AMap)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    }
    const onError = () => setStatus('error')
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    return () => {
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }
  }, [])

  return <AmapContext.Provider value={{ status, AMap }}>{children}</AmapContext.Provider>
}
