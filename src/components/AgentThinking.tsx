import { useState } from 'react'
import { Search, MessageCircleQuestion, Flag, Eye, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentStep } from '../hooks/usePlanStream'

const TOOL_ICON: Record<'searchPOI' | 'askUser' | 'finish', LucideIcon> = {
  searchPOI: Search,
  askUser: MessageCircleQuestion,
  finish: Flag,
}

const TOOL_LABEL: Record<'searchPOI' | 'askUser' | 'finish', string> = {
  searchPOI: '搜索',
  askUser: '反问',
  finish: '收尾',
}

function StepRow({ step }: { step: AgentStep }) {
  if (step.kind === 'thought') {
    return (
      <li className="flex items-start gap-2">
        <span className="mt-0.5 text-[var(--ink-soft)]">
          <Sparkles size={14} strokeWidth={1.7} aria-hidden />
        </span>
        <p className="hand text-[14px] leading-6 text-[var(--ink)]">{step.text}</p>
      </li>
    )
  }
  if (step.kind === 'action') {
    const Icon = TOOL_ICON[step.tool]
    return (
      <li className="flex items-center gap-2">
        <span className="text-[var(--cinnabar)]">
          <Icon size={14} strokeWidth={1.8} aria-hidden />
        </span>
        <span className="text-[13px] text-[var(--ink-soft)]">
          <span className="hand text-[var(--ink)]">{TOOL_LABEL[step.tool]}</span>
          <span className="ml-1.5">{step.args}</span>
        </span>
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2 pl-0.5">
      <span className="text-[var(--sage)]">
        <Eye size={14} strokeWidth={1.7} aria-hidden />
      </span>
      <span className="text-[13px] text-[var(--ink-soft)]">
        {step.summary}
        {typeof step.count === 'number' && (
          <span className="latin ml-1.5 text-[var(--sage)]">{step.count}</span>
        )}
      </span>
    </li>
  )
}

/** Live reasoning trail (reason → act → observe), v2 手帐风. Expanded while streaming; foldable when done. */
export function AgentThinking({ steps, streaming }: { steps: AgentStep[]; streaming: boolean }) {
  // Auto-expand during streaming; once done, default to folded (can fold into the why-drawer).
  const [open, setOpen] = useState(true)
  if (steps.length === 0) return null

  const expanded = streaming || open

  return (
    <section className="paper-card p-3" aria-live="polite">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] text-[var(--ink)]">
          <Sparkles size={14} strokeWidth={1.8} aria-hidden className="text-[var(--cinnabar)]" />
          <span className="hand">思考过程</span>
          {streaming && <span className="dot-cinnabar inline-block h-1.5 w-1.5 animate-pulse rounded-full" />}
        </div>
        {!streaming && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="latin text-[12px] text-[var(--ink-soft)]"
          >
            {expanded ? '收起' : '展开'}
          </button>
        )}
      </div>
      {expanded && (
        <ol className="mt-3 space-y-2 border-l-2 border-dashed border-[var(--hairline)] pl-3">
          {steps.map((step, i) => (
            <StepRow key={i} step={step} />
          ))}
        </ol>
      )}
    </section>
  )
}
