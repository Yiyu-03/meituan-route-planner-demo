import type {
  Route, Constraints, Persona, ScoredPOI, RefineAction, Category, RouteStop,
} from '../types';
import { CATEGORY_LABEL, SCENE_LABEL } from '../types';
import { distBetween, travelEstimate } from './geo';
import { scorePOI } from './scorePOIs';
import { revalidateRoute } from './pipeline';

// ------------------------------------------------------------
// replan —— 多轮局部修改
// 关键:**只替换受影响节点**,其余结构尽量保留。
// 支持:
//   - 「换一家评分更高/更便宜的餐厅」→ 只换 dining 节点
//   - 「预算降到300」→ 调 constraints.budget,替换超预算最严重的节点
//   - 「不要太赶」→ pace=relaxed,去掉移动成本最高的 1 个节点
//   - 「再多逛点」→ pace=packed,补 1 个高分节点
//   - 「加一个适合拍照的地方」→ 补 1 个 photo 高分节点
// ------------------------------------------------------------

const CAT_WORDS: { cat: Category; words: string[] }[] = [
  { cat: 'dining', words: ['餐厅', '吃饭', '吃的', '饭店', '正餐', '餐'] },
  { cat: 'cafe', words: ['咖啡', '咖啡馆', '茶', '下午茶'] },
  { cat: 'culture', words: ['展', '博物馆', '美术馆', '书店', '园林', '文化'] },
  { cat: 'entertainment', words: ['娱乐', '演出', '电影', '密室', '桌游', '玩的'] },
  { cat: 'shopping', words: ['购物', '商场', '逛街', '店'] },
  { cat: 'nightscape', words: ['夜景', '酒吧', '看景'] },
];

function detectCategory(text: string): Category | undefined {
  for (const { cat, words } of CAT_WORDS) {
    if (words.some((w) => text.includes(w))) return cat;
  }
  return undefined;
}

/** 把自然语言 refine 指令解析成结构化动作 */
export function parseRefine(text: string): RefineAction {
  const raw = text.trim();

  // 预算调整
  const bm = raw.match(/(?:降到|改成|预算|控制在|不超过|降低到)\s*(\d{2,4})/);
  if (bm && /预算|降|不超|控制|便宜点儿?整体/.test(raw)) {
    const budget = parseInt(bm[1], 10);
    return { kind: 'setBudget', budget, raw, note: `将人均预算调整为 ¥${budget},并替换超支最严重的节点` };
  }

  // 节奏
  if (/不要太赶|别太赶|太赶|慢一点|轻松点|不想太累|太累/.test(raw)) {
    return { kind: 'relaxPace', raw, note: '放慢节奏:移除移动成本最高的 1 个节点,其余保留' };
  }
  if (/多逛|多玩|再加点|多安排|紧凑|不够|再来一个地方/.test(raw)) {
    return { kind: 'packPace', raw, note: '增加节奏:补充 1 个高分节点' };
  }

  // 加偏好(拍照等)
  if (/加(一?个)?.*(拍照|出片|打卡)/.test(raw) || /(拍照|出片|打卡).*的地方/.test(raw)) {
    return { kind: 'addPreference', pref: 'photo', raw, note: '新增一个「出片」高分节点' };
  }
  if (/加(一?个)?.*(安静|清净)/.test(raw)) {
    return { kind: 'addPreference', pref: 'quiet', raw, note: '新增一个「安静」高分节点' };
  }

  // 换某类目里的一家
  const wantsReplace = /换|替换|改一家|换一家|换个/.test(raw);
  if (wantsReplace) {
    const cat = detectCategory(raw);
    let criterion: RefineAction['criterion'] = 'higherRating';
    if (/便宜|实惠|省|性价比/.test(raw)) criterion = 'cheaper';
    else if (/近|步行|远/.test(raw)) criterion = 'closer';
    else if (/评分|好评|高分|更好/.test(raw)) criterion = 'higherRating';
    return {
      kind: 'replaceCategory',
      category: cat,
      criterion,
      raw,
      note: cat
        ? `只替换${CATEGORY_LABEL[cat]}节点为「${criterion === 'cheaper' ? '更便宜' : criterion === 'closer' ? '更近' : '评分更高'}」的一家,其余不动`
        : `替换一个节点为更优选择`,
    };
  }

  return { kind: 'unknown', raw, note: '未能识别该修改意图,可尝试:换一家评分更高的餐厅 / 预算降到300 / 不要太赶 / 加一个适合拍照的地方' };
}

