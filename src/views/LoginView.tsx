import { useState } from 'react'
import type { FormEvent } from 'react'
import { login, register, guest, type Identity } from '../api/auth'
import { BrandStamp } from '../design/icons'

type Mode = 'login' | 'register'

export function LoginView({ onAuthed }: { onAuthed: (identity: Identity) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const action = mode === 'login' ? login : register
      onAuthed(await action(username.trim(), password))
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失败,请重试。')
    } finally {
      setBusy(false)
    }
  }

  const continueAsGuest = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      onAuthed(await guest())
    } catch (err) {
      setError(err instanceof Error ? err.message : '访客进入失败,请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="paper-surface flex min-h-screen items-center justify-center p-4">
      <div className="paper-card relative w-full max-w-sm p-6">
        <span className="tape -top-3 left-10" />
        <div className="mb-1 flex justify-center"><BrandStamp /></div>
        <p className="latin mb-5 text-center text-[13px] text-[var(--ink-soft)]">Stroll · Shanghai</p>
        <h1 className="hand mb-4 text-center text-[18px]">翻开手帐第一页</h1>

        <form onSubmit={submit} className="space-y-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            autoComplete="username"
            className="w-full rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="密码"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none"
          />
          {error && <p className="text-[12px] text-[var(--cinnabar)]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-[var(--ink)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60"
          >
            {mode === 'login' ? '登入手帐' : '注册并登入'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-[12px] text-[var(--ink-soft)]">
          <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? '没有账号?去注册' : '已有账号?去登入'}
          </button>
          <button type="button" onClick={continueAsGuest} className="text-[var(--cinnabar)]">
            访客继续
          </button>
        </div>
      </div>
    </div>
  )
}
