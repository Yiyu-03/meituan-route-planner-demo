import type { Constraints, Route } from '../../../contract/index'
import type { Persona } from './types'
import { checkSummary } from './validate'

/** Composite rank: avg quality proxy (via checks) + pace fit + compactness + budget. Renumbers ids. */
export function rankRoutes(routes: Route[], c: Constraints, persona: Persona): Route[] {
  const scored = routes.map((r) => {
    const sum = checkSummary(r.checks)
    const checkScore = sum.pass * 3 - sum.warn * 4 - sum.fail * 15

    const actualMin = (r.endTime - c.startTime) * 60
    const overrun = actualMin - c.durationMin
    let paceScore = 0
    if (c.pace === 'relaxed') paceScore = -Math.abs(overrun) * 0.05
    else if (c.pace === 'packed') paceScore = overrun >= -30 ? 4 : -4
    else paceScore = -Math.max(0, overrun - 30) * 0.05

    const moveMin = r.totalWalkMin + r.totalTransitMin
    const compactScore = -moveMin * 0.06

    let budgetScore = 0
    if (c.budgetPerCapita != null && c.budgetPerCapita > 0) {
      const ratio = r.totalCost / c.budgetPerCapita
      budgetScore = ratio <= 1 ? 3 : -(ratio - 1) * 38 * (0.8 + persona.budgetSensitivity)
    }

    const rankScore = +(checkScore + paceScore + compactScore + budgetScore).toFixed(1)
    return { route: r, rankScore }
  })

  scored.sort((a, b) => b.rankScore - a.rankScore)
  return scored.map((s, i) => ({ ...s.route, id: `route-${i}` }))
}
