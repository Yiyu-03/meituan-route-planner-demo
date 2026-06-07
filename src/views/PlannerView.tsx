import { useEffect, useRef, useState } from 'react'
import type { Identity } from '../api/auth'
import type { PlanRequest, Route } from '../../contract'
import { usePlanStream } from '../hooks/usePlanStream'
import { InputBar, type InputSubmit } from '../components/InputBar'
import { ProgressTrail } from '../components/ProgressTrail'
import { PlanSummary } from '../components/PlanSummary'
import { Itinerary } from '../components/Itinerary'
import { WhyDrawer } from '../components/WhyDrawer'
import { EmptyState } from '../components/EmptyState'
import { AccountMenu } from '../components/AccountMenu'
import { PlanShelf } from '../components/PlanShelf'
import { RefineBar } from '../components/RefineBar'
import { AmapProvider } from '../map/AmapProvider'
import { RouteMap } from '../map/RouteMap'
import { BrandStamp } from '../design/icons'
import { NotebookText, X } from 'lucide-react'
import type { HistoryRecord } from '../api/history'

const EMPTY_ROUTE: Route = {
  id: 'empty', stops: [], totalCost: 0, totalWalkMin: 0, totalTransitMin: 0,
  endTime: 0, coverage: [], checks: [], explanation: '', risks: [],
}

export function PlannerView({ identity, onLogout, fixtureOverride }: {
  identity: Identity
  onLogout: () => void
  /** test-only: force a specific offline fixture. */
  fixtureOverride?: string
}) {
  const { state, run, loadPlan, reset } = usePlanStream()
  const [lastRequest, setLastRequest] = useState('')
  const [shelfKey, setShelfKey] = useState(0)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const prevPlanId = useRef<string | null>(null)

  // Clear the focused stop whenever the route changes (new plan / replan / loaded).
  useEffect(() => { setActiveIndex(null) }, [state.route])

  // When a new plan finishes streaming and is persisted, refresh the shelf.
  useEffect(() => {
    if (state.planId && state.planId !== prevPlanId.current) {
      prevPlanId.current = state.planId
      setShelfKey((k) => k + 1)
    }
  }, [state.planId])

  const submit = (value: InputSubmit) => {
    setLastRequest(value.request)
    const request: PlanRequest = {
      request: value.request,
      preferences: value.preferences,
      previousPlan: state.route,
    }
    run(request, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  const clarifyCity = (city: string) => {
    const request: PlanRequest = {
      request: `城市：${city}，${lastRequest}`,
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: null,
    }
    run(request, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  const refine = (request: string) => {
    if (!state.route) return
    const payload: PlanRequest = {
      request,
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: state.route,
    }
    run(payload, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  const loadFromShelf = (record: HistoryRecord) => {
    const route = record.routes[0]
    if (!route) return
    prevPlanId.current = record.planId
    loadPlan({
      planId: record.planId,
      route,
      constraints: record.constraints,
      dataSources: record.dataSources,
    })
    setShelfOpen(false)
  }

  const newPage = () => {
    prevPlanId.current = null
    reset()
    setLastRequest('')
    setShelfOpen(false)
  }

  const routeExplanation = state.route ? (state.explanations[state.route.id] ?? '') : ''

  return (
    <AmapProvider>
      <div className="paper-surface min-h-screen">
        <header className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShelfOpen(true)}
              aria-label="打开便签墙"
              className="rounded p-1 text-[var(--ink-soft)] hover:text-[var(--ink)] lg:hidden"
            >
              <NotebookText size={18} strokeWidth={1.7} aria-hidden />
            </button>
            <BrandStamp />
          </div>
          <AccountMenu identity={identity} onLogout={onLogout} onOpenHistory={() => setShelfOpen(true)} />
        </header>

        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-4 lg:px-4">
          {/* 桌面:左侧便签墙 */}
          <div className="hidden lg:block lg:h-[calc(100vh-72px)]">
            <PlanShelf onLoad={loadFromShelf} onNew={newPage} reloadKey={shelfKey} />
          </div>

          {/* 移动端:抽屉 */}
          {shelfOpen && (
            <div className="fixed inset-0 z-30 lg:hidden">
              <button
                type="button"
                aria-label="关闭便签墙"
                onClick={() => setShelfOpen(false)}
                className="absolute inset-0 bg-[rgba(36,31,23,0.4)]"
              />
              <div className="absolute left-0 top-0 h-full w-[82%] max-w-[320px] p-3">
                <div className="relative h-full">
                  <button
                    type="button"
                    aria-label="关闭"
                    onClick={() => setShelfOpen(false)}
                    className="absolute -right-1 -top-1 z-10 rounded-full bg-[var(--ink)] p-1 text-white"
                  >
                    <X size={14} strokeWidth={2} aria-hidden />
                  </button>
                  <PlanShelf onLoad={loadFromShelf} onNew={newPage} reloadKey={shelfKey} />
                </div>
              </div>
            </div>
          )}

          <div className="min-w-0">
            <div className="px-4 lg:px-0">
              <InputBar onSubmit={submit} busy={state.streaming} />
              <div className="mt-2"><ProgressTrail stages={state.stages} /></div>
            </div>

            <main className="grid gap-4 px-4 py-4 lg:px-0 xl:grid-cols-[minmax(0,1fr)_400px]">
              <section className="h-[320px] xl:h-[calc(100vh-220px)]">
                <RouteMap route={state.route ?? EMPTY_ROUTE} candidates={state.candidates} activeIndex={activeIndex} />
              </section>

              <section className="space-y-3">
                {state.error ? (
                  <EmptyState error={state.error} onClarifyCity={clarifyCity} />
                ) : state.route ? (
                  <>
                    {state.constraints && <PlanSummary route={state.route} constraints={state.constraints} />}
                    <Itinerary route={state.route} explanation={routeExplanation} activeIndex={activeIndex} onSelect={setActiveIndex} />
                    {state.constraints && (
                      <WhyDrawer route={state.route} constraints={state.constraints} dataSources={state.dataSources} />
                    )}
                    <RefineBar onRefine={refine} busy={state.streaming} />
                  </>
                ) : (
                  <p className="paper-card p-6 text-center text-[13px] text-[var(--ink-soft)]">
                    写下这次出门的想法,生成你的路线手帐。
                  </p>
                )}
              </section>
            </main>
          </div>
        </div>
      </div>
    </AmapProvider>
  )
}
