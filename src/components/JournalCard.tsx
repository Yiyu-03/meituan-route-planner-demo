import { useState } from 'react'
import type { Route, Constraints } from '../../contract'
import { CategoryIcon, MetaIcons } from '../design/icons'
import { Share2, Check } from 'lucide-react'

function fmtHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh}:${String(mm).padStart(2, '0')}`
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/** Derive a short theme line from constraints (prefs / must categories / raw). */
function themeOf(constraints: Constraints): string {
  if (constraints.prefs.length) return constraints.prefs.join(' · ')
  if (constraints.raw) return constraints.raw.slice(0, 16)
  return '城市漫游'
}

export function JournalCard({ route, constraints }: { route: Route; constraints: Constraints }) {
  const { pin: Pin, clock: Clock } = MetaIcons
  const [shared, setShared] = useState(false)
  const where = [constraints.city, constraints.district].filter(Boolean).join(' · ')
  const date = today()

  const onShare = async () => {
    const text = `漫游·手帐 ｜ ${where}\n${route.stops.map((s, i) => `${i + 1}. ${s.poi.name}`).join('\n')}`
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: `漫游·手帐 · ${where}`, text })
        return
      } catch {
        /* user cancelled or unsupported — fall through to copy hint */
      }
    }
    try {
      await navigator.clipboard?.writeText(text)
    } catch {
      /* clipboard unavailable in this context */
    }
    setShared(true)
    setTimeout(() => setShared(false), 2400)
  }

  return (
    <section className="paper-card relative overflow-hidden p-5">
      {/* 胶带装饰 */}
      <span className="tape -top-2 left-10" aria-hidden />

      {/* 封面 */}
      <div className="relative flex items-start justify-between gap-3 border-b border-dashed border-[var(--hairline)] pb-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">漫游·手帐 · Journal</p>
          <h2 className="hand mt-1 text-[22px] leading-tight">{where}</h2>
          <p className="hand mt-0.5 text-[13px] text-[var(--ink-soft)]">{themeOf(constraints)}</p>
          <p className="latin mt-1 text-[12px] text-[var(--ink-soft)]">{date}</p>
        </div>
        <span className="stamp shrink-0 text-[13px]">漫游</span>
      </div>

      {/* 站点紧凑图文列表 */}
      <ol className="mt-3 space-y-2">
        {route.stops.map((s, i) => (
          <li key={`${s.poi.id}-${i}`} className="flex items-center gap-2.5">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[11px] font-semibold text-white">
              <span className="latin">{i + 1}</span>
            </span>
            {s.poi.photos[0] ? (
              <img
                src={s.poi.photos[0]}
                alt={s.poi.name}
                loading="lazy"
                className="h-8 w-8 shrink-0 rounded object-cover ring-1 ring-[var(--hairline)]"
              />
            ) : (
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--paper-base)] text-[var(--ink-soft)] ring-1 ring-[var(--hairline)]">
                <CategoryIcon category={s.poi.category} size={15} />
              </span>
            )}
            <span className="hand min-w-0 flex-1 truncate text-[14px]">{s.poi.name}</span>
            <span className="latin inline-flex shrink-0 items-center gap-1 text-[11px] text-[var(--ink-soft)]">
              {fmtHour(s.arrive)}
            </span>
          </li>
        ))}
      </ol>

      {/* 页脚 + 分享 */}
      <div className="mt-4 flex items-center justify-between border-t border-dashed border-[var(--hairline)] pt-3">
        <div className="flex items-center gap-3 text-[11px] text-[var(--ink-soft)]">
          <span className="inline-flex items-center gap-1">
            <Pin size={12} strokeWidth={1.7} aria-hidden /> <span className="latin">{route.stops.length}站</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} strokeWidth={1.7} aria-hidden />
            <span className="latin">{fmtHour(constraints.startTime)}–{fmtHour(route.endTime)}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onShare}
          aria-label="保存为图片或分享"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cinnabar)] px-2.5 py-1 text-[12px] text-[var(--cinnabar)] transition-colors hover:bg-[var(--cinnabar)] hover:text-white"
        >
          {shared ? (
            <><Check size={14} strokeWidth={1.8} aria-hidden /> 已复制</>
          ) : (
            <><Share2 size={14} strokeWidth={1.7} aria-hidden /> 保存 / 分享</>
          )}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--ink-soft)]">提示：长按或截图此卡片即可保存分享。</p>
    </section>
  )
}
