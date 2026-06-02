import {
  CASES, PERSONA_DIFF_CASES, runCase, runPersonaDiff,
} from '../src/eval/cases';

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

// ---- 汇总 ----
const assertRate = ((passAsserts / totalAsserts) * 100).toFixed(1);
const caseRate = ((allPassCases / CASES.length) * 100).toFixed(1);
const diffRate = ((distinctCount / PERSONA_DIFF_CASES.length) * 100).toFixed(1);

console.log(`${C.bold}${C.cyan}══════ 汇总 ══════${C.reset}`);
console.log(`断言通过:  ${C.bold}${passAsserts}/${totalAsserts}${C.reset}  (${assertRate}%)`);
console.log(`全过 case:  ${C.bold}${allPassCases}/${CASES.length}${C.reset}  (${caseRate}%)`);
console.log(`画像差异:  ${C.bold}${distinctCount}/${PERSONA_DIFF_CASES.length}${C.reset}  (${diffRate}%) ${C.dim}← 证明非预制模板${C.reset}`);
console.log('');

const ok = passAsserts === totalAsserts && distinctCount === PERSONA_DIFF_CASES.length;
process.exit(ok ? 0 : 1);
