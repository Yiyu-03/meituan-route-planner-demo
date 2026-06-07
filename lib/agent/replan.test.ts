import { describe, it, expect } from 'vitest'
import { parseEditIntent } from './replan'
import type { Route, RouteStop, POI } from '../../contract/index'

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