/** 重新计算时间轴(节点集合或顺序变化后) */
function recomputeTimeline(
  stops: ScoredPOI[], c: Constraints, persona: Persona,
): Route {
  const out: RouteStop[] = [];
  let clock = c.startTime;
  let totalWalk = 0, totalTransit = 0, cost = 0;

  stops.forEach((sp, i) => {
    let leg: RouteStop['legFromPrev'] = null;
    if (i > 0) {
      const d = distBetween(stops[i - 1].poi, sp.poi);
      const t = travelEstimate(d, persona.walkTolerance);
      leg = { distM: Math.round(d), minutes: t.minutes, mode: t.mode };
      clock += t.minutes / 60;
      if (t.mode === 'walk') totalWalk += t.minutes; else totalTransit += t.minutes;
    }
    const arrive = Math.max(clock, sp.poi.openHour);
    const depart = arrive + sp.poi.avgDuration / 60;
    clock = depart;
    cost += sp.poi.perCapita;
    out.push({ scored: sp, arrive, depart, legFromPrev: leg });
  });

  return {
    id: 'route-0',
    stops: out,
    totalCost: Math.round(cost),
    totalWalkMin: totalWalk,
    totalTransitMin: totalTransit,
    endTime: clock,
    score: +(stops.reduce((s, p) => s + p.score, 0) / Math.max(1, stops.length)).toFixed(1),
    checks: [],
    coverage: [...new Set(stops.map((s) => s.poi.category))] as Category[],
    explanation: '',
    risks: [],
  };
}

export interface ReplanResult {
  route: Route;
  constraints: Constraints;
  changed: string[];   // 被改动的 POI id
  message: string;     // 给用户的说明
}

export function buildReplanActions(route: Route, persona: Persona): string[] {
  const cats = new Set(route.stops.map((s) => s.scored.poi.category));
  const actions: string[] = [];

  if (cats.has('dining')) actions.push('换一家评分更高的餐厅');
  if (route.totalCost > 260 || persona.budgetSensitivity > 0.55) actions.push('换家更便宜的');
  if (route.checks.some((c) => c.key === 'budget' && c.status !== 'pass')) actions.push('预算降到 300');
  if (route.totalWalkMin + route.totalTransitMin > persona.walkTolerance * 2) actions.push('不要太赶');
  if (route.stops.length < 5 && persona.pace !== 'relaxed') actions.push('再多逛一个地方');
  if (!route.stops.some((s) => s.scored.poi.sceneTags.includes('photo'))) actions.push('加一个适合拍照的地方');
  if (cats.has('cafe')) actions.push('把咖啡换成更近的');
  if (persona.id === 'family') actions.push('换成更适合带娃的地方');
  if (persona.id === 'solo') actions.push('加一个安静的地方');

  return [...new Set(actions)].slice(0, 6);
}

/**
 * 执行局部重规划。
 * @param route 当前(推荐)路线
 * @param allScored 全量候选打分(从 PlanResult.candidates 来,作为替换池)
 */
