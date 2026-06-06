import { describe, it, expect } from 'vitest'
import { toEnrichedPOI, parseOpenHours, deriveSceneTags } from './poiFeatures'

const v5Poi = {
  id: 'B0LBRRKLFC',
  name: '看得到风景的咖啡馆',
  type: '餐饮服务;咖啡厅;咖啡厅',
  location: '121.443,31.224',
  cityname: '上海市', adname: '静安区',
  business: { rating: '4.5', cost: '78', opentime_today: '09:00-20:00', tag: '安静,拍照,环境好', tel: '021-12345678' },
  photos: [{ url: 'https://aos.example/a.jpg' }, { title: '门面', url: 'https://aos.example/b.jpg' }],
}

describe('parseOpenHours', () => {
  it('parses a HH:MM-HH:MM window', () => {
    expect(parseOpenHours('09:00-20:00')).toEqual({ openHour: 9, closeHour: 20 })
  })
  it('returns nulls for an unparseable string', () => {
    expect(parseOpenHours('详见门店')).toEqual({ openHour: null, closeHour: null })
  })
})

describe('deriveSceneTags', () => {
  it('maps amap tag tokens to scene tags', () => {
    const tags = deriveSceneTags('安静,拍照,网红', 'cafe')
    expect(tags).toContain('quiet')
    expect(tags).toContain('photo')
    expect(tags).toContain('trendy')
  })
})

describe('toEnrichedPOI', () => {
  it('uses real business fields and never invents reviews/queue', () => {
    const poi = toEnrichedPOI(v5Poi, '上海', '静安区')!
    expect(poi.rating).toBe(4.5)
    expect(poi.perCapita).toBe(78)
    expect(poi.openHour).toBe(9)
    expect(poi.tel).toBe('021-12345678')
    expect(poi.photos.length).toBe(2)
    expect(poi.source).toBe('amap')
    expect(poi.category).toBe('cafe')
    expect((poi as Record<string, unknown>).reviews).toBeUndefined()
    expect((poi as Record<string, unknown>).queueBase).toBeUndefined()
  })

  it('leaves missing fields null/empty, no fabrication', () => {
    const bare = { id: 'X', name: '某店', type: '餐饮服务;中餐厅', location: '121.4,31.2', cityname: '上海市', adname: '静安区' }
    const poi = toEnrichedPOI(bare, '上海', '静安区')!
    expect(poi.rating).toBeNull()
    expect(poi.perCapita).toBeNull()
    expect(poi.openHour).toBeNull()
    expect(poi.tel).toBeNull()
    expect(poi.photos).toEqual([])
  })

  it('rejects a POI with no parseable location', () => {
    expect(toEnrichedPOI({ id: 'X', name: 'n', type: 't', location: '' }, '上海', null)).toBeNull()
  })
})
