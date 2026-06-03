import {
  CASES, PERSONA_DIFF_CASES, runCase, runPersonaDiff,
} from '../src/eval/cases';
import { PERSONA_MAP } from '../src/data/personas';
import { buildAmapCityPlan } from '../src/lib/amapPlan';
import { runPipeline } from '../src/engine/pipeline';
import { applyRefine, parseRefine } from '../src/engine/replan';
import { runRefineAgent } from '../src/engine/refineAgent';
import { routeAdvantage } from '../src/lib/display';
import type { PlanResult, RefinePrimaryIntent, Route } from '../src/types';

// performance.now polyfill 对 node 已内置(globalThis.performance)
const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
};

console.log(`\n${C.bold}${C.cyan}══════ 本地路线智能规划 · 评测 ══════${C.reset}\n`);

// ---- Part 1: 功能断言 ----
let totalAsserts = 0, passAsserts = 0, allPassCases = 0;
console.log(`${C.bold}【Part 1】功能断言(${CASES.length} cases)${C.reset}\n`);

for (const c of CASES) {
  const r = runCase(c);
  if (r.allPass) allPassCases++;
  const tag = r.allPass ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`${tag} [${r.id}] ${r.title}  ${C.dim}(${r.routeCount} 条路线)${C.reset}`);
  console.log(`     ${C.dim}路线:${r.stops.join(' → ')}${C.reset}`);
  for (const a of r.asserts) {
    totalAsserts++;
    if (a.pass) passAsserts++;
    const mark = a.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    console.log(`       ${mark} ${a.name} ${C.dim}— ${a.desc}${C.reset}`);
  }
  console.log('');
}

// ---- Part 2: 跨画像差异(证明非预制)----
console.log(`${C.bold}【Part 2】同输入 × 不同画像 → 路线差异(${PERSONA_DIFF_CASES.length} cases)${C.reset}\n`);
let distinctCount = 0;
for (const c of PERSONA_DIFF_CASES) {
  const r = runPersonaDiff(c);
  if (r.distinct) distinctCount++;
  const tag = r.distinct ? `${C.green}DISTINCT${C.reset}` : `${C.red}IDENTICAL${C.reset}`;
  console.log(`${tag} [${r.id}] ${r.title}  ${C.dim}(两两差异率 ${(r.pairwiseDiff * 100).toFixed(0)}%)${C.reset}`);
  for (const p of r.perPersona) {
    console.log(`     ${C.yellow}${p.persona}${C.reset}: ${p.stops.join(' → ')}`);
  }
  console.log('');
}

// ---- Part 3: 产品体验回归 ----
console.log(`${C.bold}【Part 3】产品体验回归(4 cases)${C.reset}\n`);

const productResults = [
  await runSuzhouRemoteCase('朋友来苏州，带他园区转转，他上午10点到，预算300吃午饭，打算逛园林、博物馆'),
  runDaxueluBudgetCase('周五晚上和朋友在大学路聚会，人均200以内，想热闹但不要太累'),
  await runHangzhouRemoteCase('朋友来杭州，下午在西湖附近逛逛，预算200，想轻松一点'),
  runShanghaiMockRegression(),
];

for (const result of productResults) {
  const tag = result.allPass ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`${tag} [${result.id}] ${result.title}`);
  console.log(`     ${C.dim}路线:${result.stops.join(' → ')}${C.reset}`);
  for (const a of result.asserts) {
    const mark = a.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    console.log(`       ${mark} ${a.name} ${C.dim}— ${a.desc}${C.reset}`);
  }
  console.log('');
}

// ---- 汇总 ----
const assertRate = ((passAsserts / totalAsserts) * 100).toFixed(1);
const caseRate = ((allPassCases / CASES.length) * 100).toFixed(1);
const diffRate = ((distinctCount / PERSONA_DIFF_CASES.length) * 100).toFixed(1);

