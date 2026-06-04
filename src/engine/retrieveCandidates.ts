import type { POI, Constraints } from '../types';
import { POIS } from '../data/pois';
import { AREA_MAP } from '../data/areas';
import { anchorAreas } from './parseConstraints';
import { haversineM } from './geo';
import {
  hasExplicitFamilyIntent,
  isAdultNightlifePOI,
  isQuietIntent,
  isStrongFamilyPOI,
  wantsAdultNightlife,
  wantsNightView,
} from './semanticGuards';

// ------------------------------------------------------------
// ② retrieveCandidates
// 硬过滤(召回),不打分:
//   - 排除被 avoidCategories 命中的类目
//   - 排除明显规避场景(如不要 nightlife → 去掉夜店类 tag)
//   - 地理就近:以锚定区域为圆心,扩到一定半径,粗筛掉太远的点
// 召回后规模应远小于全量(为下游打分/组合服务),但保证类目多样。
// ------------------------------------------------------------

const RETRIEVE_RADIUS_M = 3600; // 明确说“附近”时优先收紧到同区/相邻街区,避免路线跑散

const XINJIANG_CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  乌鲁木齐: { lat: 43.8256, lng: 87.6168 },
  喀什: { lat: 39.4704, lng: 75.9898 },
  伊犁: { lat: 43.9219, lng: 81.3179 },
  吐鲁番: { lat: 42.9476, lng: 89.1841 },
  阿勒泰: { lat: 47.8486, lng: 88.1396 },
  库尔勒: { lat: 41.7259, lng: 86.1746 },
  哈密: { lat: 42.8185, lng: 93.5154 },
};

export interface RetrieveResult {
  candidates: POI[];
  centerLat: number;
  centerLng: number;
  note: string;
}

function normalizedXinjiangCity(city: string): string | null {
  if (/喀什/.test(city)) return '喀什';
  if (/伊犁|伊宁/.test(city)) return '伊犁';
  if (/吐鲁番/.test(city)) return '吐鲁番';
  if (/阿勒泰/.test(city)) return '阿勒泰';
  if (/库尔勒/.test(city)) return '库尔勒';
  if (/哈密/.test(city)) return '哈密';
  if (/新疆|乌鲁木齐|乌市/.test(city)) return '乌鲁木齐';
  return null;
}

function cityPoi(
  id: string,
  name: string,
  category: POI['category'],
  area: string,
  lat: number,
  lng: number,
  perCapita: number,
  sceneTags: POI['sceneTags'],
): POI {
  return {
    id,
    name,
    category,
    area,
    lat,
    lng,
    rating: 4.5,
    reviews: 880,
    perCapita,
    openHour: 9,
    closeHour: category === 'nightscape' || category === 'entertainment' ? 24 : 22,
    avgDuration: category === 'dining' ? 70 : category === 'entertainment' ? 75 : category === 'cafe' ? 40 : 65,
    sceneTags,
    ugc: '非上海城市 CLI 诊断兜底点；页面正式规划会优先调用高德 POI 试验链路',
    queueBase: category === 'dining' ? 0.42 : 0.3,
    source: 'mock_map',
    confidence: 0.68,
    freshness: 'static',
  };
}

