import { describe, it, expect } from 'vitest'
import { parseEditIntent, parseEditIntentLLM, keywordsForEdit } from './replan.js'
import type { Route, RouteStop, POI } from '../../contract/index.js'

function poi(over: Partial<POI>): POI {
  return {
    id: 'p', name: '店', category: 'cafe', city: '上海', area: '静安区',
    lat: 31.22, lng: 121.44, rating: 4.5, perCapita: 70, tags: [],
    openHour: 9, closeHour: 22, photos: [], tel: null, source: 'amap', ...over,
  }
}

function stop(p: Partial<POI>): RouteStop {
  return { poi: poi(p), arrive: 14, depart: 15, legFromPrev: null, reasons: [], sources: {} }
}

const prev: Route = {
  id: 'route-0',
  stops: [
    stop({ id: 'cafe1', category: 'cafe', name: '咖啡馆' }),
    stop({ id: 'dine1', category: 'dining', name: '本帮菜', perCapita: 200 }),
    stop({ id: 'cult1', category: 'culture', name: '美术馆', perCapita: 0 }),
  ],
  totalCost: 270, totalWalkMin: 10, totalTransitMin: 0, endTime: 18,
  coverage: ['cafe', 'dining', 'culture'], checks: [], explanation: '', risks: [],
}

describe('parseEditIntent', () => {
  it('ordinal + cheaper → op cheaper at targetIndex 1', () => {
    const op = parseEditIntent('第二家换便宜点的', prev)
    expect(op.op).toBe('cheaper')
    expect(op.targetIndex).toBe(1)
  })

  it('第3站换近一点 → closer at index 2', () => {
    const op = parseEditIntent('第3站换近一点', prev)
    expect(op.op).toBe('closer')
    expect(op.targetIndex).toBe(2)
  })

  it('最后一家 → targetIndex last', () => {
    const op = parseEditIntent('最后一家换个评分更高的', prev)
    expect(op.op).toBe('higher_rated')
    expect(op.targetIndex).toBe(2)
  })

  it('category remove: 把咖啡那站去掉 → remove cafe', () => {
    const op = parseEditIntent('把咖啡那站去掉', prev)
    expect(op.op).toBe('remove')
    expect(op.targetCategory).toBe('cafe')
    expect(op.targetIndex).toBe(0)
  })

  it('删掉 verb → remove', () => {
    const op = parseEditIntent('删掉美术馆那站', prev)
    expect(op.op).toBe('remove')
    expect(op.targetCategory).toBe('culture')
    expect(op.targetIndex).toBe(2)
  })

  it('rebudget: 整体预算降到200 → rebudget newBudget 200', () => {
    const op = parseEditIntent('整体预算降到200', prev)
    expect(op.op).toBe('rebudget')
    expect(op.newBudget).toBe(200)
  })

  it('换一家评分更高的餐厅 → higher_rated dining', () => {
    const op = parseEditIntent('换一家评分更高的餐厅', prev)
    expect(op.op).toBe('higher_rated')
    expect(op.targetCategory).toBe('dining')
    expect(op.targetIndex).toBe(1)
  })

  it('换便宜的餐厅 → cheaper dining', () => {
    const op = parseEditIntent('餐厅换便宜的', prev)
    expect(op.op).toBe('cheaper')
    expect(op.targetCategory).toBe('dining')
    expect(op.targetIndex).toBe(1)
  })

  it('add: 加一个适合拍照的咖啡 → add cafe', () => {
    const op = parseEditIntent('再加一家咖啡', prev)
    expect(op.op).toBe('add')
    expect(op.targetCategory).toBe('cafe')
  })

  it('swap: 第二家换一家 (no criterion) → swap', () => {
    const op = parseEditIntent('第二家换一家', prev)
    expect(op.op).toBe('swap')
    expect(op.targetIndex).toBe(1)
  })

  it('generic 便宜点 with no target → cheaper, no targetIndex', () => {
    const op = parseEditIntent('整体便宜点', prev)
    expect(op.op).toBe('cheaper')
    expect(op.targetIndex).toBeUndefined()
  })

  it('unrecognized → swap fallback with no target (best-effort)', () => {
    const op = parseEditIntent('随便改改', prev)
    expect(op.op).toBe('swap')
  })
})

