import type { RouteStop, FieldSource } from '../../contract'
import { CategoryIcon, ActionIcons, MetaIcons } from '../design/icons'

const SOURCE_LABEL: Record<FieldSource, string> = {
  amap: '高德',
  user: '你的输入',
  derived: '估算',
}

function fmtHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh}:${String(mm).padStart(2, '0')}`
}

function SourceTag({ label, source }: { label: string; source?: FieldSource }) {
  if (!source) return null
  return (
    <span className="rounded-full border border-[var(--hairline)] px-1.5 py-0.5 text-[10px] text-[var(--ink-soft)]">
      {label} · {SOURCE_LABEL[source]}
    </span>
  )
}

const DOT_BY_INDEX = ['dot-ink', 'dot-cinnabar', 'dot-sage']

export function StopCard({ index, stop, explanation }: {
  index: number
  stop: RouteStop
  explanation: string
}) {
  const { poi, sources } = stop
  const photo = poi.photos[0]
  const { navigate: Nav, book: Book, call: Call, save: Save } = ActionIcons
  const { walk: Walk } = MetaIcons
  return (
    <article className="paper-card relative p-3 sm:p-4">
      <span className={`absolute -left-2 top-4 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold text-white ${DOT_BY_INDEX[index % 3]}`}>
        <span className="latin">{index + 1}</span>
      </span>
      <div className="flex gap-3 pl-3">
        {photo && (
          <div className="polaroid h-24 w-24 shrink-0">
            <span className="tape -top-2 left-6" />
            <img src={photo} alt={poi.name} loading="lazy" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <CategoryIcon category={poi.category} size={16} />
            <h3 className="hand truncate text-[16px]">{poi.name}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-soft)]">
            <span className="latin">{fmtHour(stop.arrive)}–{fmtHour(stop.depart)}</span>
            {poi.rating != null && <span className="latin">{poi.rating}</span>}
            {poi.perCapita != null && <span className="latin">¥{poi.perCapita}</span>}
            {stop.legFromPrev && (
              <span className="inline-flex items-center gap-1">
                <Walk size={13} strokeWidth={1.7} aria-hidden />
                <span className="latin">{stop.legFromPrev.minutes}min</span>
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {poi.rating != null && <SourceTag label="评分" source={sources.rating} />}
            {poi.perCapita != null && <SourceTag label="人均" source={sources.perCapita} />}
            <SourceTag label="场景标签" source={sources.sceneTags} />
          </div>
          {explanation && (
            <p className="mt-2 text-[13px] leading-6 text-[var(--ink)]">{explanation}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-3">
        <a
          aria-label="导航"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]"
          href={`https://uri.amap.com/marker?position=${poi.lng},${poi.lat}&name=${encodeURIComponent(poi.name)}`}
          target="_blank" rel="noreferrer"
        >
          <Nav size={14} strokeWidth={1.7} aria-hidden /> 导航
        </a>
        <button type="button" aria-label="订座" className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]">
          <Book size={14} strokeWidth={1.7} aria-hidden /> 订座
        </button>
        {poi.tel && (
          <a aria-label="拨打电话" className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]" href={`tel:${poi.tel}`}>
            <Call size={14} strokeWidth={1.7} aria-hidden /> 电话
          </a>
        )}
        <button type="button" aria-label="收藏" className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[12px]">
          <Save size={14} strokeWidth={1.7} aria-hidden /> 收藏
        </button>
      </div>
    </article>
  )
}
