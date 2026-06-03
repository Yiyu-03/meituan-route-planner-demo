import type { Route, Constraints, Persona } from '../types';
import { CATEGORY_LABEL } from '../types';
import { budgetVerdict } from '../lib/display';

// ------------------------------------------------------------
// ⑦ explainRoute
// 生成路线级的「为什么这么安排」解释 + 风险提示。
// 注意:解释是基于已算出的结构化结果(stops/checks)拼装的,
// 不是让 LLM 自由生成路线文本 —— 解释忠实于实际计算。
// ------------------------------------------------------------

function fmtH(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function explainRoute(
  route: Route, c: Constraints, persona: Persona,
): { explanation: string; risks: string[] } {
  const stops = route.stops;
  // ---- 解释 ----
  const parts: string[] = [];

  // 整体节奏
  const paceWord = c.pace === 'relaxed' ? '舒缓不赶' : c.pace === 'packed' ? '紧凑充实' : '张弛有度';
  parts.push(`${fmtH(route.stops[0]?.arrive ?? c.startTime)}–${fmtH(route.endTime)} · ${stops.length}站 · 节奏${paceWord}`);

  // 预算总结
  if (c.budgetPerCapita != null) {
    const verdict = budgetVerdict(route.totalCost, c.budgetPerCapita);
    if (verdict.tone === 'ok') {
      parts.push(`人均¥${route.totalCost}(${c.budgetSource === 'soft' ? '软预算内' : '预算内'})`);
    } else {
      parts.push(`人均¥${route.totalCost}(${c.budgetSource === 'soft' ? `软预算${verdict.label}` : verdict.label})`);
    }
  } else if (c.diningBudgetPerCapita != null) {
    const meals = stops.filter((s) => s.scored.poi.category === 'dining');
    const mealCost = meals.reduce((sum, stop) => sum + stop.scored.poi.perCapita, 0);
    parts.push(mealCost > 0
      ? `午饭估算¥${mealCost}/¥${c.diningBudgetPerCapita}`
      : `午饭预算≤¥${c.diningBudgetPerCapita}`);
  } else {
    parts.push(`人均¥${route.totalCost}`);
  }

  const categories = [...new Set(stops.map((s) => CATEGORY_LABEL[s.scored.poi.category]))].slice(0, 3);
  if (categories.length) parts.push(categories.join(' / '));

  const explanation = parts.join(' · ');

  // ---- 风险提示 ----
  const risks: string[] = [];
  if (c.budgetSource === 'soft' && /外滩|陆家嘴|新天地|bund|lujiazui|xintiandi/.test(`${c.city}${c.raw}`)) {
    risks.push('· 热门夜景商圈人均偏高,已优先选择相对平价的组合。');
  }

  // 来自校验的 warn/fail
  for (const ck of route.checks) {
    if (ck.status === 'fail') risks.push(`⚠️ ${ck.label}:${ck.detail}`);
  }
  for (const ck of route.checks) {
    if (ck.status === 'warn') risks.push(`· ${ck.label}:${ck.detail}`);
  }

  // 排队高峰额外提示
  const hotQueue = stops.filter((s) => s.scored.poi.queueBase >= 0.7);
  for (const q of hotQueue) {
    risks.push(`· ${q.scored.poi.name}排队较多,建议${fmtH(q.arrive)}的时段提前到或错峰。`);
  }

  // 跨越打烊提示
  for (const s of stops) {
    const { closeHour, name } = s.scored.poi;
    if (s.depart > closeHour && s.arrive < closeHour) {
      risks.push(`· ${name}约 ${fmtH(closeHour)} 打烊,留意停留时长。`);
    }
  }

  // 去重
  const uniqRisks = [...new Set(risks)].slice(0, 6);
  if (uniqRisks.length === 0) uniqRisks.push('✓ 当前路线各项约束均通过,无明显风险。');

  return { explanation, risks: uniqRisks };
}
