import { useEffect, useState } from 'react'
import { currentIdentity, clearSession, type Identity } from './api/auth'
import { LoginView } from './views/LoginView'
import { PlannerView } from './views/PlannerView'

type Route = '/login' | '/app'

function readRoute(): Route {
  return window.location.hash.replace(/^#/, '') === '/app' ? '/app' : '/login'
}

export function AuthGate() {
  const [identity, setIdentity] = useState<Identity | null>(() => currentIdentity())
  const [route, setRoute] = useState<Route>(() => readRoute())

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Authenticated users never sit on /login; unauthenticated never sit on /app.
  useEffect(() => {
    if (identity && route === '/login') window.location.hash = '#/app'
    if (!identity && route === '/app') window.location.hash = '#/login'
  }, [identity, route])

  if (identity && route === '/app') {
    return (
      <PlannerView
        identity={identity}
        onLogout={() => {
          clearSession()
          setIdentity(null)
          window.location.hash = '#/login'
        }}
      />
    )
  }

  return (
    <LoginView
      onAuthed={(id) => {
        setIdentity(id)
        window.location.hash = '#/app'
      }}
    />
  )
}
