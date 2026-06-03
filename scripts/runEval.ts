import {
  CASES, PERSONA_DIFF_CASES, runCase, runPersonaDiff,
} from '../src/eval/cases';
import { PERSONA_MAP } from '../src/data/personas';
import { buildAmapCityPlan } from '../src/lib/amapPlan';

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

// ---- Part 3: 非上海真实 POI 试验链路语义回归 ----
console.log(`${C.bold}【Part 3】非上海高德 POI 试验链路(1 case)${C.reset}\n`);

const suzhouInput = '朋友来苏州，带他园区转转，他上午10点到，预算300吃午饭，打算逛园林、博物馆';
const remoteResult = await runSuzhouRemoteCase(suzhouInput);
const remoteTag = remoteResult.allPass ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
console.log(`${remoteTag} [remote-suzhou] 苏州·园林博物馆午饭`);
console.log(`     ${C.dim}路线:${remoteResult.stops.join(' → ')}${C.reset}`);
for (const a of remoteResult.asserts) {
  const mark = a.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  console.log(`       ${mark} ${a.name} ${C.dim}— ${a.desc}${C.reset}`);
}
console.log('');

// ---- 汇总 ----
const assertRate = ((passAsserts / totalAsserts) * 100).toFixed(1);
const caseRate = ((allPassCases / CASES.length) * 100).toFixed(1);
const diffRate = ((distinctCount / PERSONA_DIFF_CASES.length) * 100).toFixed(1);

console.log(`${C.bold}${C.cyan}══════ 汇总 ══════${C.reset}`);
console.log(`断言通过:  ${C.bold}${passAsserts}/${totalAsserts}${C.reset}  (${assertRate}%)`);
console.log(`全过 case:  ${C.bold}${allPassCases}/${CASES.length}${C.reset}  (${caseRate}%)`);
console.log(`画像差异:  ${C.bold}${distinctCount}/${PERSONA_DIFF_CASES.length}${C.reset}  (${diffRate}%) ${C.dim}← 证明非预制模板${C.reset}`);
console.log(`远程试验:  ${remoteResult.allPass ? C.green : C.red}${remoteResult.allPass ? '1/1' : '0/1'}${C.reset} ${C.dim}← 非上海真实 POI 语义护栏${C.reset}`);
console.log('');

const ok = passAsserts === totalAsserts && distinctCount === PERSONA_DIFF_CASES.length && remoteResult.allPass;
process.exit(ok ? 0 : 1);

async function runSuzhouRemoteCase(input: string): Promise<{
  asserts: { name: string; pass: boolean; desc: string }[];
  allPass: boolean;
  stops: string[];
}> {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockAmapFetch as typeof fetch;
  try {
    const result = await buildAmapCityPlan(input, { city: '苏州', input }, PERSONA_MAP.friends);
    const route = result?.routes[0];
    const badRe = /KTV|量贩|舞厅|夜店|酒吧|电玩城|电玩|洗浴|按摩|足浴|棋牌/i;
    const mealStops = route?.stops.filter((stop) => stop.scored.poi.category === 'dining') ?? [];
    const lunch = mealStops[0];
    const asserts = [
      { name: '生成路线', pass: Boolean(route), desc: '高德试验链路返回一条路线' },
      { name: 'POI 来源高德', pass: Boolean(route?.stops.every((stop) => stop.scored.poi.source === 'amap')), desc: '所有站点标记为 amap' },
      { name: '过滤噪声类型', pass: Boolean(route?.stops.every((stop) => !badRe.test(stop.scored.poi.name))), desc: '不出现 KTV/舞厅/电玩/酒吧/洗浴' },
      { name: '正餐最多 1 个', pass: mealStops.length <= 1, desc: '6 小时以内不安排两顿正餐' },
      { name: '午饭在饭点', pass: Boolean(lunch && lunch.arrive >= 11.5 && lunch.arrive <= 13.5), desc: '午饭到达时间在 11:30-13:30' },
      { name: '站数按节奏', pass: route?.stops.length === 3, desc: '5 小时普通节奏生成 3 站，不固定 4 站' },
      { name: '文案不泛化', pass: Boolean(route?.stops.some((stop) => stop.scored.reasons.join('').includes('文化/园林/博物馆'))), desc: '文化场景理由不套用热闹聚会话术' },
    ];
    return {
      asserts,
      allPass: asserts.every((item) => item.pass),
      stops: route?.stops.map((stop) => `${stop.scored.poi.name}(${stop.arrive.toFixed(2)}-${stop.depart.toFixed(2)})`) ?? [],
    };
  } finally {
    globalThis.fetch = oldFetch;
  }
}

async function mockAmapFetch(input: unknown): Promise<Response> {
  const url = new URL(String(input), 'https://local.test');
  if (url.pathname.includes('/api/amap/route-walking')) {
    return jsonResponse({
      status: 'ok',
      configured: true,
      result: { distance: 720, duration: 9, source: 'amap' },
    });
  }

  const keyword = url.searchParams.get('keyword') ?? '';
  const commonBad = [
    { name: '苏州工业园区量贩KTV', address: '苏州工业园区', location: '120.704300,31.320000', type: '体育休闲服务;娱乐场所;KTV', source: 'amap' },
    { name: '金鸡湖电玩城', address: '苏州工业园区', location: '120.705300,31.321000', type: '体育休闲服务;娱乐场所;游戏厅', source: 'amap' },
  ];
  const results = keyword.includes('美食')
    ? [
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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
