import { useCallback, useEffect, useState } from 'react'
import { FilePlus2, NotebookPen } from 'lucide-react'
import { listHistory, getHistory, type HistoryListItem, type HistoryRecord } from '../api/history'

/** 把 ISO 时间戳显示成手帐里好读的「6月1日」。 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 每张便签轻微错开旋转，营造纸张层叠手感(确定性,避免每次渲染抖动)。 */
function tiltFor(index: number): string {
  const tilts = ['-1.4deg', '0.8deg', '-0.6deg', '1.2deg']
  return tilts[index % tilts.length]
}

export function PlanShelf({ onLoad, onNew, reloadKey = 0 }: {
  /** 载入某条历史方案到主视图(可继续 refine)。 */
  onLoad: (record: HistoryRecord) => void
  /** 开新一页:清空回到初始输入态。 */
  onNew: () => void
  /** 变更时强制重新拉取历史(例如刚落库一条新方案)。 */
  reloadKey?: number
}) {
  const [items, setItems] = useState<HistoryListItem[] | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listHistory()
      .then((list) => { if (alive) setItems(list) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [reloadKey])

  const open = useCallback(async (id: string) => {
    setLoadingId(id)
    try {
      const record = await getHistory(id)
      onLoad(record)
    } catch {
      /* 静默失败:保持当前视图,用户可重试 */
    } finally {
      setLoadingId(null)
    }
  }, [onLoad])

  const empty = items !== null && items.length === 0

  return (
    <aside className="paper-card flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="hand inline-flex items-center gap-1.5 text-[15px] text-[var(--ink)]">
          <NotebookPen size={16} strokeWidth={1.7} aria-hidden />
          手帐便签墙
        </span>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--cinnabar)] px-2.5 py-1 text-[12px] text-[var(--cinnabar)] hover:bg-[var(--cinnabar)] hover:text-white"
        >
          <FilePlus2 size={14} strokeWidth={1.7} aria-hidden />
          开新一页
        </button>
      </div>

      {items === null ? (
        <p className="px-1 py-6 text-center text-[12px] text-[var(--ink-soft)]">翻看手帐中…</p>
      ) : empty ? (
        <div className="paper-card mx-auto mt-2 max-w-[16rem] bg-[var(--paper-base)] p-5 text-center">
          <p className="hand text-[14px] text-[var(--ink)]">还没有规划记录</p>
          <p className="mt-1.5 text-[12px] leading-6 text-[var(--ink-soft)]">写下第一次出门吧</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5 overflow-y-auto pr-0.5">
          {items.map((item, index) => (
            <li key={item.planId} style={{ transform: `rotate(${tiltFor(index)})` }}>
              <button
                type="button"
                onClick={() => open(item.planId)}
                disabled={loadingId === item.planId}
                className="relative block w-full rounded-md border border-[var(--hairline)] bg-[var(--paper-card)] py-2.5 pl-4 pr-3 text-left shadow-[var(--shadow-stamp)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {/* 朱砂书签条 */}
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-1.5 rounded-l-md bg-[var(--cinnabar)]"
                />
                {/* 横格纸纹 */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-md opacity-60"
                  style={{
                    backgroundImage:
                      'linear-gradient(transparent 21px, rgba(36,31,23,0.08) 22px)',
                    backgroundSize: '100% 22px',
                  }}
                />
                <span className="relative block hand truncate text-[13.5px] text-[var(--ink)]">
                  {item.request}
                </span>
                <span className="relative mt-1 block latin text-[12px] text-[var(--ink-soft)]">
                  {formatDate(item.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
