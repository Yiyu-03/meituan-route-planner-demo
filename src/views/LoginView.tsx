import { useState } from 'react'
import type { FormEvent } from 'react'
import { login, register, guest, type Identity } from '../api/auth'
import { RoamSeal } from '../design/icons'

type Mode = 'login' | 'register'

const FIELD = 'w-full border-0 border-b border-[var(--hairline)] bg-transparent px-0 py-2 text-[15px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-soft)]/60 focus:border-[var(--cinnabar)]'

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
    <div className="paper-surface relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <style>{`
        @keyframes lv-press { 0% { opacity: 0; transform: rotate(-4deg) scale(.6); } 55% { opacity: 1; transform: rotate(-4deg) scale(1.08); } 100% { opacity: 1; transform: rotate(-4deg) scale(1); } }
        @keyframes lv-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
        .lv-press { animation: lv-press .6s cubic-bezier(.2,1.4,.35,1) both; }
        .lv-rise { animation: lv-rise .5s ease both; }
        @media (prefers-reduced-motion: reduce) { .lv-press, .lv-rise { animation: none; } }
      `}</style>

      {/* faint roaming-route watermark for depth */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 600">
        <g stroke="var(--cinnabar)" fill="none" opacity="0.05">
          <path d="M-20 470 C 160 380, 230 520, 380 430 S 620 300, 690 360 S 840 300, 860 250" strokeWidth="2.5" strokeDasharray="1 14" strokeLinecap="round" />
          <path d="M60 90 C 200 160, 300 80, 470 150 S 700 110, 820 180" strokeWidth="2" strokeDasharray="1 16" strokeLinecap="round" />
          <circle cx="380" cy="430" r="6" fill="var(--cinnabar)" stroke="none" />
          <circle cx="690" cy="360" r="6" fill="var(--cinnabar)" stroke="none" />
        </g>
      </svg>

      <div className="paper-card relative w-full max-w-[360px] px-8 pb-7 pt-10">
        {/* washi tape + corner registration ticks */}
        <span className="tape -top-3 left-12" aria-hidden />
        {(['left-2 top-2', 'right-2 top-2', 'left-2 bottom-2', 'right-2 bottom-2'] as const).map((pos) => (
          <span key={pos} className={`absolute ${pos} text-[10px] leading-none text-[var(--hairline)]`} aria-hidden>＋</span>
        ))}

        {/* focal seal */}
        <div className="flex flex-col items-center">
          <span className="stamp lv-press text-[var(--cinnabar)]" style={{ padding: '10px', borderRadius: 12 }}>
            <RoamSeal size={34} strokeWidth={1.5} />
          </span>
          <h2 className="hand lv-rise mt-3 text-[24px] tracking-[0.04em] text-[var(--ink)]" style={{ animationDelay: '.1s' }}>漫游·手帐</h2>
          <p className="latin lv-rise text-[12px] uppercase tracking-[0.34em] text-[var(--ink-soft)]" style={{ animationDelay: '.16s' }}>Stroll · Shanghai</p>
        </div>

        {/* ornamental divider */}
        <div className="my-5 flex items-center gap-3 text-[var(--hairline)]" aria-hidden>
          <span className="h-px flex-1 bg-[var(--hairline)]" />
          <span className="text-[var(--cinnabar)]/70">◆</span>
          <span className="h-px flex-1 bg-[var(--hairline)]" />
        </div>

        <h1 className="hand mb-5 text-center text-[15px] text-[var(--ink-soft)]">翻开手帐第一页</h1>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="latin mb-0.5 block text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">用户名 · Name</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className="latin mb-0.5 block text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">密码 · Key</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="密码"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={FIELD}
            />
          </label>

          {error && <p className="text-[12px] text-[var(--cinnabar)]">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="hand relative w-full rounded-md bg-[var(--ink)] px-4 py-2.5 text-[15px] tracking-[0.08em] text-[var(--paper-card)] shadow-[0_6px_16px_-8px_rgba(36,31,23,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] transition-transform hover:-translate-y-px disabled:opacity-60"
          >
            {mode === 'login' ? '登入手帐' : '注册并登入'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-[12px]">
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-[var(--ink-soft)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
          >
            {mode === 'login' ? '没有账号 · 去注册' : '已有账号 · 去登入'}
          </button>
          <button
            type="button"
            onClick={continueAsGuest}
            className="inline-flex items-center gap-1 text-[var(--cinnabar)] hover:gap-1.5"
          >
            访客继续 <span aria-hidden>→</span>
          </button>
        </div>

        {/* editorial edition line */}
        <p className="latin mt-7 text-center text-[10.5px] tracking-[0.14em] text-[var(--ink-soft)]/80">
          No. 0042 · Est. 2026 · 上海
        </p>
      </div>
    </div>
  )
}