console.log(`${C.bold}${C.cyan}══════ 汇总 ══════${C.reset}`);
console.log(`断言通过:  ${C.bold}${passAsserts}/${totalAsserts}${C.reset}  (${assertRate}%)`);
console.log(`全过 case:  ${C.bold}${allPassCases}/${CASES.length}${C.reset}  (${caseRate}%)`);
console.log(`画像差异:  ${C.bold}${distinctCount}/${PERSONA_DIFF_CASES.length}${C.reset}  (${diffRate}%) ${C.dim}← 证明非预制模板${C.reset}`);
const productPass = productResults.filter((item) => item.allPass).length;
console.log(`产品回归:  ${productPass === productResults.length ? C.green : C.red}${productPass}/${productResults.length}${C.reset} ${C.dim}← 预算/文化/质量/节奏护栏${C.reset}`);
console.log('');

const ok = passAsserts === totalAsserts && distinctCount === PERSONA_DIFF_CASES.length && productPass === productResults.length;
process.exit(ok ? 0 : 1);

interface ProductCaseResult {
  id: string;
  title: string;
  asserts: { name: string; pass: boolean; desc: string }[];
  allPass: boolean;
  stops: string[];
}

function routeMoveMin(route: Route): number {
  return route.totalWalkMin + route.totalTransitMin;
}

function routeHasHardMove(route: Route): boolean {
  return route.stops.some((stop) => {
    const leg = stop.legFromPrev;
    if (!leg) return false;
    return leg.minutes >= 100 || leg.distM > 12000 || leg.minutes > 45;
  }) || routeMoveMin(route) >= 100;
}

function routeStamp(route: Route): '拿来就走' | '建议调整' | '需调整' {
  if (route.checks.some((check) => check.status === 'fail')) return '需调整';
  if (route.checks.some((check) => check.status === 'warn')) return '建议调整';
  return '拿来就走';
}

async function runAgentRefines(
  plan: PlanResult,
  persona = PERSONA_MAP.friends,
  texts: string[],
): Promise<{
  text: string;
  expected: RefinePrimaryIntent;
  actual: RefinePrimaryIntent;
  message: string;
  validation: 'pass' | 'warn' | 'fail';
  stamp: string;
  elapsedMs: number;
  route: Route;
}[]> {
  const baseRoute = plan.routes[0];
  const baseConstraints = plan.constraints;
  const expectedIntent = (text: string): RefinePrimaryIntent => {
    if (/车程|太远|少打车/.test(text)) return 'reduceTravel';
    if (/多逛|多玩|再加/.test(text)) return 'addStop';
    if (/奶茶|咖啡|茶饮/.test(text)) return 'addFoodOrDrink';
    if (/安静/.test(text)) return 'makeQuiet';
    return 'unknown';
  };
  const results = [];
  for (const text of texts) {
    const result = await runRefineAgent({
      rawInput: text,
      currentRoute: baseRoute,
      constraints: baseConstraints,
      persona,
      candidates: plan.candidates,
      originalRequest: baseConstraints.raw,
      useLLM: false,
    });
    results.push({
      text,
      expected: expectedIntent(text),
      actual: result.intent.primaryIntent,
      message: result.message,
      validation: result.summary.validationStatus,
      stamp: routeStamp(result.route),
      elapsedMs: result.elapsedMs,
      route: result.route,
    });
  }
  return results;
}

