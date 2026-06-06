import { useState } from 'react'
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
import { AmapProvider } from '../map/AmapProvider'
import { RouteMap } from '../map/RouteMap'
import { BrandStamp } from '../design/icons'

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
  const { state, run } = usePlanStream()
  const [lastRequest, setLastRequest] = useState('')

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

  const routeExplanation = state.route ? (state.explanations[state.route.id] ?? '') : ''

  return (
    <AmapProvider>
      <div className="paper-surface min-h-screen">
        <header className="flex items-center justify-between gap-3 px-4 py-3">
          <BrandStamp />
          <AccountMenu identity={identity} onLogout={onLogout} onOpenHistory={() => {}} />
        </header>

        <div className="px-4">
          <InputBar onSubmit={submit} busy={state.streaming} />
          <div className="mt-2"><ProgressTrail stages={state.stages} /></div>
        </div>

        <main className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section className="h-[320px] lg:h-[calc(100vh-220px)]">
            <RouteMap route={state.route ?? EMPTY_ROUTE} candidates={state.candidates} />
          </section>

          <section className="space-y-3">
            {state.error ? (
              <EmptyState error={state.error} onClarifyCity={clarifyCity} />
            ) : state.route ? (
              <>
                {state.constraints && <PlanSummary route={state.route} constraints={state.constraints} />}
                <Itinerary route={state.route} explanation={routeExplanation} />
                {state.constraints && (
                  <WhyDrawer route={state.route} constraints={state.constraints} dataSources={state.dataSources} />
                )}
              </>
            ) : (
              <p className="paper-card p-6 text-center text-[13px] text-[var(--ink-soft)]">
                写下这次出门的想法,生成你的路线手帐。
              </p>
            )}
          </section>
        </main>
      </div>
    </AmapProvider>
  )
}