function xinjiangFallbackPois(city: string): POI[] {
  if (city === '喀什') {
    return [
      cityPoi('diag-kashgar-old-city', '喀什古城', 'culture', '喀什', 39.4704, 75.9898, 35, ['cultural', 'local']),
      cityPoi('diag-kashgar-food', '喀什古城新疆菜馆', 'dining', '喀什', 39.4685, 75.9912, 92, ['local', 'foodie']),
      cityPoi('diag-kashgar-tea', '喀什古城茶饮休息点', 'cafe', '喀什', 39.4698, 75.9878, 36, ['quiet', 'local']),
      cityPoi('diag-kashgar-night', '喀什古城夜景街区', 'nightscape', '喀什', 39.471, 75.99, 0, ['photo', 'local']),
    ];
  }
  if (city === '伊犁') {
    return [
      cityPoi('diag-yili-six-star', '伊宁六星街', 'culture', '伊犁', 43.916, 81.304, 30, ['cultural', 'local']),
      cityPoi('diag-yili-food', '伊宁本地新疆菜馆', 'dining', '伊犁', 43.918, 81.311, 88, ['local', 'foodie']),
      cityPoi('diag-yili-cafe', '伊宁街区咖啡休息点', 'cafe', '伊犁', 43.919, 81.315, 36, ['quiet']),
      cityPoi('diag-yili-evening', '伊宁街区夜游点', 'nightscape', '伊犁', 43.917, 81.306, 0, ['photo', 'local']),
    ];
  }
  if (city === '吐鲁番') {
    return [
      cityPoi('diag-turpan-museum', '吐鲁番博物馆', 'culture', '吐鲁番', 42.943, 89.184, 28, ['cultural']),
      cityPoi('diag-turpan-food', '吐鲁番本地新疆菜馆', 'dining', '吐鲁番', 42.946, 89.186, 86, ['local', 'foodie']),
      cityPoi('diag-turpan-tea', '吐鲁番葡萄茶饮休息点', 'cafe', '吐鲁番', 42.947, 89.188, 34, ['quiet']),
      cityPoi('diag-turpan-night', '吐鲁番夜景休闲点', 'nightscape', '吐鲁番', 42.948, 89.187, 0, ['photo', 'local']),
    ];
  }
  if (city === '阿勒泰') {
    return [
      cityPoi('diag-altay-museum', '阿勒泰地区博物馆', 'culture', '阿勒泰', 47.848, 88.135, 25, ['cultural']),
      cityPoi('diag-altay-food', '阿勒泰本地新疆菜馆', 'dining', '阿勒泰', 47.845, 88.139, 88, ['local', 'foodie']),
      cityPoi('diag-altay-cafe', '阿勒泰街区咖啡休息点', 'cafe', '阿勒泰', 47.846, 88.136, 35, ['quiet']),
      cityPoi('diag-altay-view', '阿勒泰夜景观景点', 'nightscape', '阿勒泰', 47.849, 88.138, 0, ['photo', 'nature']),
    ];
  }
  if (city === '库尔勒') {
    return [
      cityPoi('diag-korla-museum', '巴音郭楞蒙古自治州博物馆', 'culture', '库尔勒', 41.724, 86.174, 25, ['cultural']),
      cityPoi('diag-korla-food', '库尔勒本地新疆菜馆', 'dining', '库尔勒', 41.723, 86.171, 86, ['local', 'foodie']),
      cityPoi('diag-korla-river', '孔雀河风景带', 'culture', '库尔勒', 41.727, 86.18, 0, ['nature', 'quiet']),
      cityPoi('diag-korla-cafe', '库尔勒街区茶饮休息点', 'cafe', '库尔勒', 41.725, 86.176, 34, ['quiet']),
    ];
  }
  if (city === '哈密') {
    return [
      cityPoi('diag-hami-museum', '哈密博物馆', 'culture', '哈密', 42.82, 93.516, 24, ['cultural']),
      cityPoi('diag-hami-food', '哈密本地新疆菜馆', 'dining', '哈密', 42.817, 93.512, 86, ['local', 'foodie']),
      cityPoi('diag-hami-park', '哈密市人民公园', 'culture', '哈密', 42.821, 93.51, 0, ['nature', 'quiet']),
      cityPoi('diag-hami-cafe', '哈密街区茶饮休息点', 'cafe', '哈密', 42.819, 93.514, 33, ['quiet']),
    ];
  }
  return [
    cityPoi('diag-urumqi-museum', '新疆维吾尔自治区博物馆', 'culture', '乌鲁木齐', 43.816, 87.588, 28, ['cultural']),
    cityPoi('diag-urumqi-food', '乌鲁木齐本地新疆菜馆', 'dining', '乌鲁木齐', 43.793, 87.62, 92, ['local', 'foodie']),
    cityPoi('diag-urumqi-bazaar', '新疆国际大巴扎', 'shopping', '乌鲁木齐', 43.785, 87.624, 35, ['local', 'cultural']),
    cityPoi('diag-urumqi-cafe', '大巴扎茶饮休息点', 'cafe', '乌鲁木齐', 43.787, 87.622, 34, ['quiet', 'local']),
    cityPoi('diag-urumqi-night', '红山公园夜景观景点', 'nightscape', '乌鲁木齐', 43.815, 87.607, 0, ['photo', 'nature']),
  ];
}