export function applyRefine(
  action: RefineAction,
  route: Route,
  constraints: Constraints,
  persona: Persona,
  allScored: ScoredPOI[],
): ReplanResult {
  const currentIds = new Set(route.stops.map((s) => s.scored.poi.id));
  let stops = route.stops.map((s) => s.scored);
  let cons = { ...constraints };
  const changed: string[] = [];
  let message = '';

  const poolByCat = (cat: Category) =>
    allScored.filter((s) => s.poi.category === cat && !currentIds.has(s.poi.id));

  switch (action.kind) {
    case 'replaceCategory': {
      // 找到要替换的节点(指定类目;未指定则取移动后最差分节点)
      let targetIdx = action.category
        ? stops.findIndex((s) => s.poi.category === action.category)
        : stops.reduce((worst, s, i, arr) => (s.score < arr[worst].score ? i : worst), 0);

      if (targetIdx < 0) {
        message = `当前路线里没有${action.category ? CATEGORY_LABEL[action.category] : ''}节点可替换。`;
        break;
      }
      const old = stops[targetIdx];
      const cat = old.poi.category;
      let pool = poolByCat(cat);

      // 按 criterion 选替换项
      if (action.criterion === 'higherRating') {
        pool = pool.filter((s) => s.poi.rating > old.poi.rating)
          .sort((a, b) => b.poi.rating - a.poi.rating || b.score - a.score);
      } else if (action.criterion === 'cheaper') {
        pool = pool.filter((s) => s.poi.perCapita < old.poi.perCapita)
          .sort((a, b) => a.poi.perCapita - b.poi.perCapita || b.score - a.score);
      } else if (action.criterion === 'closer') {
        const neighbor = stops[targetIdx - 1] ?? stops[targetIdx + 1];
        pool = pool.sort((a, b) =>
          distBetween(neighbor.poi, a.poi) - distBetween(neighbor.poi, b.poi));
      }

      if (pool.length === 0) {
        message = `没有找到比「${old.poi.name}」${action.criterion === 'cheaper' ? '更便宜' : action.criterion === 'closer' ? '更近' : '评分更高'}的${CATEGORY_LABEL[cat]},已保持原样。`;
        break;
      }
      const repl = pool[0];
      stops[targetIdx] = repl;
      changed.push(repl.poi.id);
      message = `已将${CATEGORY_LABEL[cat]}「${old.poi.name}」(${old.poi.rating}分/¥${old.poi.perCapita})替换为「${repl.poi.name}」(${repl.poi.rating}分/¥${repl.poi.perCapita}),其余 ${stops.length - 1} 站保持不变。`;
      break;
    }

    case 'setBudget': {
      cons.budgetPerCapita = action.budget!;
      // 找超支最严重(人均最高)的节点替换为同类目更便宜的
      const sorted = [...stops].sort((a, b) => b.poi.perCapita - a.poi.perCapita);
      const victim = sorted[0];
      const vIdx = stops.findIndex((s) => s.poi.id === victim.poi.id);
      const pool = poolByCat(victim.poi.category)
        .filter((s) => s.poi.perCapita < victim.poi.perCapita)
        .sort((a, b) => a.poi.perCapita - b.poi.perCapita);
      if (pool.length) {
        // 重新按新预算打分后取最佳便宜项
        const repl = pool[0];
        stops[vIdx] = repl;
        changed.push(repl.poi.id);
        message = `预算降到 ¥${action.budget}:把人均最高的「${victim.poi.name}」(¥${victim.poi.perCapita})换成「${repl.poi.name}」(¥${repl.poi.perCapita})。`;
      } else {
        message = `预算已设为 ¥${action.budget},但未找到更便宜的同类替换,请考虑减少 POI。`;
      }
      break;
    }

    case 'relaxPace': {
      cons.pace = 'relaxed';
      if (stops.length <= 3) {
        message = '已设为舒缓节奏。当前仅 3 站,为保持类目完整未再删减。';
        break;
      }
      // 删掉「移动成本最高且分数最低」的中间节点(不删首尾餐饮/夜景骨架)
      let dropIdx = -1, worst = -Infinity;
      for (let i = 1; i < stops.length - 1; i++) {
        const cat = stops[i].poi.category;
        if (cat === 'dining' || cat === 'nightscape') continue;
        const legIn = distBetween(stops[i - 1].poi, stops[i].poi);
        const legOut = distBetween(stops[i].poi, stops[i + 1].poi);
        const cost = (legIn + legOut) / 1000 - stops[i].score / 50;
        if (cost > worst) { worst = cost; dropIdx = i; }
      }
      if (dropIdx >= 0) {
        const dropped = stops[dropIdx];
        stops = stops.filter((_, i) => i !== dropIdx);
        changed.push(dropped.poi.id);
        message = `已放慢节奏:移除移动成本最高的「${dropped.poi.name}」,保留其余 ${stops.length} 站。`;
      } else {
        message = '已设为舒缓节奏,当前结构已较紧凑,无需删减。';
      }
      break;
    }

    case 'packPace': {
      cons.pace = 'packed';
      // 补一个不在路线里的高分节点(优先填补缺失类目)
      const have = new Set(stops.map((s) => s.poi.category));
      const wishCats: Category[] = ['culture', 'cafe', 'entertainment', 'shopping', 'nightscape'];
      const missingCat = wishCats.find((c) => !have.has(c));
      let pool = allScored.filter((s) => !currentIds.has(s.poi.id));
      if (missingCat) pool = pool.filter((s) => s.poi.category === missingCat);
      pool = pool.sort((a, b) => b.score - a.score);
      if (pool.length) {
        const add = pool[0];
        // 插到夜景之前(或末尾)
        const nightIdx = stops.findIndex((s) => s.poi.category === 'nightscape');
        const insertAt = nightIdx >= 0 ? nightIdx : stops.length;
        stops.splice(insertAt, 0, add);
        changed.push(add.poi.id);
        message = `已增加节奏:新增「${add.poi.name}」(${CATEGORY_LABEL[add.poi.category]}),现在共 ${stops.length} 站。`;
      } else {
        message = '已设为紧凑节奏,但候选池中暂无合适的新增节点。';
      }
      break;
    }

    case 'addPreference': {
      if (action.pref) {
        cons.prefs = [...new Set([...cons.prefs, action.pref])];
        // 找带该 tag 的高分、且不在路线里的节点
        const pool = allScored
          .filter((s) => !currentIds.has(s.poi.id) && s.poi.sceneTags.includes(action.pref!))
          .sort((a, b) => b.score - a.score);
        if (pool.length) {
          const add = pool[0];
          const nightIdx = stops.findIndex((s) => s.poi.category === 'nightscape');
          const insertAt = nightIdx >= 0 ? nightIdx : stops.length;
          stops.splice(insertAt, 0, add);
          changed.push(add.poi.id);
          message = `已新增一个「${SCENE_LABEL[action.pref]}」节点:「${add.poi.name}」,其余保留。`;
        } else {
          message = `候选中暂无更多「${SCENE_LABEL[action.pref]}」的新地点。`;
        }
      }
      break;
    }

    default:
      message = action.note;
      return { route, constraints, changed: [], message };
  }

  // 受 budget/prefs 变化影响,重新对保留节点打分(分数会随约束更新)
  const center = avgCenter(stops);
  const rescored = stops.map((s) =>
    changed.includes(s.poi.id) || cons.budgetPerCapita !== constraints.budgetPerCapita || cons.prefs.length !== constraints.prefs.length
      ? scorePOI(s.poi, cons, persona, center.lat, center.lng)
      : s,
  );

  // 重算时间轴 + 重新校验 + 重新解释(只对这一条路线)
  const rebuilt = recomputeTimeline(rescored.map((s) => s), cons, persona);
  const finalRoute = revalidateRoute(rebuilt, cons, persona);

  return { route: finalRoute, constraints: cons, changed, message };
}

function avgCenter(stops: ScoredPOI[]): { lat: number; lng: number } {
  if (!stops.length) return { lat: 31.2304, lng: 121.4737 };
  return {
    lat: stops.reduce((s, p) => s + p.poi.lat, 0) / stops.length,
    lng: stops.reduce((s, p) => s + p.poi.lng, 0) / stops.length,
  };
}