describe('parseEditIntentLLM', () => {
  it('returns the rule result when no LLM dep is injected', async () => {
    const op = await parseEditIntentLLM('第二家换便宜点的', prev)
    expect(op.op).toBe('cheaper')
    expect(op.targetIndex).toBe(1)
  })

  it('falls back to rules when the LLM returns null', async () => {
    const op = await parseEditIntentLLM('第二家换便宜点的', prev, { chatJson: async () => null })
    expect(op.op).toBe('cheaper')
    expect(op.targetIndex).toBe(1)
  })

  it('falls back to rules when the LLM throws', async () => {
    const op = await parseEditIntentLLM('第二家换便宜点的', prev, { chatJson: async () => { throw new Error('boom') } })
    expect(op.op).toBe('cheaper')
    expect(op.targetIndex).toBe(1)
  })

  it('lets a valid LLM result fill a gap the rules left unresolved', async () => {
    // ambiguous instruction → rules give swap w/ no target; LLM resolves index 2
    const op = await parseEditIntentLLM('随便改改', prev, {
      chatJson: async () => ({ op: 'higher_rated', targetIndex: 2, targetCategory: 'culture', newBudget: null }),
    })
    expect(op.op).toBe('higher_rated')
    expect(op.targetIndex).toBe(2)
    expect(op.targetCategory).toBe('culture')
  })

  it('ignores invalid LLM fields and keeps the rule values', async () => {
    const op = await parseEditIntentLLM('第二家换便宜点的', prev, {
      chatJson: async () => ({ op: 'nonsense', targetIndex: 99, targetCategory: 'bogus' }),
    })
    expect(op.op).toBe('cheaper')
    expect(op.targetIndex).toBe(1)
  })

  it('never downgrades a stated criterion (便宜) into a plain swap', async () => {
    // The LLM gap-filler must not erase the user's explicit "更便宜" → swap would pick a pricier place.
    const op = await parseEditIntentLLM('第二家换便宜点的', prev, {
      chatJson: async () => ({ op: 'swap', targetIndex: 1, targetCategory: null, newBudget: null }),
    })
    expect(op.op).toBe('cheaper')
    expect(op.targetIndex).toBe(1)
  })

  it('still lets the LLM swap one criterion for another', async () => {
    // 便宜 → 评分更高 is a real reinterpretation, not a downgrade, so it is allowed.
    const op = await parseEditIntentLLM('第二家换便宜点的', prev, {
      chatJson: async () => ({ op: 'higher_rated', targetIndex: 1, targetCategory: null, newBudget: null }),
    })
    expect(op.op).toBe('higher_rated')
  })
})

describe('keywordsForEdit', () => {
  const hotpotPlan: Route = {
    ...prev,
    stops: [
      stop({ id: 'h1', category: 'dining', name: '龙户人家串串香', area: '锦江区', perCapita: 82 }),
      stop({ id: 'c1', category: 'cafe', name: '星巴克', area: '锦江区' }),
    ],
  }

  it('keeps the sub-type (火锅/串串香) when replacing a concrete dining stop', () => {
    const kws = keywordsForEdit({ op: 'cheaper', targetIndex: 0, raw: '第一站换便宜的' }, hotpotPlan)
    expect(kws.some((k) => k.includes('串串香'))).toBe(true)
    // does not collapse to a bare generic 餐厅-only search
    expect(kws[0]).toContain('串串香')
  })

  it('falls back to generic category keywords when no sub-type is detectable', () => {
    const plainPlan: Route = { ...prev, stops: [stop({ id: 'd', category: 'dining', name: '某某馆子', area: '静安区' }), stop({ id: 'c', category: 'cafe', name: '咖啡' })] }
    const kws = keywordsForEdit({ op: 'cheaper', targetIndex: 0, raw: 'x' }, plainPlan)
    expect(kws.some((k) => k.includes('餐厅') || k.includes('美食'))).toBe(true)
  })
})
