import { useState } from 'react'
import type { Route, Constraints, DataSources, Check } from '../../contract'

const CHECK_TONE: Record<Check['status'], string> = {
  pass: 'text-[var(--sage)]',
  warn: 'text-[var(--amber)]',
  fail: 'text-[var(--cinnabar)]',
}

export function WhyDrawer({ route, constraints, dataSources }: {
  route: Route
  constraints: Constraints
  dataSources: DataSources | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="paper-card p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hand flex w-full items-center justify-between text-[13px]"
      >
        <span>规划依据 · 数据来源</span>
        <span className="latin text-[var(--ink-soft)]">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-[12px] leading-6 text-[var(--ink-soft)]">
          <div>
            <p className="hand text-[var(--ink)]">约束</p>
            <p>
              {constraints.city}{constraints.district ? ` · ${constraints.district}` : ''} ·{' '}
              {constraints.party}人 · 偏好 {constraints.prefs.join('、') || '无'}
            </p>
          </div>
          <div>
            <p className="hand text-[var(--ink)]">体检</p>
            <ul className="space-y-1">
              {route.checks.map((c) => (
                <li key={c.key} className={CHECK_TONE[c.status]}>
                  {c.label}：{c.detail}
                </li>
              ))}
            </ul>
          </div>
          {dataSources && (
            <div>
              <p className="hand text-[var(--ink)]">数据来源</p>
              <p>
                高德 POI {dataSources.amapPoi.status} · 路径 {dataSources.amapRoute.status} ·
                DeepSeek {dataSources.deepseek.status}
              </p>
              <p>缓存命中 {dataSources.cache.hits} · 穿透 {dataSources.cache.misses}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
