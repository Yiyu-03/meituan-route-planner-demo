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

async function callPlan(input, id) {
  return new Promise((resolve) => {
    const req = {
      method: 'POST',
      body: {
        userId: 'planner-regression-user',
        sessionId: `planner-regression-${id}`,
        request: input,
        preferences: {},
        previousPlan: null,
      },
    };
    void handler(req, makeRes(resolve));
  });
}

function parseClock(value) {
  const match = String(value ?? '').match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
}

function nodeStart(node) {
  return parseClock(String(node.time ?? '').split(/[-–—]/)[0]);
}

function nodeEnd(node) {
  return parseClock(String(node.time ?? '').split(/[-–—]/)[1]);
}

function assertCase(name, condition, detail) {
  if (!condition) throw new Error(`${name}: ${detail}`);
}

function assertNoInternalCopy(payload) {
  const publicText = JSON.stringify({
    status: payload.status,
    source: payload.source,
    summary: payload.plan?.summary,
    warnings: payload.warnings,
    nodes: (payload.plan?.nodes ?? []).map((node) => ({ name: node.name, reason: node.reason })),
    preferenceImpact: payload.preferenceImpact,
  });
  assertCase('no internal provider copy', !/DeepSeek|API key|JSON|上游|adapter|llm|token|鉴权|模型/i.test(publicText), publicText);
}

function assertTimelineIncludesLegs(payload) {
  const nodes = payload.plan?.nodes ?? [];
  for (let index = 1; index < nodes.length; index += 1) {
    const prevEnd = nodeEnd(nodes[index - 1]);
    const start = nodeStart(nodes[index]);
    const legMin = Number(nodes[index].moveFromPrev?.minutes ?? 0);
    if (prevEnd == null || start == null || !legMin) continue;
    const expected = prevEnd + legMin / 60;
    assertCase(
      'timeline includes leg minutes',
      start + 0.04 >= expected,
      `${nodes[index - 1].name} -> ${nodes[index].name}: ${nodes[index - 1].time}, leg=${legMin}, next=${nodes[index].time}`,
    );
  }
}

loadLocalEnv();

const cases = [
  {
    id: 'hangzhou-yuhang-male-friends',
    input: '朋友来杭州，打算带他在余杭区逛逛，是同性朋友，都是男的',
    check(payload) {
      assertCase('city', payload.city === '杭州', `got ${payload.city}`);
      const names = (payload.plan?.nodes ?? []).map((node) => node.name).join(' / ');
      assertCase('bad social merchant filtered', !/朋友圈|四个朋友|情侣|约会/.test(names), names);
      assertTimelineIncludesLegs(payload);
      assertNoInternalCopy(payload);
    },
  },
  {
    id: 'suzhou-wujiang-ten-hours',
    input: '朋友来苏州吴江区玩，他上午10点到，打算带他万象汇吃个午饭，人均150元以内；然后下午去边上的古镇玩一下，玩10个小时',
    check(payload) {
      assertCase('duration parsed', payload.constraints?.durationMin >= 590, `duration=${payload.constraints?.durationMin}`);
      const nodes = payload.plan?.nodes ?? [];
      assertCase('has route or asks adjustment', nodes.length >= 2 || payload.status === 'needs-adjustment', `nodes=${nodes.length}, status=${payload.status}`);
      if (nodes.length >= 2) {
        const end = nodeEnd(nodes[nodes.length - 1]);
        assertCase('ten hour schedule', end == null || end >= 19.2 || payload.status === 'needs-adjustment', `end=${end}, status=${payload.status}`);
        assertTimelineIncludesLegs(payload);
      }
      assertNoInternalCopy(payload);
    },
  },
];

const savedDeepseekKey = process.env.DEEPSEEK_API_KEY;
cases.push({
  id: 'deepseek-fallback-copy',
  input: '朋友来杭州玩，上午10点到余杭区，想去西湖和西溪湿地',
  before() {
    delete process.env.DEEPSEEK_API_KEY;
  },
  after() {
    if (savedDeepseekKey) process.env.DEEPSEEK_API_KEY = savedDeepseekKey;
  },
  check(payload) {
    assertCase('fallback has usable status', ['ok', 'needs-adjustment', 'fallback-no-data'].includes(payload.status), `status=${payload.status}`);
    assertNoInternalCopy(payload);
  },
});

const results = [];
for (const item of cases) {
  try {
    item.before?.();
    const { code, payload } = await callPlan(item.input, item.id);
    assertCase('http 200', code === 200, `http=${code}`);
    item.check(payload);
    results.push({ id: item.id, pass: true, status: payload.status, source: payload.source, city: payload.city, requestId: payload.requestId });
  } catch (error) {
    results.push({ id: item.id, pass: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    item.after?.();
  }
}

for (const result of results) {
  console.log(JSON.stringify(result, null, 2));
}

const failed = results.filter((item) => !item.pass);
if (failed.length) {
  console.error(`Planner regression cases failed: ${failed.map((item) => item.id).join(', ')}`);
  process.exit(1);
}
