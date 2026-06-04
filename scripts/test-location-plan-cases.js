import { existsSync, readFileSync } from 'node:fs';
import handler from '../api/ai/plan.js';

function loadLocalEnv() {
  if (!existsSync('.env.local')) return;
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const cases = [
  {
    id: 'zhejiang-yuhang-westlake-xixi',
    input: '朋友来浙江玩，上午10点到余杭区，人均150，想去西湖、西湿地公园',
    expect: { status: 'ok', city: '杭州', anchors: ['余杭区', '西湖', '西溪湿地公园'], source: 'amap+deepseek' },
  },
  {
    id: 'zhejiang-only',
    input: '朋友来浙江玩',
    expect: { status: 'needs-clarification', province: '浙江省', options: ['杭州', '宁波', '绍兴', '温州'] },
  },
  {
    id: 'wuhan-hongshan',
    input: '朋友来武汉玩，上午10点到洪山区，想去黄鹤楼和东湖',
    expect: { status: 'ok', city: '武汉', anchors: ['洪山区', '黄鹤楼', '东湖'], source: 'amap+deepseek' },
  },
  {
    id: 'hubei-poi',
    input: '朋友来湖北玩，想去黄鹤楼和东湖',
    expect: { status: 'ok', city: '武汉', source: 'amap+deepseek' },
  },
  {
    id: 'changsha-poi',
    input: '朋友来长沙玩，想去岳麓山和橘子洲',
    expect: { status: 'ok', city: '长沙', source: 'amap+deepseek' },
  },
  {
    id: 'hunan-poi',
    input: '朋友来湖南玩，想去岳麓山和橘子洲',
    expect: { status: 'ok', city: '长沙', source: 'amap+deepseek' },
  },
  {
    id: 'nanjing-poi',
    input: '朋友来南京玩，想去夫子庙和博物馆',
    expect: { status: 'ok', city: '南京', source: 'amap+deepseek' },
  },
  {
    id: 'xiamen-poi',
    input: '朋友来厦门玩，想去鼓浪屿和沙坡尾',
    expect: { status: 'ok', city: '厦门', source: 'amap+deepseek' },
  },
  {
    id: 'beijing-haidian',
    input: '朋友来北京玩，上午10点到海淀区，人均150，想吃brunch，逛一下博物馆',
    expect: { status: 'ok', city: '北京', source: 'amap+deepseek' },
  },
  {
    id: 'urumqi',
    input: '朋友来新疆玩，上午10点到乌鲁木齐，人均150，想吃羊肉串，逛一下博物馆',
    expect: { status: 'ok', city: '乌鲁木齐', source: 'amap+deepseek' },
  },
  {
    id: 'shanghai',
    input: '朋友来上海玩，上午10点到，人均150，想逛博物馆',
    expect: { status: 'ok', city: '上海', sourceAny: ['amap+deepseek', 'mock-shanghai-demo'] },
  },
  {
    id: 'suzhou-wujiang-mixc-ancient-town',
    input: '朋友来苏州吴江区玩，他上午10点到，打算带他万象汇吃个午饭，人均150元以内；然后下午去边上的古镇玩一下',
    expect: { status: 'ok', city: '苏州', district: '吴江区', anchors: ['吴江区', '万象汇'], source: 'amap+deepseek' },
  },
];

function makeRes(resolve) {
  return {
    code: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      resolve({ code: this.code, payload });
      return payload;
    },
  };
}

async function callPlan(input, index) {
  return new Promise((resolve) => {
    const req = {
      method: 'POST',
      body: {
        userId: 'location-test-user',
        sessionId: `location-test-${index}`,
        request: input,
        preferences: {},
        previousPlan: null,
      },
    };
    void handler(req, makeRes(resolve));
  });
}

function includesAll(actual = [], expected = []) {
  return expected.every((item) => actual.includes(item));
}

function check(summary, expect) {
  const failures = [];
  if (expect.status && summary.status !== expect.status) failures.push(`status expected ${expect.status}, got ${summary.status}`);
  if (expect.city && summary.city !== expect.city) failures.push(`city expected ${expect.city}, got ${summary.city}`);
  if (expect.province && summary.province !== expect.province) failures.push(`province expected ${expect.province}, got ${summary.province}`);
  if (expect.district && summary.district !== expect.district) failures.push(`district expected ${expect.district}, got ${summary.district}`);
  if (expect.source && summary.source !== expect.source) failures.push(`source expected ${expect.source}, got ${summary.source}`);
  if (expect.sourceAny && !expect.sourceAny.includes(summary.source)) failures.push(`source expected one of ${expect.sourceAny.join('/')}, got ${summary.source}`);
  if (expect.anchors && !includesAll(summary.anchors, expect.anchors)) failures.push(`anchors missing ${expect.anchors.filter((item) => !summary.anchors.includes(item)).join('/')}`);
  if (expect.options && !includesAll(summary.clarificationOptions, expect.options)) failures.push(`options missing ${expect.options.filter((item) => !summary.clarificationOptions.includes(item)).join('/')}`);
  if (summary.city === '上海' && expect.city && expect.city !== '上海') failures.push('unexpected Shanghai leakage');
  return failures;
}

loadLocalEnv();

const results = [];
for (let index = 0; index < cases.length; index += 1) {
  const item = cases[index];
  const { code, payload } = await callPlan(item.input, index);
  const summary = {
    id: item.id,
    http: code,
    status: payload.status,
    source: payload.source,
    city: payload.city,
    province: payload.province,
    district: payload.district,
    anchors: payload.anchors ?? [],
    clarificationOptions: payload.clarificationOptions ?? payload.locationResolution?.clarificationOptions ?? [],
    dataSources: {
      amapDistrict: {
        configured: Boolean(payload.dataSources?.amapDistrict?.configured),
        used: Boolean(payload.dataSources?.amapDistrict?.used),
        status: payload.dataSources?.amapDistrict?.status,
      },
      amapPoi: {
        configured: Boolean(payload.dataSources?.amapPoi?.configured),
        used: Boolean(payload.dataSources?.amapPoi?.used),
        status: payload.dataSources?.amapPoi?.status,
      },
      deepseek: {
        configured: Boolean(payload.dataSources?.deepseek?.configured),
        used: Boolean(payload.dataSources?.deepseek?.used),
        status: payload.dataSources?.deepseek?.status,
      },
      mock: {
        used: Boolean(payload.dataSources?.mock?.used),
      },
    },
    nodes: (payload.plan?.nodes ?? []).map((node) => node.name),
  };
  const failures = check(summary, item.expect);
  results.push({ ...summary, pass: failures.length === 0, failures });
  console.log(JSON.stringify(results.at(-1), null, 2));
}

const failed = results.filter((item) => !item.pass);
if (failed.length) {
  console.error(`Location plan cases failed: ${failed.map((item) => item.id).join(', ')}`);
  process.exit(1);
}
