import { useEffect, useRef } from 'react'
import type { Route, ScoredPOI } from '../../contract'
import { useAmap } from './AmapProvider'

const MARKER_COLORS = ['#241f17', '#bb3a2c', '#5e7757']
const SHANGHAI: [number, number] = [121.4737, 31.2304]

/** Minimal shape of the AMap globals we use; kept local to avoid an SDK type dep. */
interface AMapMap {
  add: (overlay: unknown) => void
  setFitView: (overlays?: unknown, immediately?: boolean, avoid?: number[], maxZoom?: number) => void
  setZoomAndCenter: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void
  destroy: () => void
  on: (event: string, cb: () => void) => void
}
interface AMapNS {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => AMapMap
  Marker: new (opts: Record<string, unknown>) => unknown
  Polyline: new (opts: Record<string, unknown>) => unknown
  CircleMarker: new (opts: Record<string, unknown>) => unknown
}

export function RouteMap({
  route, candidates, activeIndex = null,
}: { route: Route; candidates: ScoredPOI[]; activeIndex?: number | null }) {
  const { status, AMap } = useAmap()
  const elRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMapMap | null>(null)

  // Build the map + overlays whenever the plan changes.
  useEffect(() => {
    if (status !== 'ready' || !AMap || !elRef.current) return
    const ns = AMap as AMapNS
    const stops = route.stops
    // Explicit center on the route (first stop), so the map never drifts to a default city.
    const center: [number, number] = stops.length ? [stops[0].poi.lng, stops[0].poi.lat] : SHANGHAI
    const map = new ns.Map(elRef.current, { zoom: 14, center, viewMode: '2D' })
    mapRef.current = map

    const overlays: unknown[] = []
    for (const c of candidates) {
      const cm = new ns.CircleMarker({
        center: [c.poi.lng, c.poi.lat], radius: 5,
        fillColor: '#bd7c22', fillOpacity: 0.5, strokeWeight: 0,
      })
      map.add(cm); overlays.push(cm)
    }
    stops.forEach((stop, i) => {
      const m = new ns.Marker({
        position: [stop.poi.lng, stop.poi.lat],
        content: `<span style="display:inline-flex;width:22px;height:22px;border-radius:50%;background:${MARKER_COLORS[i % 3]};color:#fff;align-items:center;justify-content:center;font-size:12px;">${i + 1}</span>`,
        offset: [-11, -11],
      })
      map.add(m); overlays.push(m)
    })
    const path = stops.map((s) => [s.poi.lng, s.poi.lat]) as [number, number][]
    if (path.length > 1) {
      const pl = new ns.Polyline({ path, strokeColor: '#bb3a2c', strokeWeight: 4, strokeOpacity: 0.85 })
      map.add(pl); overlays.push(pl)
    }
    // Fit to the route once tiles are ready (setFitView before 'complete' can be ignored).
    const fit = () => { if (overlays.length) map.setFitView(overlays, true, [48, 48, 48, 48]) }
    map.on('complete', fit)
    fit()

    return () => { map.destroy(); mapRef.current = null }
  }, [status, AMap, route, candidates])

  // Re-center on a stop when its card is selected — works even after the user pans away.
  useEffect(() => {
    const map = mapRef.current
    if (!map || activeIndex == null) return
    const stop = route.stops[activeIndex]
    if (!stop) return
    map.setZoomAndCenter(16, [stop.poi.lng, stop.poi.lat], false, 400)
  }, [activeIndex, route])

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
