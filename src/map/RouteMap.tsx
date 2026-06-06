import { useEffect, useRef } from 'react'
import type { Route, ScoredPOI } from '../../contract'
import { useAmap } from './AmapProvider'

const MARKER_COLORS = ['#241f17', '#bb3a2c', '#5e7757']

/** Minimal shape of the AMap global we use; kept local to avoid an SDK type dep. */
interface AMapNS {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => {
    add: (overlay: unknown) => void
    setFitView: () => void
    destroy: () => void
  }
  Marker: new (opts: Record<string, unknown>) => unknown
  Polyline: new (opts: Record<string, unknown>) => unknown
  CircleMarker: new (opts: Record<string, unknown>) => unknown
}

export function RouteMap({ route, candidates }: { route: Route; candidates: ScoredPOI[] }) {
  const { status, AMap } = useAmap()
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (status !== 'ready' || !AMap || !elRef.current) return
    const ns = AMap as AMapNS
    const map = new ns.Map(elRef.current, { zoom: 13, viewMode: '2D' })

    for (const candidate of candidates) {
      map.add(new ns.CircleMarker({
        center: [candidate.poi.lng, candidate.poi.lat],
        radius: 5,
        fillColor: '#bd7c22',
        fillOpacity: 0.5,
        strokeWeight: 0,
      }))
    }

    const path: [number, number][] = route.stops.map((s) => [s.poi.lng, s.poi.lat])
    route.stops.forEach((stop, i) => {
      map.add(new ns.Marker({
        position: [stop.poi.lng, stop.poi.lat],
        content: `<span style="display:inline-flex;width:22px;height:22px;border-radius:50%;background:${MARKER_COLORS[i % 3]};color:#fff;align-items:center;justify-content:center;font-size:12px;">${i + 1}</span>`,
        offset: [-11, -11],
      }))
    })
    if (path.length > 1) {
      map.add(new ns.Polyline({ path, strokeColor: '#bb3a2c', strokeWeight: 4, strokeOpacity: 0.85 }))
    }
    map.setFitView()
    return () => map.destroy()
  }, [status, AMap, route, candidates])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <div data-amap-container ref={elRef} className="h-full w-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-base)] text-center text-[13px] text-[var(--ink-soft)]">
          {status === 'missing-key'
            ? '地图未配置:缺少高德 JS API key,请在 .env.local 设置 VITE_AMAP_JS_KEY。'
            : status === 'error'
              ? '地图加载失败,请检查 JS key 域名白名单与安全密钥。'
              : '地图加载中…'}
        </div>
      )}
    </div>
  )
}
