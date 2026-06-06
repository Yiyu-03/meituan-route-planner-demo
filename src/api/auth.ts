export type IdentityKind = 'user' | 'guest'

export interface Identity {
  token: string
  kind: IdentityKind
  name: string
}

const STORAGE_KEY = 'stroll-shanghai-session-v1'

export function currentIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Identity>
    if (!parsed.token || !parsed.kind) return null
    return { token: parsed.token, kind: parsed.kind, name: parsed.name ?? '' }
  } catch {
    return null
  }
}

export function getToken(): string | null {
  return currentIdentity()?.token ?? null
}

export function setSession(identity: Identity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function authHeader(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function postIdentity(path: string, body: unknown): Promise<Identity> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detail?.message ?? `请求失败 (${res.status})`)
  }
  const identity = (await res.json()) as Identity
  setSession(identity)
  return identity
}

export function register(username: string, password: string): Promise<Identity> {
  return postIdentity('/api/auth/register', { username, password })
}

export function login(username: string, password: string): Promise<Identity> {
  return postIdentity('/api/auth/login', { username, password })
}

export function guest(): Promise<Identity> {
  return postIdentity('/api/auth/guest', {})
}

export async function logout(): Promise<void> {
  clearSession()
}
