import type { Check, Constraints, Route } from '../../../contract/index'
import type { Persona } from './types'

function fmtH(h: number): string {
  const hh = Math.floor(h) % 24
  const mm = Math.round((h - Math.floor(h)) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const CATEGORY_LABEL: Record<string, string> = {
  dining: '餐饮', cafe: '咖啡', culture: '文化', entertainment: '娱乐', shopping: '购物', nightscape: '夜景',
}

const MAX_LEG_DISTANCE_M = 12000
const MAX_LEG_MINUTES = 45
const MAX_WALK_MINUTES = 25

export function validateRoute(route: Route, c: Constraints, persona: Persona): Check[] {
  const checks: Check[] = []

  // 1) Open hours — skip POIs with unknown (null) hours.
  let openFail = 0, openWarn = 0
  const openDetails: string[] = []
  for (const s of route.stops) {
    const { openHour, closeHour, name } = s.poi
    if (openHour == null || closeHour == null) continue
    if (s.arrive < openHour - 0.01) { openFail++; openDetails.push(`${name} 未开门（${fmtH(openHour)} 营业）`) }
    else if (s.depart > closeHour + 0.01) {
      if (s.arrive < closeHour) { openWarn++; openDetails.push(`${name} 游玩跨越打烊（${fmtH(closeHour)}）`) }
      else { openFail++; openDetails.push(`${name} 已打烊（${fmtH(closeHour)}）`) }
    }
  }
  checks.push({
    key: 'open', label: '营业时间',
    status: openFail ? 'fail' : openWarn ? 'warn' : 'pass',
    detail: openFail || openWarn ? openDetails.join('；') : '全程均在营业时间内（未知营业时间的店未参与判定）',
  })

  // 2) Budget
  if (c.budgetPerCapita != null) {
    const ratio = route.totalCost / c.budgetPerCapita
    let status: Check['status'] = 'pass'
    if (ratio > 1.15) status = 'fail'
    else if (ratio > 1.0) status = 'warn'
    checks.push({
      key: 'budget', label: '预算', status,
      detail: `人均合计 ¥${route.totalCost} / 预算 ¥${c.budgetPerCapita}（${Math.round(ratio * 100)}%）`,
    })
  } else {
    checks.push({ key: 'budget', label: '预算', status: 'pass', detail: `未设预算 · 人均合计 ¥${route.totalCost}` })
  }

  // 3) Mobility
  const mobilityProblems = route.stops
    .filter((s) => {
      const leg = s.legFromPrev
      if (!leg) return false
      if (leg.distM > MAX_LEG_DISTANCE_M) return true
      if (leg.minutes > MAX_LEG_MINUTES) return true
      if (leg.mode === 'walk' && leg.minutes > MAX_WALK_MINUTES) return true
      return false
    })
    .map((s) => `${s.poi.name} 前一段 ${s.legFromPrev!.minutes} 分钟/${(s.legFromPrev!.distM / 1000).toFixed(1)}km`)
  const totalMove = route.totalWalkMin + route.totalTransitMin
  const durMin = Math.max(1, c.durationMin)
  checks.push({
    key: 'mobility', label: '移动距离',
    status: mobilityProblems.length || totalMove >= 100 ? 'fail' : totalMove > Math.min(90, durMin * 0.35) ? 'warn' : 'pass',
    detail: mobilityProblems.length
      ? `移动过长：${mobilityProblems.join('；')}`
      : totalMove >= 100 ? `总移动约 ${totalMove} 分钟，明显不适合作为本地路线`
      : `单段移动可控，总移动约 ${totalMove} 分钟`,
  })

  // 4) Coverage
  const cov = new Set(route.coverage)
  const missMust = c.mustCategories.filter((m) => !cov.has(m))
  checks.push({
    key: 'coverage', label: '类目覆盖',
    status: missMust.length ? 'warn' : cov.size >= 3 ? 'pass' : 'warn',
    detail: missMust.length
      ? `缺少你要求的类目：${missMust.map((m) => CATEGORY_LABEL[m] ?? m).join('、')}`
      : `覆盖 ${[...cov].map((x) => CATEGORY_LABEL[x] ?? x).join('、')}`,
  })

  // 5) Count
  const minStops = c.pace === 'relaxed' && c.durationMin <= 240 ? 2 : 3
  checks.push({
    key: 'count', label: 'POI 数量',
    status: route.stops.length >= minStops ? 'pass' : 'fail',
    detail: `${route.stops.length} 个 POI${route.stops.length >= minStops ? `（满足 ≥${minStops}）` : `（不足 ${minStops} 个）`}`,
  })

  // 6) Schedule window
  const plannedEnd = c.startTime + c.durationMin / 60
  if (route.endTime > plannedEnd + 0.5) {
    checks.push({ key: 'schedule', label: '时间窗口', status: 'fail', detail: `预计 ${fmtH(route.endTime)} 结束，明显超出本次 ${fmtH(plannedEnd)} 左右的时间窗口` })
  } else if (route.endTime > plannedEnd + 0.01) {
    checks.push({ key: 'schedule', label: '时间窗口', status: 'warn', detail: `预计 ${fmtH(route.endTime)} 结束，略超出本次 ${fmtH(plannedEnd)} 左右的时间窗口` })
  }

  return checks
}

export function checkSummary(checks: Check[]): { pass: number; warn: number; fail: number } {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  }
}