async function runSuzhouRemoteCase(input: string): Promise<ProductCaseResult> {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockAmapFetch as typeof fetch;
  try {
    const result = await buildAmapCityPlan(input, { city: '苏州', input }, PERSONA_MAP.friends);
    const route = result?.routes[0];
    const elapsedMs = result?.stageTimings
      ? Object.values(result.stageTimings).reduce((sum, ms) => sum + ms, 0)
      : 0;
    const badRe = /KTV|量贩|舞厅|夜店|酒吧|电玩城|电玩|洗浴|按摩|足浴|棋牌/i;
    const mealStops = route?.stops.filter((stop) => stop.scored.poi.category === 'dining') ?? [];
    const lunch = mealStops[0];
    const routeText = route?.stops.map((stop) => `${stop.scored.poi.name} ${stop.scored.reasons.join(' ')}`).join(' ') ?? '';
    const legs = route?.stops.map((stop) => stop.legFromPrev).filter(Boolean) ?? [];
    const totalMove = (route?.totalWalkMin ?? 0) + (route?.totalTransitMin ?? 0);
    const refineAction = parseRefine('车程太久了');
    const refined = route ? applyRefine(refineAction, route, result!.constraints, PERSONA_MAP.friends, result!.candidates) : null;
    const refinedMove = refined ? refined.route.totalWalkMin + refined.route.totalTransitMin : Infinity;
    const agentRefines = route
      ? await runAgentRefines(result!, PERSONA_MAP.friends, ['车程太久了', '多逛几个地方', '想喝奶茶'])
      : [];
    const asserts = [
      { name: '生成路线', pass: Boolean(route), desc: '高德试验链路返回一条路线' },
      { name: '生成耗时', pass: elapsedMs <= 10000, desc: '生成时间目标 <= 10s' },
      { name: 'POI 来源高德', pass: Boolean(route?.stops.every((stop) => stop.scored.poi.source === 'amap')), desc: '所有站点标记为 amap' },
      { name: '过滤噪声类型', pass: Boolean(route?.stops.every((stop) => !badRe.test(stop.scored.poi.name))), desc: '不出现 KTV/舞厅/电玩/酒吧/洗浴' },
      { name: '过滤低信誉小店', pass: Boolean(route?.stops.every((stop) => !/胡子饮食店|饮食店|工作室|私人影院/.test(stop.scored.poi.name))), desc: '不把低可信小店作为核心推荐' },
      { name: '含园林/文化', pass: Boolean(route?.stops.some((stop) => /园林|拙政园|景区|金鸡湖|展示馆|博物馆|公园/.test(stop.scored.poi.name))), desc: '至少 1 个园林/文化/公园类 POI' },
      { name: '含博物馆/展馆', pass: Boolean(route?.stops.some((stop) => /博物馆|展馆|展示馆|美术馆/.test(stop.scored.poi.name))), desc: '尽量安排博物馆/展馆' },
      { name: '正餐最多 1 个', pass: mealStops.length <= 1, desc: '6 小时以内不安排两顿正餐' },
      { name: '午饭在饭点', pass: Boolean(lunch && lunch.arrive >= 11.5 && lunch.arrive <= 13.5), desc: '午饭到达时间在 11:30-13:30' },
      { name: '单段车程上限', pass: legs.every((leg) => leg!.minutes <= 45), desc: '任意单段移动 <= 45 分钟' },
      { name: '单段距离上限', pass: legs.every((leg) => leg!.distM <= 12000), desc: '任意单段距离 <= 12km' },
      { name: '无异常移动值', pass: legs.every((leg) => leg!.minutes < 100) && totalMove < 100, desc: '不出现 100min 以上移动时间' },
      { name: '站数按节奏', pass: Boolean(route && route.stops.length >= 3 && route.stops.length <= 4), desc: '3-4 站，不机械固定 4 站' },
      { name: '文案不泛化', pass: Boolean(route && !/朋友聚会|吃货|出片|热闹局/.test(routeText)), desc: '文化场景理由不套用热闹聚会/吃货/出片话术' },
      { name: '识别车程修改', pass: refineAction.kind === 'reduceTravel' && Boolean(refined), desc: '“车程太久了”不再 unknown' },
      { name: '车程修改不变差', pass: Boolean(refined && refinedMove <= totalMove), desc: '临时修改后移动时间不增加' },
      { name: 'Agent intent JSON', pass: agentRefines.every((item) => item.actual === item.expected), desc: agentRefines.map((item) => `${item.text}:${item.actual}`).join(' / ') },
      { name: 'Agent 不再未识别', pass: agentRefines.every((item) => !/未能识别/.test(item.message) && item.actual !== 'unknown'), desc: '苏州自由文本修改均有结构化意图' },
      { name: 'Agent validator 闸门', pass: agentRefines.every((item) => item.validation !== 'fail' && !routeHasHardMove(item.route)), desc: '修改后路线无 fail,无 100min+ 或超长单段移动' },
      { name: 'Agent stamp 一致', pass: agentRefines.every((item) => item.validation === 'pass' ? true : item.stamp !== '拿来就走'), desc: '有 warn/fail 时不盖拿来就走' },
      { name: 'Agent 耗时', pass: agentRefines.every((item) => item.elapsedMs <= 10000), desc: '临时修改生成 <=10s 或降级 <=10s' },
    ];
    return {
      id: 'remote-suzhou',
      title: '苏州·园林博物馆午饭',
      asserts,
      allPass: asserts.every((item) => item.pass),
      stops: route?.stops.map((stop) => `${stop.scored.poi.name}(${stop.arrive.toFixed(2)}-${stop.depart.toFixed(2)})`) ?? [],
    };
  } finally {
    globalThis.fetch = oldFetch;
  }
}

