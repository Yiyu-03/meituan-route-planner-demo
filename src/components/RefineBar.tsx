import { useState } from 'react'
import type { FormEvent } from 'react'
import { Wand2 } from 'lucide-react'

/** 基于当前方案的快捷微调短语。点击即直接提交,或追加到自由文本后再提交。 */
const REFINE_CHIPS: string[] = ['换更便宜', '换更近', '少一站', '换一家', '换更高分']

export function RefineBar({ onRefine, busy }: {
  /** 提交一句基于当前方案的微调诉求。PlannerView 会带上 previousPlan=当前 route。 */
  onRefine: (request: string) => void
  busy: boolean
}) {
  const [text, setText] = useState('')

  const fire = (request: string) => {
    const value = request.trim()
    if (!value || busy) return
    onRefine(value)
    setText('')
  }

  const clickChip = (chip: string) => {
    if (busy) return
    const current = text.trim()
    if (current) {
      setText(`${current}，${chip}`)
    } else {
      fire(chip)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    fire(text)
  }

  return (
    <form onSubmit={submit} className="paper-card space-y-2.5 p-3">
      <div className="hand flex items-center gap-1.5 text-[13px] text-[var(--ink-soft)]">
        <Wand2 size={15} strokeWidth={1.7} aria-hidden />
        基于这条路线再调一调
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REFINE_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => clickChip(chip)}
            disabled={busy}
            className="rounded-full border border-[var(--hairline)] px-2.5 py-1 text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)] hover:text-[var(--cinnabar)] disabled:opacity-60"
          >
            {chip}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="微调这条路线，例如：第二站换家本帮菜"
          className="flex-1 rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded-md bg-[var(--ink)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? '调整中' : '微调这条路线'}
        </button>
      </div>
    </form>
  )
}
