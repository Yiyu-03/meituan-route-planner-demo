import { forwardRef, useState } from 'react'
import type { Route, Constraints } from '../../contract'
import { CategoryIcon } from '../design/icons'

/** Route a cross-origin Amap photo through our same-origin proxy so html-to-image can rasterize it. */
function proxied(url: string): string {
  if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
    return `/api/img-proxy?u=${encodeURIComponent(url)}`
  }
  return url
}

function fmtHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh}:${String(mm).padStart(2, '0')}`
}

function todayLatin(): string {
  const d = new Date()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// ---- collage geometry: a 2-column serpentine the thread can weave through -----
const W = 320
const PAD_TOP = 6
const STEP = 72
const PW = 96            // polaroid width
const LEFT_CX = 86
const RIGHT_CX = 234

interface Node { cx: number; cy: number; top: number; left: number; tilt: number }

function layout(n: number): { nodes: Node[]; H: number } {
  const tilts = [-6, 5, -3, 7, -5, 4]
  const nodes: Node[] = []
  for (let i = 0; i < n; i++) {
    const cx = i % 2 ? RIGHT_CX : LEFT_CX
    const top = PAD_TOP + i * STEP
    nodes.push({ cx, cy: top + 42, top, left: cx - PW / 2, tilt: tilts[i % tilts.length] })
  }
  const H = PAD_TOP + (n - 1) * STEP + 104
  return { nodes, H }
}

/** Smooth thread path through the node centres (S-curve between alternating sides). */
function threadPath(nodes: Node[]): string {
  if (!nodes.length) return ''
  let d = `M ${nodes[0].cx} ${nodes[0].cy}`
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]
    const mx = (a.cx + b.cx) / 2
    d += ` C ${mx} ${a.cy}, ${mx} ${b.cy}, ${b.cx} ${b.cy}`
  }
  return d
}

const ANIM = `
@keyframes src-wipe { from { clip-path: inset(0 100% 0 -6%); } to { clip-path: inset(0 -6% 0 -6%); } }
@keyframes src-pop { 0% { opacity: 0; transform: translate(-50%,-50%) var(--rot) scale(.5); } 60% { opacity: 1; } 100% { opacity: 1; transform: translate(-50%,-50%) var(--rot) scale(1); } }
.src-anim .src-thread { animation: src-wipe 1.5s cubic-bezier(.65,.02,.35,1) .15s both; }
.src-anim .src-pin { animation: src-pop .55s cubic-bezier(.2,1.35,.35,1) both; }
@media (prefers-reduced-motion: reduce) { .src-anim .src-thread, .src-anim .src-pin { animation: none; opacity: 1; clip-path: none; } }
`

function Polaroid({ node, n, label, photo, category, animate }: {
  node: Node; n: number; label: string; photo: string | undefined
  category: Route['stops'][number]['poi']['category']; animate: boolean
}) {
  const [broken, setBroken] = useState(false)
  const badgeBg = n === 1 ? 'var(--ink)' : n % 2 === 0 ? 'var(--cinnabar)' : 'var(--sage)'
  return (
    <div
      className="src-pin"
      style={{
        position: 'absolute', left: node.cx, top: node.cy, width: PW,
        // @ts-expect-error CSS var
        '--rot': `rotate(${node.tilt}deg)`,
        transform: `translate(-50%, -50%) rotate(${node.tilt}deg)`,
        background: '#fffdf7', padding: '5px 5px 0', borderRadius: 2,
        boxShadow: '0 6px 14px -6px rgba(60,44,28,.5)', zIndex: 2,
        animationDelay: animate ? `${0.35 + n * 0.28}s` : undefined,
      }}
    >
      <span style={{
        position: 'absolute', top: -9, left: -9, width: 24, height: 24, borderRadius: '50%',
        display: 'grid', placeItems: 'center', fontFamily: 'var(--font-latin)', fontStyle: 'italic',
        fontSize: 12, color: '#fffdf7', background: badgeBg, boxShadow: '0 2px 5px rgba(60,44,28,.35)', zIndex: 3,
      }}>{n}</span>

      <div style={{
        position: 'relative', width: PW - 10, height: 70, overflow: 'hidden', borderRadius: 1,
        background: photo && !broken ? '#e8dcc4'
          : 'repeating-linear-gradient(45deg, rgba(94,119,87,.12) 0 6px, rgba(94,119,87,.04) 6px 12px), #efe7d2',
        display: 'grid', placeItems: 'center',
      }}>
        {photo && !broken ? (
          <img
            crossOrigin="anonymous" src={proxied(photo)} alt={label} onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span style={{ color: 'var(--sage)' }}><CategoryIcon category={category} size={26} /></span>
        )}
      </div>

      <div className="hand" style={{
        fontSize: 9.5, color: 'var(--ink-soft)', textAlign: 'center', padding: '3px 2px 5px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: PW - 10,
      }}>{label}</div>

      {/* × 叉针:把照片别在纸上 */}
      <svg width="12" height="12" style={{ position: 'absolute', bottom: 6, right: 6, color: 'var(--cinnabar)' }}>
        <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export interface StitchRouteCardProps {
  route: Route
  constraints: Constraints
  /** Run the draw-in animation (off when used purely as an export target). */
  animate?: boolean
}

/** Shareable 漫游手帐 card: stops as tilted polaroids stitched together with a 朱砂 yarn thread. */
export const StitchRouteCard = forwardRef<HTMLDivElement, StitchRouteCardProps>(
  function StitchRouteCard({ route, constraints, animate = true }, ref) {
    const stops = route.stops.slice(0, 6)
    const where = [constraints.city, constraints.district].filter(Boolean).join(' · ') || '城市漫游'
    const { nodes, H } = layout(stops.length)
    const km = ((route.totalWalkMin + route.totalTransitMin) * 0.07).toFixed(1)

    return (
      <div
        ref={ref}
        className={animate ? 'src-anim' : undefined}
        style={{
          width: W + 48, padding: '24px 24px 20px', position: 'relative', borderRadius: 4,
          background: 'linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0) 22%), var(--paper-card)',
          boxShadow: '0 18px 40px -18px rgba(60,44,28,.5)', overflow: 'hidden',
          fontFamily: 'var(--font-body)', color: 'var(--ink)',
        }}
      >
        <style>{ANIM}</style>
        {/* hand-drawn inner frame */}
        <div style={{
          position: 'absolute', inset: 9, border: '1px solid var(--hairline)', borderRadius: 2,
          boxShadow: '0 0 0 3px rgba(251,246,234,.6), 0 0 0 4px var(--hairline)', pointerEvents: 'none',
        }} />
        <span className="tape" style={{ top: -8, left: 28, transform: 'rotate(-5deg)' }} aria-hidden />

        {/* header */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', zIndex: 2 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>漫游·手帐 · Journal</p>
            <h2 className="hand" style={{ fontSize: 24, lineHeight: 1.1, marginTop: 2 }}>{where}</h2>
          </div>
          <span className="stamp" style={{ fontSize: 13, transform: 'rotate(-7deg)' }}>漫游</span>
        </div>

        {/* photo-collage map */}
        <div style={{ position: 'relative', height: H, margin: '14px 0 2px', zIndex: 2 }}>
          <svg
            className="src-thread"
            viewBox={`0 0 ${W} ${H}`} width={W} height={H}
            style={{ position: 'absolute', inset: 0, overflow: 'visible', zIndex: 1 }}
            fill="none"
          >
            <defs>
              <filter id="src-yarn" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="turbulence" baseFrequency="0.018 0.03" numOctaves="2" seed="7" result="n" />
                <feDisplacementMap in="SourceGraphic" in2="n" scale="3" />
              </filter>
            </defs>
            <path d={threadPath(nodes)} stroke="rgba(70,48,30,.16)" strokeWidth="4.4" strokeLinecap="round"
              strokeDasharray="11 9" transform="translate(1.6 2.6)" filter="url(#src-yarn)" />
            <path d={threadPath(nodes)} stroke="var(--cinnabar)" strokeWidth="3.3" strokeLinecap="round"
              strokeDasharray="11 9" filter="url(#src-yarn)" />
            {/* × stitches at segment midpoints */}
            <g stroke="var(--cinnabar)" strokeWidth="2" strokeLinecap="round" opacity="0.85">
              {nodes.slice(1).map((b, i) => {
                const a = nodes[i]
                const mx = (a.cx + b.cx) / 2
                const my = (a.cy + b.cy) / 2
                const rot = i % 2 ? -16 : 22
                return (
                  <g key={i} transform={`translate(${mx} ${my}) rotate(${rot})`}>
                    <path d="M-5 -5 L5 5 M5 -5 L-5 5" />
                  </g>
                )
              })}
            </g>
          </svg>

          {stops.map((s, i) => (
            <Polaroid
              key={`${s.poi.id}-${i}`} node={nodes[i]} n={i + 1} label={s.poi.name}
              photo={s.poi.photos[0]} category={s.poi.category} animate={animate}
            />
          ))}
        </div>

        {/* legs */}
        <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: '0 2px', position: 'relative', zIndex: 2 }}>
          {stops.map((s, i) => (
            <li key={`${s.poi.id}-leg-${i}`}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', borderTop: i ? '1px dashed var(--hairline)' : 'none' }}>
              <span style={{
                flex: '0 0 auto', width: 17, height: 17, border: '1.4px solid var(--cinnabar)', borderRadius: '50%',
                display: 'grid', placeItems: 'center', fontFamily: 'var(--font-latin)', fontStyle: 'italic',
                fontSize: 10.5, color: 'var(--cinnabar)', transform: 'translateY(2px)',
              }}>{i + 1}</span>
              <span className="hand" style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.poi.name}</span>
              <span style={{ flex: 1, borderBottom: '1.5px dotted var(--hairline)', transform: 'translateY(-3px)' }} />
              <span className="latin" style={{ flex: '0 0 auto', fontSize: 12, color: 'var(--ink-soft)' }}>{fmtHour(s.arrive)}</span>
            </li>
          ))}
        </ul>

        {/* footer */}
        <div style={{ position: 'relative', zIndex: 2, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="latin" style={{ fontSize: 11, color: 'var(--ink-soft)', letterSpacing: '0.04em' }}>
            {stops.length} stops · walked {km} km
          </span>
          <span className="latin" style={{ fontSize: 12.5, color: 'var(--ink)', fontStyle: 'italic' }}>{todayLatin()}</span>
        </div>
      </div>
    )
  },
)
