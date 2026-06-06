/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLAN_SOURCE?: 'live' | 'fixtures'
  readonly VITE_AMAP_JS_KEY?: string
  readonly VITE_AMAP_SECURITY_CODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  _AMapSecurityConfig?: { securityJsCode: string }
  AMap?: unknown
}