function runDaxueluBudgetCase(input: string): ProductCaseResult {
  const result = runPipeline(input, PERSONA_MAP.friends);
  const route = result.routes[0];
  const cheap = route ? applyRefine(parseRefine('便宜一点'), route, result.constraints, PERSONA_MAP.friends, result.candidates) : null;
  const badPhotoLabel = result.routes.some((candidate, idx) => {
    const label = routeAdvantage(result.routes, idx, result.constraints.budgetPerCapita).label;
    const photoCount = candidate.stops.filter((stop) => stop.scored.poi.sceneTags.includes('photo')).length;
    return label === '拍照友好版' && photoCount === 0;
  });
  const asserts = [
    { name: '生成路线', pass: Boolean(route), desc: '大学路预算输入能生成路线' },
    { name: '进入预算', pass: Boolean(route && route.totalCost <= 230), desc: '推荐方案尽量 ≤ ¥230' },
    { name: '预算 repair 记录', pass: Boolean(result.repairLog?.some((log) => /预算/.test(log.trigger))), desc: '初始超预算时进入 repair' },
    { name: '便宜一点真降价', pass: Boolean(cheap && route && cheap.route.totalCost <= route.totalCost - 20), desc: '低预算操作显著降低人均' },
    { name: '无 0 出片标签', pass: !badPhotoLabel, desc: '不出现“拍照友好版 · 0 个出片点”' },
  ];
  return {
    id: 'budget-daxuelu',
    title: '大学路·人均200预算闭环',
    asserts,
    allPass: asserts.every((item) => item.pass),
    stops: route?.stops.map((stop) => `${stop.scored.poi.name}(¥${stop.scored.poi.perCapita})`).concat(cheap ? [`便宜一点:¥${cheap.route.totalCost}`] : []) ?? [],
  };
}

