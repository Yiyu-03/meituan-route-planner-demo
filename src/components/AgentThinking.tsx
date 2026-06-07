import { useEffect, useRef, useState } from 'react'
import { Search, MessageCircleQuestion, Flag, Eye, Sparkles, Loader, PencilLine } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentStep } from '../hooks/usePlanStream'

export type ThinkingVariant = 'plan' | 'refine'

/** Per-variant copy + chrome. refine reads as a 朱砂红批注 (red-pen edit) on the existing 手帐. */
const VARIANT: Record<ThinkingVariant, {
  Icon: LucideIcon; title: string; titleStreaming: string; pulse: string; rail: string
}> = {
  plan: {
    Icon: Sparkles, title: '思考过程', titleStreaming: '思考过程', pulse: '正在思考',
    rail: 'border-l-2 border-dashed border-[var(--hairline)]',
  },
  refine: {
    Icon: PencilLine, title: '改动思路', titleStreaming: '正在改方案', pulse: '正在改方案',
    rail: 'border-l-2 border-[var(--cinnabar)]',
  },
}

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

/**
 * Scoped keyframes for the live trail. Kept inside this component (we only own
 * AgentThinking.tsx) and gated behind prefers-reduced-motion. Classes are
 * namespaced `at-*` to avoid colliding with global tokens.css utilities.
 */
const ANIM_CSS = `
@keyframes at-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
@keyframes at-spin { to { transform: rotate(360deg) } }
@keyframes at-dot { 0%,80%,100% { opacity: .2 } 40% { opacity: 1 } }
.at-blink { animation: at-blink 1.05s steps(1,end) infinite }
.at-spin { display: inline-flex; animation: at-spin 1.8s linear infinite }
.at-dots > span { animation: at-dot 1.4s ease-in-out infinite }
.at-dots > span:nth-child(2) { animation-delay: .2s }
.at-dots > span:nth-child(3) { animation-delay: .4s }
@media (prefers-reduced-motion: reduce) {
  .at-blink, .at-spin, .at-dots > span { animation: none }
}
`

/** True when the user asked for reduced motion — typing/blink are softened. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/**
 * Renders text that "types" itself in: the full text is always present in the
 * DOM (so it is selectable / testable / accessible), and an overlay mask
 * sweeps left→right revealing characters via requestAnimationFrame. We animate
 * a width clip rather than slicing the string so layout never reflows.
 * When `active` is false (or reduced motion), the text is shown instantly.
 */
function Typewriter({ text, active, reduced }: { text: string; active: boolean; reduced: boolean }) {
  // progress: 0..1 fraction of the text revealed.
  const [progress, setProgress] = useState(active && !reduced ? 0 : 1)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active || reduced) {
      setProgress(1)
      return
    }
    setProgress(0)
    const start = performance.now()
    // ~28ms per character, clamped so short and long lines both feel lively.
    const duration = Math.min(2200, Math.max(420, text.length * 28))
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      setProgress(p)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [text, active, reduced])

  const typing = active && progress < 1
  return (
    <span
      data-typing={active ? 'true' : undefined}
      className="relative inline"
      style={{
        // Mask reveals the typed portion; the rest fades to transparent.
        WebkitMaskImage: typing
          ? `linear-gradient(90deg, #000 ${progress * 100}%, transparent ${progress * 100}%)`
          : undefined,
        maskImage: typing
          ? `linear-gradient(90deg, #000 ${progress * 100}%, transparent ${progress * 100}%)`
          : undefined,
      }}
    >
      {text}
    </span>
  )
}

/** Blinking end-of-line caret, Claude-Code style. Static glyph under reduced motion. */
function Caret({ reduced }: { reduced: boolean }) {
  return (
    <span
      data-cursor
      aria-hidden
      className={`ml-0.5 inline-block select-none text-[var(--cinnabar)] ${reduced ? '' : 'at-blink'}`}
    >
      ▍
    </span>
  )
}

function StepRow({
  step,
  isLatest,
  streaming,
  reduced,
}: {
  step: AgentStep
  isLatest: boolean
  streaming: boolean
  reduced: boolean
}) {
  const animate = isLatest && streaming
  const showCaret = isLatest && streaming

  if (step.kind === 'thought') {
    return (
      <li className="flex items-start gap-2">
        <span className="mt-0.5 text-[var(--ink-soft)]">
          <Sparkles size={14} strokeWidth={1.7} aria-hidden />
        </span>
        <p className="hand text-[14px] leading-6 text-[var(--ink)]">
          <Typewriter text={step.text} active={animate} reduced={reduced} />
          {showCaret && <Caret reduced={reduced} />}
        </p>
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
          <span className="ml-1.5">
            <Typewriter text={step.args} active={animate} reduced={reduced} />
          </span>
          {showCaret && <Caret reduced={reduced} />}
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
        <Typewriter text={step.summary} active={animate} reduced={reduced} />
        {typeof step.count === 'number' && (
          <span className="latin ml-1.5 text-[var(--sage)]">{step.count}</span>
        )}
        {showCaret && <Caret reduced={reduced} />}
      </span>
    </li>
  )
}

/** Low-key "thinking…" pulse anchored at the bottom of the trail while streaming. */
function ThinkingPulse({ reduced, label }: { reduced: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 pl-0.5 text-[var(--ink-soft)]">
      <span className={reduced ? 'inline-flex' : 'at-spin'}>
        <Loader size={13} strokeWidth={1.8} aria-hidden />
      </span>
      <span className="hand text-[12px]">{label}</span>
      <span className="at-dots latin text-[12px]" aria-hidden>
        <span>·</span>
        <span>·</span>
        <span>·</span>
      </span>
    </li>
  )
}

/** Live reasoning trail (reason → act → observe), v2 手帐风. Expanded while streaming; foldable when done. */
export function AgentThinking({ steps, streaming, variant = 'plan' }: {
  steps: AgentStep[]; streaming: boolean; variant?: ThinkingVariant
}) {
  // Auto-expand during streaming; once done, default to folded (can fold into the why-drawer).
  const [open, setOpen] = useState(true)
  const reduced = usePrefersReducedMotion()
  if (steps.length === 0) return null

  const expanded = streaming || open
  const lastIndex = steps.length - 1
  const v = VARIANT[variant]
  const HeadIcon = v.Icon

  return (
    <section className="paper-card p-3" aria-live="polite">
      <style>{ANIM_CSS}</style>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] text-[var(--ink)]">
          <HeadIcon size={14} strokeWidth={1.8} aria-hidden className="text-[var(--cinnabar)]" />
          <span className="hand">{streaming ? v.titleStreaming : v.title}</span>
          {streaming && <span className="dot-cinnabar inline-block h-1.5 w-1.5 animate-pulse rounded-full" />}
        </div>
        {!streaming && (
          <button
            type="button"
            onClick={() => setOpen((val) => !val)}
            className="latin text-[12px] text-[var(--ink-soft)]"
          >
            {expanded ? '收起' : '展开'}
          </button>
        )}
      </div>
      {expanded && (
        <ol className={`mt-3 space-y-2 pl-3 ${v.rail}`}>
          {steps.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              isLatest={i === lastIndex}
              streaming={streaming}
              reduced={reduced}
            />
          ))}
          {streaming && <ThinkingPulse reduced={reduced} label={v.pulse} />}
        </ol>
      )}
    </section>
  )
}
