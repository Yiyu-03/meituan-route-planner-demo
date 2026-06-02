import type {
  POI, Constraints, Persona, ScoredPOI, ScoreBreakdown, SceneTag,
} from '../types';
import { SCENE_LABEL } from '../types';
import { haversineM } from './geo';

// ------------------------------------------------------------
// ③ scorePOIs —— Mock Recommendation Model
// 对每个候选 POI 计算 personalized_score(0-100),输入特征:
//   质量(rating) / 热度(reviews) / 场景契合(persona×tags)
//   / 偏好匹配(constraints.prefs) / 预算契合 / 距离 / 同行匹配 / UGC
// 不同 persona 的 sceneWeights 不同 → 同一 POI 得分不同 → 路线不同。
// 同时产出「为什么推荐」的可读理由。
// ------------------------------------------------------------

// 各维度满分权重(相加 = 100)
const W = {
  quality: 18,
  popularity: 10,
  sceneFit: 26,    // 画像场景契合 —— 最重要,体现个性化
  prefMatch: 18,   // 本次输入的显式偏好
  budgetFit: 12,
  proximity: 8,
  companionFit: 5,
  ugcBonus: 3,
};

function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x));
}

/** 质量:rating 1-5 → 归一(3.8 以下快速衰减) */
function qualityScore(p: POI): number {
  return clamp((p.rating - 3.6) / (5 - 3.6));
}

/** 热度:log 归一,避免大店一家独大 */
function popularityScore(p: POI): number {
  return clamp(Math.log10(p.reviews + 1) / Math.log10(35000));
}

/** 场景契合:Σ(persona.sceneWeights[tag]) 经 sigmoid 归一 */
function sceneFitScore(p: POI, persona: Persona): { v: number; hits: SceneTag[] } {
  let sum = 0;
  const hits: SceneTag[] = [];
  for (const tag of p.sceneTags) {
    const w = persona.sceneWeights[tag] ?? 0;
    sum += w;
    if (w >= 0.5) hits.push(tag);
  }
  // 归一:sum 理论范围约 [-2, 3]
  const v = clamp((sum + 1.2) / 3.2);
  return { v, hits };
}

/** 偏好匹配:本次输入 prefs 命中 tag 的比例 + avoid 命中惩罚 */
function prefMatchScore(p: POI, c: Constraints): { v: number; hits: SceneTag[] } {
  if (c.prefs.length === 0) return { v: 0.5, hits: [] };
  const hits = c.prefs.filter((t) => p.sceneTags.includes(t));
  let v = hits.length / c.prefs.length;
  // avoid 命中(非主标签,未被 retrieve 剔除的)轻惩罚
  const avoidHit = c.avoid.filter((t) => p.sceneTags.includes(t));
  v -= avoidHit.length * 0.25;
  return { v: clamp(v), hits: hits as SceneTag[] };
}

/** 预算契合:相对人均预算,越接近越好;超预算按敏感度惩罚 */
function budgetFitScore(p: POI, c: Constraints, persona: Persona): { v: number; over: boolean } {
  if (c.budgetPerCapita == null) {
    // 无预算 → 中性偏好平价
    return { v: clamp(1 - p.perCapita / 600), over: false };
  }
  const ratio = p.perCapita / c.budgetPerCapita;
  if (ratio <= 1) {
    // 不超预算:0.6~1.0(太便宜略减,体现"匹配档次")
    return { v: clamp(0.6 + 0.4 * (1 - Math.abs(0.7 - ratio))), over: false };
  }
  // 超预算:按敏感度衰减
  const penalty = (ratio - 1) * (1 + persona.budgetSensitivity * 2);
  return { v: clamp(1 - penalty), over: true };
}

/** 距离:相对地理中心,越近越好 */
function proximityScore(p: POI, centerLat: number, centerLng: number): number {
  const d = haversineM(centerLat, centerLng, p.lat, p.lng);
  return clamp(1 - d / 6000);
}