async function runHangzhouRemoteCase(input: string): Promise<ProductCaseResult> {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockAmapFetch as typeof fetch;
  try {
    const result = await buildAmapCityPlan(input, { city: '杭州', input }, PERSONA_MAP.friends);
    const route = result?.routes[0];
    const longJump = route?.stops.some((stop, idx) => idx > 0 && (stop.legFromPrev?.distM ?? 0) > 1800) ?? false;
    const routeText = route?.stops.map((stop) => `${stop.scored.poi.name} ${stop.scored.reasons.join(' ')}`).join(' ') ?? '';
    const agentRefines = route
      ? await runAgentRefines(result!, PERSONA_MAP.friends, ['想喝奶茶', '想喝咖啡', '安静一点'])
      : [];
    const asserts = [
      { name: '生成路线', pass: Boolean(route), desc: '杭州西湖高德链路返回路线' },
      { name: '站数轻松', pass: Boolean(route && route.stops.length >= 2 && route.stops.length <= 3), desc: '轻松逛为 2-3 站' },
      { name: '围绕西湖', pass: Boolean(route?.stops.every((stop) => /西湖|断桥|孤山|龙井|湖滨|花港/.test(stop.scored.poi.name))), desc: '不远距离跳出西湖附近' },
      { name: '不远跳', pass: Boolean(route && !longJump), desc: '段间距离不过大' },
      { name: '节奏文案', pass: /慢逛|休息|节奏不赶|轻量/.test(routeText), desc: '文案体现轻松慢逛' },
      { name: 'Agent intent JSON', pass: agentRefines.every((item) => item.actual === item.expected), desc: agentRefines.map((item) => `${item.text}:${item.actual}`).join(' / ') },
      { name: 'Agent 不再未识别', pass: agentRefines.every((item) => !/未能识别/.test(item.message) && item.actual !== 'unknown'), desc: '杭州自由文本修改均有结构化意图' },
      { name: 'Agent validator 闸门', pass: agentRefines.every((item) => item.validation !== 'fail' && !routeHasHardMove(item.route)), desc: '修改后路线无 fail,无 100min+ 或超长单段移动' },
      { name: 'Agent stamp 一致', pass: agentRefines.every((item) => item.validation === 'pass' ? true : item.stamp !== '拿来就走'), desc: '有 warn/fail 时不盖拿来就走' },
      { name: 'Agent 耗时', pass: agentRefines.every((item) => item.elapsedMs <= 10000), desc: '临时修改生成 <=10s 或降级 <=10s' },
    ];
    return {
      id: 'remote-hangzhou',
      title: '杭州·西湖轻松慢逛',
      asserts,
      allPass: asserts.every((item) => item.pass),
      stops: route?.stops.map((stop) => `${stop.scored.poi.name}(${stop.arrive.toFixed(2)}-${stop.depart.toFixed(2)})`) ?? [],
    };
  } finally {
    globalThis.fetch = oldFetch;
  }
}

function runShanghaiMockRegression(): ProductCaseResult {
  const input = '周日下午带4岁小孩在静安寺一带玩,要亲子友好不要太累,预算人均150,晚饭前要结束';
  const result = runPipeline(input, PERSONA_MAP.family);
  const route = result.routes[0];
  const asserts = [
    { name: '上海仍走 mock', pass: Boolean(route?.stops.every((stop) => stop.scored.poi.source !== 'amap')), desc: '上海稳定主流程不被非上海策略改成高德' },
    { name: '仍有路线', pass: Boolean(route && route.stops.length >= 3), desc: '主流程能生成 3 站以上路线' },
    { name: '预算达标或标记', pass: Boolean(route && (route.totalCost <= 150 * 1.15 || route.checks.some((check) => check.key === 'budget' && check.status !== 'pass'))), desc: '预算闭环仍可信' },
    { name: 'Agent Trace 完整', pass: (result.agentTrace?.length ?? 0) >= 9, desc: '上海 agent loop 未被破坏' },
  ];
  return {
    id: 'mock-shanghai',
    title: '上海 mock 主流程回归',
    asserts,
    allPass: asserts.every((item) => item.pass),
    stops: route?.stops.map((stop) => stop.scored.poi.name) ?? [],
  };
}

