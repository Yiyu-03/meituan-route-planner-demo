import type { Constraints, Route, ScoredPOI } from '../../contract/index'
import type { Persona } from './types'
import { materializeRoute } from './build'
import { validateRoute } from './validate'

export interface RepairLog {
  round: number
  trigger: string
  action: string
  before: string
  after: string
  resolved: boolean
}

function price(p: ScoredPOI): number { return p.poi.perCapita ?? 0 }
function durOf(p: ScoredPOI): number { return (p.poi as any).avgDuration ?? 60 }

function rebuild(picks: ScoredPOI[], c: Constraints, persona: Persona, seq: number): Route {
  const route = materializeRoute(picks, c, persona, seq)
  return { ...route, checks: validateRoute(route, c, persona) }
}

function names(route: Route): string {
  return route.stops.map((s) => s.poi.name).join(' → ')
}

function mealRequested(c: Constraints): boolean {
  return /吃饭|午饭|午餐|晚饭|晚餐|正餐|美食/.test(c.raw) || c.mustCategories.includes('dining')
}

function replacementPool(route: Route, allScored: ScoredPOI[], cat: string): ScoredPOI[] {
  const used = new Set(route.stops.map((s) => s.poi.id))
  return allScored.filter((s) => s.poi.category === cat && !used.has(s.poi.id))
}

function canDropStop(picks: ScoredPOI[], idx: number, c: Constraints): boolean {
  const stop = picks[idx]
  const minStops = c.pace === 'relaxed' && c.durationMin <= 180 ? 2 : 3
  if (picks.length <= minStops) return false
  if (stop.poi.category === 'dining' && mealRequested(c)) return false
  const remaining = picks.filter((_, i) => i !== idx)
  for (const cat of c.mustCategories) {
    if (!remaining.some((p) => p.poi.category === cat)) return false
  }
  return true
}

function openAtSlot(route: Route, idx: number, cand: ScoredPOI): boolean {
  const arrive = route.stops[idx]?.arrive
  if (arrive == null) return true
  const open = cand.poi.openHour ?? 0
  const close = cand.poi.closeHour ?? 24
  return arrive >= open - 0.01 && arrive + durOf(cand) / 60 <= close + 0.01
}

export function repairIfNeeded(
  route: Route, constraints: Constraints, persona: Persona, allScored: ScoredPOI[],
): { route: Route; logs: RepairLog[] } {
  let current = route
  const logs: RepairLog[] = []
  const maxRounds = constraints.budgetPerCapita != null ? 5 : 2

  for (let round = 1; round <= maxRounds; round++) {
    const budgetIssue = constraints.budgetPerCapita != null && current.totalCost > constraints.budgetPerCapita
      ? current.checks.find((k) => k.key === 'budget')
      : undefined
    const issue = budgetIssue ?? current.checks.find((k) => k.status === 'fail')
    if (!issue) break

    const before = names(current)
    let picks = current.stops.map((s) => ({
      poi: s.poi, score: 0, reasons: s.reasons, sources: s.sources,
    })) as ScoredPOI[]
    // restore real scores/avgDuration from the pool where possible
    picks = picks.map((p) => allScored.find((s) => s.poi.id === p.poi.id) ?? p)
    let action = ''

    if (issue.key === 'budget') {
      const sortedByPrice = picks.map((pick, idx) => ({ pick, idx })).sort((a, b) => price(b.pick) - price(a.pick))
      let patch: { idx: number; old: ScoredPOI; repl?: ScoredPOI; mode: 'same' | 'drop' } | null = null
      for (const { pick, idx } of sortedByPrice) {
        const repl = replacementPool(current, allScored, pick.poi.category)
          .filter((s) => price(s) < price(pick) && openAtSlot(current, idx, s))
          .sort((a, b) => price(a) - price(b) || b.score - a.score)[0]
        if (repl) { patch = { idx, old: pick, repl, mode: 'same' }; break }
      }
      if (!patch) {
        const drop = sortedByPrice.find(({ idx }) => canDropStop(picks, idx, constraints))
        if (drop) patch = { idx: drop.idx, old: drop.pick, mode: 'drop' }
      }
      if (!patch) {
        logs.push({ round, trigger: issue.label, action: '该区域内已无更低价候选，建议提高预算或减少站点', before, after: before, resolved: false })
        break
      }
      if (patch.mode === 'drop') {
        picks = picks.filter((_, idx) => idx !== patch!.idx)
        action = `预算超限，移除非必要站「${patch.old.poi.name}」`
      } else if (patch.repl) {
        picks[patch.idx] = patch.repl
        action = `预算超限，将「${patch.old.poi.name}」换成更低价「${patch.repl.poi.name}」`
      }
    } else if (issue.key === 'open') {
      const victim = current.stops.find((s) => issue.detail.includes(s.poi.name))
      if (!victim) break
      const idx = current.stops.findIndex((s) => s.poi.id === victim.poi.id)
      const arrive = victim.arrive
      const repl = replacementPool(current, allScored, victim.poi.category)
        .filter((s) => arrive >= (s.poi.openHour ?? 0) && arrive + durOf(s) / 60 <= (s.poi.closeHour ?? 24))
        .sort((a, b) => b.score - a.score)[0]
      if (!repl) { logs.push({ round, trigger: issue.label, action: '未找到营业时间匹配的同类候选', before, after: before, resolved: false }); break }
      picks[idx] = repl
      action = `营业时间冲突，将「${victim.poi.name}」替换为同类可营业的「${repl.poi.name}」`
    } else if (issue.key === 'count') {
      const used = new Set(picks.map((s) => s.poi.id))
      const add = allScored.find((s) => !used.has(s.poi.id))
      if (!add) break
      picks.push(add)
      action = `POI 数不足，补入高分候选「${add.poi.name}」`
    } else {
      logs.push({ round, trigger: issue.label, action: '保留路线，交给用户局部调整', before, after: before, resolved: false })
      break
    }

    current = rebuild(picks, constraints, persona, round)
    const after = names(current)
    const resolved = !current.checks.some((k) => k.key === issue.key && k.status !== 'pass')
    logs.push({ round, trigger: issue.label, action, before, after, resolved })
  }

  return { route: current, logs }
}
