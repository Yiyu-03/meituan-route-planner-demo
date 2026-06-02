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

export interface RetrieveResult {
  candidates: POI[];
  centerLat: number;
  centerLng: number;
  note: string;
}

export function retrieveCandidates(c: Constraints): RetrieveResult {
  const anchors = anchorAreas(c);

  // 计算地理中心
  let centerLat: number, centerLng: number;
  if (anchors.length) {
    centerLat = anchors.reduce((s, k) => s + AREA_MAP[k].lat, 0) / anchors.length;
    centerLng = anchors.reduce((s, k) => s + AREA_MAP[k].lng, 0) / anchors.length;
  } else {
    // 无锚定 → 用人民广场作为城市默认中心
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