async function mockAmapFetch(input: unknown): Promise<Response> {
  const url = new URL(String(input), 'https://local.test');
  if (url.pathname.includes('/api/amap/route-walking')) {
    return jsonResponse({
      status: 'ok',
      configured: true,
      result: { distance: 64600, duration: 861, source: 'amap' },
    });
  }

  const keyword = url.searchParams.get('keyword') ?? '';
  const city = url.searchParams.get('city') ?? '';
  if (city.includes('杭州')) {
    return jsonResponse({
      status: 'ok',
      configured: true,
      results: mockHangzhouPois(keyword),
      source: 'amap_place_text',
    });
  }

  const commonBad = [
    { name: '苏州工业园区量贩KTV', address: '苏州工业园区', location: '120.704300,31.320000', type: '体育休闲服务;娱乐场所;KTV', source: 'amap' },
    { name: '金鸡湖电玩城', address: '苏州工业园区', location: '120.705300,31.321000', type: '体育休闲服务;娱乐场所;游戏厅', source: 'amap' },
  ];
  const results = keyword.includes('咖啡')
    ? [
      { name: '金鸡湖茶饮休息点', address: '苏州工业园区金鸡湖畔', location: '120.709000,31.318500', type: '餐饮服务;茶饮店;咖啡厅', source: 'amap' },
      { name: '诚品生活轻食咖啡', address: '苏州工业园区诚品生活', location: '120.718000,31.317000', type: '餐饮服务;咖啡厅;轻食', source: 'amap' },
      ...commonBad,
    ]
    : keyword.includes('美食')
    ? [
      { name: '胡子饮食店', address: '苏州工业园区小巷', location: '120.704500,31.321500', type: '餐饮服务;中餐厅', source: 'amap' },
      { name: '苏州园区本帮菜馆', address: '苏州工业园区星湖街', location: '120.706000,31.322000', type: '餐饮服务;中餐厅', source: 'amap' },
      ...commonBad,
    ]
    : keyword.includes('博物馆')
      ? [
        { name: '苏州博物馆西馆', address: '苏州市高新区长江路', location: '120.577000,31.298000', type: '科教文化服务;博物馆', source: 'amap' },
        { name: '苏州工业园区规划展示馆', address: '苏州工业园区', location: '120.705000,31.319000', type: '科教文化服务;展览馆', source: 'amap' },
        ...commonBad,
      ]
      : [
        { name: '金鸡湖景区', address: '苏州工业园区金鸡湖', location: '120.715000,31.313000', type: '风景名胜;公园广场;风景名胜', source: 'amap' },
        { name: '拙政园', address: '苏州市姑苏区东北街', location: '120.629800,31.324900', type: '风景名胜;园林', source: 'amap' },
        { name: '苏州中心广场', address: '苏州工业园区', location: '120.681000,31.318000', type: '购物服务;商场', source: 'amap' },
        ...commonBad,
      ];

  return jsonResponse({
    status: 'ok',
    configured: true,
    results,
    source: 'amap_place_text',
  });
}

function mockHangzhouPois(keyword: string): AmapMockPoi[] {
  const bad = [
    { name: '西湖量贩KTV', address: '杭州市西湖区', location: '120.146000,30.257000', type: '体育休闲服务;娱乐场所;KTV', source: 'amap' },
  ];
  if (keyword.includes('咖啡')) {
    return [
      { name: '西湖边轻食咖啡', address: '杭州市西湖区北山街', location: '120.145000,30.254000', type: '餐饮服务;咖啡厅', source: 'amap' },
      ...bad,
    ];
  }
  if (keyword.includes('博物馆')) {
    return [
      { name: '浙江省博物馆孤山馆区', address: '杭州市西湖区孤山路', location: '120.147000,30.253000', type: '科教文化服务;博物馆', source: 'amap' },
      { name: '杭州西湖博物馆', address: '杭州市上城区南山路', location: '120.155000,30.244000', type: '科教文化服务;博物馆', source: 'amap' },
      ...bad,
    ];
  }
  return [
    { name: '西湖断桥残雪', address: '杭州市西湖区北山街', location: '120.146500,30.258000', type: '风景名胜;风景名胜', source: 'amap' },
    { name: '西湖花港观鱼', address: '杭州市西湖区南山路', location: '120.135000,30.231000', type: '风景名胜;公园广场', source: 'amap' },
    { name: '龙井路慢行街区', address: '杭州市西湖区龙井路', location: '120.125000,30.238000', type: '风景名胜;风景名胜', source: 'amap' },
    ...bad,
  ];
}

interface AmapMockPoi {
  name: string;
  address: string;
  location: string;
  type: string;
  source: string;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