/** 同行匹配:人多偏热闹/性价比,人少偏安静/精致 */
function companionFitScore(p: POI, party: number): number {
  if (party >= 4) {
    // 大群体:lively/budget/foodie 加分,quiet/upscale 减分
    let v = 0.5;
    if (p.sceneTags.includes('lively')) v += 0.25;
    if (p.sceneTags.includes('budget')) v += 0.1;
    if (p.sceneTags.includes('quiet')) v -= 0.2;
    if (p.sceneTags.includes('upscale')) v -= 0.1;
    return clamp(v);
  }
  if (party <= 1) {
    // 独行:quiet/cultural/local 加分
    let v = 0.5;
    if (p.sceneTags.includes('quiet')) v += 0.2;
    if (p.sceneTags.includes('cultural')) v += 0.15;
    if (p.sceneTags.includes('lively')) v -= 0.15;
    return clamp(v);
  }
  // 2-3 人(情侣/小家庭):romantic/photo 略加分
  let v = 0.55;
  if (p.sceneTags.includes('romantic')) v += 0.15;
  if (p.sceneTags.includes('photo')) v += 0.05;
  return clamp(v);
}

/** UGC:含正向情绪词的小幅加成 */
function ugcBonusScore(p: POI): number {
  const pos = ['必', '神器', '炸裂', '绝', '满分', '一流', '超', '不真实', '惊艳'];
  return pos.some((w) => p.ugc.includes(w)) ? 1 : 0.4;
}

/** 生成「为什么推荐」可读理由(最多 4 条) */
function buildReasons(
  p: POI, c: Constraints, persona: Persona,
  b: ScoreBreakdown, sceneHits: SceneTag[], prefHits: SceneTag[],
  budgetOver: boolean,
): string[] {
  const r: string[] = [];

  // 1. 画像场景契合(最高优先)
  if (sceneHits.length) {
    const top = sceneHits.slice(0, 2).map((t) => SCENE_LABEL[t]).join('、');
    r.push(`贴合「${persona.label}」偏好:${top}`);
  }
  // 2. 本次输入偏好命中
  if (prefHits.length) {
    r.push(`命中你的需求:${prefHits.map((t) => SCENE_LABEL[t]).join('、')}`);
  }
  // 3. 预算
  if (c.budgetPerCapita != null) {
    if (!budgetOver) r.push(`人均 ¥${p.perCapita},在 ¥${c.budgetPerCapita} 预算内`);
    else r.push(`人均 ¥${p.perCapita},略超预算需留意`);
  }
  // 4. 质量/热度
  if (b.quality >= W.quality * 0.8) r.push(`评分 ${p.rating},口碑突出`);
  else if (b.popularity >= W.popularity * 0.85) r.push(`${(p.reviews / 1000).toFixed(1)}k 条点评,人气很高`);

  // 兜底
  if (r.length === 0) r.push(`综合评分 ${p.rating} · 人均 ¥${p.perCapita}`);
  return r.slice(0, 4);
}

export function scorePOI(
  p: POI, c: Constraints, persona: Persona, centerLat: number, centerLng: number,
): ScoredPOI {
  const quality = qualityScore(p);
  const popularity = popularityScore(p);
  const { v: sceneFit, hits: sceneHits } = sceneFitScore(p, persona);
  const { v: prefMatch, hits: prefHits } = prefMatchScore(p, c);
  const { v: budgetFit, over } = budgetFitScore(p, c, persona);
  const proximity = proximityScore(p, centerLat, centerLng);
  const companionFit = companionFitScore(p, c.party);
  const ugcBonus = ugcBonusScore(p);

  // persona 的 categoryPriority 作为类目级乘子(轻微)
  const catBoost = 1 + (persona.categoryPriority[p.category] ?? 0) * 0.12;

  const breakdown: ScoreBreakdown = {
    quality: +(quality * W.quality).toFixed(1),
    popularity: +(popularity * W.popularity).toFixed(1),
    sceneFit: +(sceneFit * W.sceneFit * catBoost).toFixed(1),
    prefMatch: +(prefMatch * W.prefMatch).toFixed(1),
    budgetFit: +(budgetFit * W.budgetFit).toFixed(1),
    proximity: +(proximity * W.proximity).toFixed(1),
    companionFit: +(companionFit * W.companionFit).toFixed(1),
    ugcBonus: +(ugcBonus * W.ugcBonus).toFixed(1),
  };

  const score = +Object.values(breakdown).reduce((s, x) => s + x, 0).toFixed(1);
  const reasons = buildReasons(p, c, persona, breakdown, sceneHits, prefHits, over);

  return { poi: p, score: Math.min(100, score), breakdown, reasons };
}

export function scorePOIs(
  pois: POI[], c: Constraints, persona: Persona, centerLat: number, centerLng: number,
): ScoredPOI[] {
  return pois
    .map((p) => scorePOI(p, c, persona, centerLat, centerLng))
    .sort((a, b) => b.score - a.score);
}
