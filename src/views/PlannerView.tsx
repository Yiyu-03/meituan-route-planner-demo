import { useEffect, useRef, useState } from 'react'
import type { Identity } from '../api/auth'
import type { PlanRequest, Route } from '../../contract'
import { usePlanStream } from '../hooks/usePlanStream'
import { InputBar, type InputSubmit } from '../components/InputBar'
import { ProgressTrail } from '../components/ProgressTrail'
import { AgentThinking } from '../components/AgentThinking'
import { AgentQuestion } from '../components/AgentQuestion'
import { PlanSummary } from '../components/PlanSummary'
import { Itinerary } from '../components/Itinerary'
import { TripInsights } from '../components/TripInsights'
import { JournalCard } from '../components/JournalCard'
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
  const { state, run, answer, loadPlan, reset } = usePlanStream()
  const [lastRequest, setLastRequest] = useState('')
  const [prompt, setPrompt] = useState('')
  const [thinkMode, setThinkMode] = useState<'plan' | 'refine'>('plan')
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
    setThinkMode('plan')
    const request: PlanRequest = {
      request: value.request,
      preferences: value.preferences,
      previousPlan: null, // 生成路线 = 全新规划;基于已有方案的修改走 RefineBar(refine)
    }
    run(request, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  const clarifyCity = (city: string) => {
    setThinkMode('plan')
    const request: PlanRequest = {
      request: `城市：${city}，${lastRequest}`,
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: null,
    }
    run(request, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  // The route being refined — held in a ref so a clarify round-trip (which restarts the stream and
  // clears state.route) can still re-refine against the right plan.
  const refineBase = useRef<Route | null>(null)

  const refine = (request: string) => {
    const base = state.route ?? refineBase.current
    if (!base) return
    refineBase.current = base
    setThinkMode('refine')
    const payload: PlanRequest = {
      request,
      preferences: { personaPick: 'auto', prefs: [], budgetPref: null },
      previousPlan: base,
      baseRequest: lastRequest, // 把初始 query 一起给后端,LLM 才有完整意图上下文
    }
    run(payload, fixtureOverride ? { fixture: fixtureOverride } : undefined)
  }

  // Answering an agent question: during a refine, the answer IS the clarified edit → re-refine;
  // otherwise resume the ReAct conversation.
  const onAnswer = (text: string) => {
    if (thinkMode === 'refine') refine(text)
    else answer(text)
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
    // reflect the loaded plan's original query in the input box
    setPrompt(record.request)
    setLastRequest(record.request)
    setShelfOpen(false)
  }

  const newPage = () => {
    prevPlanId.current = null
    reset()
    setPrompt('')
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
              <InputBar onSubmit={submit} busy={state.streaming} value={prompt} onValueChange={setPrompt} />
              <div className="mt-2"><ProgressTrail stages={state.stages} /></div>
            </div>

            <main className="grid gap-4 px-4 py-4 lg:px-0 xl:grid-cols-[minmax(0,1fr)_400px]">
              {/* 左列:地图 + (有方案时)桌面端在地图下方填充洞察/手帐卡 */}
              <div className="flex min-w-0 flex-col gap-4">
                <section className="h-[320px] xl:h-[calc(100vh-220px)]">
                  <RouteMap route={state.route ?? EMPTY_ROUTE} candidates={state.candidates} activeIndex={activeIndex} />
                </section>
                {state.route && state.constraints && (
                  <div className="hidden space-y-4 xl:block">
                    <TripInsights route={state.route} constraints={state.constraints} />
                    <JournalCard route={state.route} constraints={state.constraints} />
                  </div>
                )}
              </div>

              <section className="space-y-3">
                {/* 思考流:规划中实时展开;有方案后折叠备查 */}
                {state.thinking.length > 0 && (
                  <AgentThinking steps={state.thinking} streaming={state.streaming} variant={thinkMode} />
                )}

                {/* 反问:agent 在等用户回答,朱砂高亮 */}
                {state.question && (
                  <AgentQuestion question={state.question} onAnswer={onAnswer} />
                )}

                {state.error ? (
                  <EmptyState error={state.error} onClarifyCity={clarifyCity} />
                ) : state.route ? (
                  <>
                    {state.constraints && <PlanSummary route={state.route} constraints={state.constraints} />}
                    <Itinerary route={state.route} explanation={routeExplanation} activeIndex={activeIndex} onSelect={setActiveIndex} />
                    {state.constraints && (
                      <WhyDrawer route={state.route} constraints={state.constraints} dataSources={state.dataSources} />
                    )}
                    {/* 移动/中屏:桌面卡在左列地图下,这里仅在 < xl 堆叠呈现 */}
                    {state.constraints && (
                      <div className="space-y-3 xl:hidden">
                        <TripInsights route={state.route} constraints={state.constraints} />
                        <JournalCard route={state.route} constraints={state.constraints} />
                      </div>
                    )}
                    <RefineBar onRefine={refine} busy={state.streaming} />
                  </>
                ) : !state.streaming && !state.question ? (
                  <p className="paper-card p-6 text-center text-[13px] text-[var(--ink-soft)]">
                    写下这次出门的想法,生成你的路线手帐。
                  </p>
                ) : null}
              </section>
            </main>
          </div>
        </div>
      </div>
    </AmapProvider>
  )
}
