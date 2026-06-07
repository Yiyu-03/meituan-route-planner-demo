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

  const onShare = async () => {
    const text = `漫游·手帐 ｜ ${where}\n${route.stops.map((s, i) => `${i + 1}. ${s.poi.name}`).join('\n')}`
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (typeof nav.share === 'function') {
      try { await nav.share({ title: `漫游·手帐 · ${where}`, text }); return } catch { /* cancelled */ }
    }
    try { await navigator.clipboard?.writeText(text) } catch { /* unavailable */ }
    setShared(true)
    setTimeout(() => setShared(false), 2400)
  }

  return (
    <section className="paper-card relative overflow-hidden p-5">
      <span className="tape -top-2 left-12" aria-hidden />

      {/* 封面 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">漫游·手帐 · Journal</p>
          <h2 className="hand mt-1 text-[24px] leading-tight">{where}</h2>
          <p className="hand mt-0.5 truncate text-[13px] text-[var(--ink-soft)]">{themeOf(constraints)}</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="stamp -rotate-3 text-[13px]">漫游</span>
          <p className="latin mt-1.5 text-[11px] text-[var(--ink-soft)]">{today()}</p>
        </div>
      </div>

      {/* 站点 — 旅程时间轴 */}
      <ol className="relative mt-4 pl-1">
        {route.stops.map((s, i) => {
          const last = i === route.stops.length - 1
          const tilt = i % 2 === 0 ? '-rotate-2' : 'rotate-2'
          return (
            <li key={`${s.poi.id}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
              {/* 左轨:编号 + 连线 */}
              <div className="relative flex w-5 shrink-0 flex-col items-center">
                <span className="z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ink)] text-[11px] font-semibold text-white">
                  <span className="latin">{i + 1}</span>
                </span>
                {!last && <span className="absolute top-5 bottom-0 w-px bg-[repeating-linear-gradient(var(--hairline)_0_3px,transparent_3px_6px)]" aria-hidden />}
              </div>
              {/* 拍立得缩略 */}
              <div className={`shrink-0 ${tilt} rounded-[3px] bg-white p-[3px] shadow-[0_2px_6px_rgba(60,45,20,0.16)]`}>
                {s.poi.photos[0] ? (
                  <img src={s.poi.photos[0]} alt={s.poi.name} loading="lazy" className="h-10 w-10 rounded-[2px] object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-[2px] bg-[var(--paper2,#efe2c6)] text-[var(--amber-d,#97611a)]">
                    <CategoryIcon category={s.poi.category} size={18} />
                  </span>
                )}
              </div>
              {/* 文 */}
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="hand truncate text-[14.5px] leading-tight">{s.poi.name}</p>
                <p className="latin mt-0.5 text-[11px] text-[var(--ink-soft)]">
                  {fmtHour(s.arrive)}–{fmtHour(s.depart)}
                  {s.poi.perCapita != null && <span> · ¥{s.poi.perCapita}</span>}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      {/* 页脚 + 分享 */}
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-[var(--hairline)] pt-3">
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
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cinnabar)] px-3 py-1 text-[12px] text-[var(--cinnabar)] transition-colors hover:bg-[var(--cinnabar)] hover:text-white"
        >
          {shared ? (<><Check size={14} strokeWidth={1.8} aria-hidden /> 已复制</>) : (<><Share2 size={14} strokeWidth={1.7} aria-hidden /> 保存 / 分享</>)}
        </button>
      </div>
    </section>
  )
}
