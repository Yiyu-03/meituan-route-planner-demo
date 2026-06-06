import { useState } from 'react'
import type { ErrorState } from '../hooks/usePlanStream'

const TITLE: Record<ErrorState['code'], string> = {
  'needs-clarification': '再说清楚一点',
  'insufficient-data': '这里真实可去的地方不够',
  'upstream-unavailable': '数据源暂时联系不上',
  'bad-request': '这条需求我没读懂',
}

export function EmptyState({ error, onClarifyCity }: {
  error: ErrorState
  onClarifyCity: (city: string) => void
}) {
  const [city, setCity] = useState('')
  return (
    <div className="paper-card mx-auto max-w-md p-6 text-center">
      <h2 className="hand text-[18px] text-[var(--ink)]">{TITLE[error.code]}</h2>
      <p className="mt-2 text-[13px] leading-6 text-[var(--ink-soft)]">{error.message}</p>
      {error.code === 'needs-clarification' && (
        <div className="mt-4 flex items-center gap-2">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="补充城市，例如：上海"
            className="flex-1 rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] px-3 py-2 text-[14px] outline-none"
          />
          <button
            type="button"
            onClick={() => city.trim() && onClarifyCity(city.trim())}
            className="rounded-md bg-[var(--ink)] px-3 py-2 text-[13px] text-white"
          >
            用这个城市重试
          </button>
        </div>
      )}
    </div>
  )
}
