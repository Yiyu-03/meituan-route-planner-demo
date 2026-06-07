import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Share2, Loader } from 'lucide-react'
import type { Route, Constraints } from '../../contract'
import { StitchRouteCard } from './StitchRouteCard'

/** Full-screen sheet: previews the stitched 手帐 card and exports it as a shareable PNG. */
export function ShareCardModal({ route, constraints, onClose }: {
  route: Route; constraints: Constraints; onClose: () => void
}) {
  const exportRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const onShare = async () => {
    const node = exportRef.current
    if (!node || busy) return
    setBusy(true); setMsg('正在生成图片…')
    try {
      if (document.fonts?.ready) { try { await document.fonts.ready } catch { /* ignore */ } }
      const { toPng } = await import('html-to-image')
      // skipFonts: the 手帐 webfonts (LXGW 文楷 / Fraunces) live on CORS-less CDNs; trying to inline
      // them makes the export throw. We skip embedding and let the PNG fall back to system CJK serif —
      // the on-screen preview keeps the real fonts. cacheBust avoids stale-CORS image reuse.
      const dataUrl = await toPng(node, { pixelRatio: 3, cacheBust: true, backgroundColor: '#efe7d4', skipFonts: true })
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], `roam-${Date.now()}.png`, { type: 'image/png' })
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void>
      }
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: '漫游·手帐' })
        setMsg('已调起分享 ✓')
      } else {
        const a = document.createElement('a')
        a.href = dataUrl; a.download = file.name; a.click()
        setMsg('已保存到本地 ✓')
      }
    } catch {
      setMsg('生成失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center overflow-auto bg-[rgba(28,24,18,0.62)] px-4 py-8"
      role="dialog" aria-modal="true" aria-label="分享手帐"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <button
        type="button" onClick={onClose} aria-label="关闭"
        className="mb-3 inline-flex items-center gap-1 self-end rounded-full bg-[var(--paper-card)] px-3 py-1.5 text-[13px] text-[var(--ink)] shadow"
      >
        <X size={15} strokeWidth={1.8} aria-hidden /> 关闭
      </button>

      {/* visible, animated preview */}
      <StitchRouteCard route={route} constraints={constraints} animate />

      <div className="mt-4 flex flex-col items-center gap-2">
        <button
          type="button" onClick={onShare} disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--cinnabar)] px-6 py-2.5 text-[14px] text-white shadow-[0_8px_18px_-8px_rgba(187,58,44,0.8)] disabled:opacity-60"
        >
          {busy
            ? (<><Loader size={16} strokeWidth={1.9} className="animate-spin" aria-hidden /> 生成中</>)
            : (<><Share2 size={16} strokeWidth={1.8} aria-hidden /> 保存 / 分享图片</>)}
        </button>
        {msg && <p className="latin text-[12px] text-[rgba(255,255,255,0.85)]">{msg}</p>}
      </div>

      {/* off-screen static export target — always a clean, fully-rendered frame */}
      <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', opacity: 0 }} aria-hidden>
        <StitchRouteCard ref={exportRef} route={route} constraints={constraints} animate={false} />
      </div>
    </div>,
    document.body,
  )
}
