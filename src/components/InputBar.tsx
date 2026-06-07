import { useState } from 'react'
import type { FormEvent } from 'react'
import type { PlanRequest } from '../../contract'
import { ActionIcons } from '../design/icons'

export type InputSubmit = {
  request: string
  preferences: PlanRequest['preferences']
}

const PERSONAS: { id: PlanRequest['preferences']['personaPick']; label: string }[] = [
  { id: 'auto', label: '自动识别' },
  { id: 'couple', label: '情侣' },
  { id: 'family', label: '亲子' },
  { id: 'friends', label: '朋友' },
  { id: 'solo', label: '一个人' },
]

const PREF_CHIPS: { key: string; label: string }[] = [
  { key: 'quiet', label: '安静' },
  { key: 'budget', label: '省钱' },
  { key: 'photo', label: '出片' },
  { key: 'local', label: '本地烟火' },
]

const EXAMPLE = '周末下午在上海静安找个安静咖啡，再吃顿本帮菜，人均300内'

export function InputBar({ onSubmit, busy }: { onSubmit: (v: InputSubmit) => void; busy: boolean }) {
  const [text, setText] = useState('')
  const [persona, setPersona] = useState<PlanRequest['preferences']['personaPick']>('auto')
  const [prefs, setPrefs] = useState<string[]>([])

  const togglePref = (key: string) =>
    setPrefs((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const request = text.trim()
    if (!request || busy) return
    onSubmit({ request, preferences: { personaPick: persona, prefs, budgetPref: null } })
  }

  return (
    <form onSubmit={submit} className="paper-card space-y-3 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="周末下午在上海静安找个安静咖啡，再吃顿本帮菜，人均300内"
        className="w-full resize-none rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] p-3 text-[15px] leading-7 outline-none"
      />
      <div className="flex flex-wrap gap-1.5">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPersona(p.id)}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${persona === p.id ? 'border-[var(--cinnabar)] text-[var(--cinnabar)]' : 'border-[var(--hairline)] text-[var(--ink-soft)]'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PREF_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => togglePref(c.key)}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${prefs.includes(c.key) ? 'border-[var(--sage)] text-[var(--sage)]' : 'border-[var(--hairline)] text-[var(--ink-soft)]'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setText(EXAMPLE)}
          className="rounded-md border border-[var(--hairline)] px-3 py-2 text-[13px] text-[var(--ink-soft)]"
        >
          用示例
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--ink)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60"
        >
          <ActionIcons.navigate size={15} strokeWidth={1.8} aria-hidden />
          {busy ? '生成中' : '生成路线'}
        </button>
      </div>
    </form>
  )
}
