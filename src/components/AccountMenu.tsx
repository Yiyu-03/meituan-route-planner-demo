import type { Identity } from '../api/auth'
import { History, LogOut, UserRound } from 'lucide-react'

export function AccountMenu({ identity, onLogout, onOpenHistory }: {
  identity: Identity
  onLogout: () => void
  onOpenHistory: () => void
}) {
  return (
    <div className="paper-card flex items-center gap-2 px-2.5 py-1.5">
      <UserRound size={16} strokeWidth={1.7} aria-hidden />
      <span className="hand text-[13px]">{identity.name || (identity.kind === 'guest' ? '访客' : '我')}</span>
      <button
        type="button"
        onClick={onOpenHistory}
        aria-label="历史记录"
        className="rounded p-1 text-[var(--ink-soft)] hover:text-[var(--ink)]"
      >
        <History size={15} strokeWidth={1.7} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onLogout}
        aria-label="退出登录"
        className="rounded p-1 text-[var(--ink-soft)] hover:text-[var(--cinnabar)]"
      >
        <LogOut size={15} strokeWidth={1.7} aria-hidden />
      </button>
    </div>
  )
}