export function retrieveCandidates(c: Constraints): RetrieveResult {
  const anchors = anchorAreas(c);
  if (c.city === '未指定城市' && !anchors.length) {
    return {
      candidates: [],
      centerLat: 0,
      centerLng: 0,
      note: '未识别到城市或上海区域词,请指定城市或区域后再规划',
    };
  }
  const xinjiangCity = normalizedXinjiangCity(c.city);
  if (xinjiangCity && !anchors.length) {
    const center = XINJIANG_CITY_CENTERS[xinjiangCity];
    const candidates = xinjiangFallbackPois(xinjiangCity);
    return {
      candidates,
      centerLat: center.lat,
      centerLng: center.lng,
      note: `非上海城市「${xinjiangCity}」已跳过上海 mock；页面正式规划应走高德试验链路,CLI 诊断使用 ${candidates.length} 个同城兜底 POI`,
    };
  }
  if (c.city !== '上海' && !anchors.length) {
    return {
      candidates: [],
      centerLat: 0,
      centerLng: 0,
      note: `非上海城市「${c.city}」不会使用上海 mock；页面正式规划应走统一后端接口获取真实 POI`,
    };
  }

  // 计算地理中心
  let centerLat: number, centerLng: number;
  if (anchors.length) {
    centerLat = anchors.reduce((s, k) => s + AREA_MAP[k].lat, 0) / anchors.length;
    centerLng = anchors.reduce((s, k) => s + AREA_MAP[k].lng, 0) / anchors.length;
  } else {
    // 上海离线 demo 无锚定时使用人民广场作为默认中心。
    centerLat = AREA_MAP['peoplesq'].lat;
    centerLng = AREA_MAP['peoplesq'].lng;
  }

  const avoidCat = new Set(c.avoidCategories);
  const explicitFamily = hasExplicitFamilyIntent(c);
  const adultNightWanted = wantsAdultNightlife(c);
  const quietMode = isQuietIntent(c);
  const nightViewWanted = wantsNightView(c);

  let pool = POIS.filter((p) => {
    // 类目硬过滤
    if (avoidCat.has(p.category)) return false;
    // 语义护栏:先挡掉明显错场景,避免后续 beam search 为了凑类目捞进不可信 POI。
    if (explicitFamily && isAdultNightlifePOI(p) && !adultNightWanted) return false;
    if (!explicitFamily && isStrongFamilyPOI(p)) return false;
    if (quietMode && isAdultNightlifePOI(p) && !adultNightWanted && !nightViewWanted) return false;
    // 规避场景硬过滤:若用户明确 avoid 某 tag,且该 POI 的标签里这个 tag 是「主调」,剔除
    for (const a of c.avoid) {
      if (p.sceneTags.includes(a)) {
        // 仅当该 tag 在前两个主标签里才剔除(避免误杀)
        if (p.sceneTags.slice(0, 2).includes(a)) return false;
      }
    }
    return true;
  });

  // 地理半径过滤
  const within = pool.filter(
    (p) => haversineM(centerLat, centerLng, p.lat, p.lng) <= RETRIEVE_RADIUS_M,
  );

  // 兜底:若半径内类目不足,放宽到全城(保证 demo 永远能出结果)
  const cats = new Set(within.map((p) => p.category));
  const finalPool = cats.size >= 3 ? within : pool;

  const note = anchors.length
    ? `锚定区域 ${anchors.map((k) => AREA_MAP[k].name).join('、')},半径 ${RETRIEVE_RADIUS_M / 1000}km 内召回 ${finalPool.length} 个 POI`
    : `未指定具体区域,以市中心为锚召回 ${finalPool.length} 个 POI`;

  return { candidates: finalPool, centerLat, centerLng, note };
}
