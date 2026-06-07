import { useState } from 'react'
import { MessageCircleQuestion, Send } from 'lucide-react'
import type { QuestionState } from '../hooks/usePlanStream'

/** Renders the agent's askUser prompt: clickable options + a free-text answer. 朱砂高亮表示在等待。 */
export function AgentQuestion({ question, onAnswer }: {
  question: QuestionState
  onAnswer: (text: string) => void
}) {
  const [text, setText] = useState('')
  const submitText = () => {
    const v = text.trim()
    if (v) onAnswer(v)
  }
  return (
    <section
      className="paper-card border-l-4 p-4"
      style={{ borderLeftColor: 'var(--cinnabar)' }}
      aria-live="assertive"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[var(--cinnabar)]">
          <MessageCircleQuestion size={18} strokeWidth={1.8} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="hand text-[15px] leading-6 text-[var(--ink)]">{question.question}</p>

          {question.options && question.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {question.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onAnswer(opt)}
                  className="rounded-md border border-[var(--cinnabar)] px-3 py-1.5 text-[13px] text-[var(--cinnabar)] transition-colors hover:bg-[var(--cinnabar)] hover:text-white"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); submitText() }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="或直接回答…"
              className="flex-1 rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none focus:border-[var(--cinnabar)]"
            />
            <button
              type="submit"
              aria-label="回答"
              className="inline-flex items-center gap-1 rounded-md bg-[var(--ink)] px-3 py-2 text-[13px] text-white"
            >
              <Send size={14} strokeWidth={1.8} aria-hidden /> 回答
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
