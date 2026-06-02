import type { Route, Constraints, Persona } from '../types';
import { CATEGORY_LABEL, SCENE_LABEL } from '../types';
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
  const first = stops[0]?.scored.poi;
  const last = stops[stops.length - 1]?.scored.poi;

  // ---- 解释 ----
  const parts: string[] = [];

  // 整体节奏
  const paceWord = c.pace === 'relaxed' ? '舒缓不赶' : c.pace === 'packed' ? '紧凑充实' : '张弛有度';
  parts.push(
    `为「${persona.label}」定制 · ${fmtH(c.startTime)} 从${first?.name ?? ''}出发,${fmtH(route.endTime)} 在${last?.name ?? ''}收尾,${stops.length} 站节奏${paceWord}。`,
  );

  // 类目编排逻辑
  const order = stops.map((s) => CATEGORY_LABEL[s.scored.poi.category]).join(' → ');
  parts.push(`动线编排:${order}。`);

  // 餐饮对齐饭点
  const meal = stops.find((s) => s.scored.poi.category === 'dining');
  if (meal) {
    parts.push(`正餐安排在 ${fmtH(meal.arrive)} 前后,贴合饭点。`);
  }

  // 夜景收尾
  const night = stops.find((s) => s.scored.poi.category === 'nightscape');
  if (night && night === stops[stops.length - 1]) {
    parts.push(`以${night.scored.poi.name}的夜景/氛围收尾,适合${persona.label}。`);
  }

  // 个性化亮点(取首站理由)
  if (first && stops[0].scored.reasons.length) {
    parts.push(`亮点示例:${stops[0].scored.poi.name} —— ${stops[0].scored.reasons[0]}。`);
  }

  // 预算总结
  if (c.budgetPerCapita != null) {
    const verdict = budgetVerdict(route.totalCost, c.budgetPerCapita);
    if (verdict.tone === 'ok') {
      parts.push(`人均预计 ¥${route.totalCost},控制在 ¥${c.budgetPerCapita} 预算内。`);
    } else {
      parts.push(`人均预计 ¥${route.totalCost},${verdict.label}(预算 ¥${c.budgetPerCapita}),可点「便宜一点」替换高价节点。`);
    }
  } else {
    parts.push(`人均预计 ¥${route.totalCost}。`);
  }

  const explanation = parts.join('');

  // ---- 风险提示 ----
  const risks: string[] = [];

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
