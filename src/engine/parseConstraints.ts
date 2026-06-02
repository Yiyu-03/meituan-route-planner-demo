import type { Constraints, SceneTag, Category, Persona, IntentDraft } from '../types';
import { AREAS } from '../data/areas';

// ------------------------------------------------------------
// ① parseConstraints
// 规则式抽取:确定性、可在面板里逐条解释命中关键词。
// 刻意不调用 LLM —— 抽取过程必须可审计,这是「非黑盒」的基础。
// ------------------------------------------------------------

const CITY_KEYS = ['上海', '魔都'];

// 区域别名 → area.key
const AREA_ALIASES: Record<string, string> = {
  外滩: 'bund', '外滩源': 'bund',
  人民广场: 'peoplesq', 人广: 'peoplesq', 南京路: 'peoplesq',
  新天地: 'xintiandi',
  田子坊: 'tianzifang', 打浦桥: 'tianzifang',
  静安: 'jingan', 静安寺: 'jingan',
  徐家汇: 'xujiahui',
  陆家嘴: 'lujiazui',
  武康路: 'wukang', 衡复: 'wukang', 衡山路: 'wukang',
  豫园: 'yuyuan', 老城厢: 'yuyuan', 城隍庙: 'yuyuan',
  大学路: 'daxuelu', 五角场: 'daxuelu', 杨浦: 'daxuelu',
};

// 场景偏好词典(正向)
const PREF_LEX: { tag: SceneTag; words: string[] }[] = [
  { tag: 'romantic', words: ['浪漫', '约会', '情侣', '氛围', '小资', '情调'] },
  { tag: 'quiet', words: ['安静', '清净', '安安静静', '不吵', '僻静', '慢'] },
  { tag: 'photo', words: ['拍照', '出片', '打卡', '上镜', '好看', '颜值'] },
  { tag: 'family', words: ['带娃', '小孩', '孩子', '亲子', '宝宝', '儿童', '遛娃'] },
  { tag: 'lively', words: ['热闹', '好玩', '气氛', '嗨', '聚会', '聚餐'] },
  { tag: 'cultural', words: ['文艺', '文化', '艺术', '展', '博物馆', '书店', '历史', '园林'] },
  { tag: 'trendy', words: ['网红', '潮', '时髦', '新潮', '潮流'] },
  { tag: 'local', words: ['本地', '老上海', '地道', '烟火', '小吃', '特色'] },
  { tag: 'upscale', words: ['精致', '高端', '高档', '正式', '商务', '档次'] },
  { tag: 'budget', words: ['便宜', '实惠', '性价比', '平价', '不贵', '省'] },
  { tag: 'nature', words: ['自然', '绿', '公园', '江边', '滨江', '户外'] },
  { tag: 'nightlife', words: ['酒吧', '夜生活', '蹦迪', '小酌', '喝一杯', 'livehouse', '夜店'] },
  { tag: 'foodie', words: ['好吃', '美食', '吃货', '吃点好的', '大餐'] },
];

// 规避词:出现「不要X / 别太X / 不想X」时取消该 tag
const AVOID_PATTERNS: { re: RegExp; tag: SceneTag }[] = [
  { re: /不要(太)?吵|别(太)?吵|太吵/, tag: 'lively' },
  { re: /不要太累|不想太累|别太累/, tag: 'lively' },
  { re: /不要太赶|别太赶|不想太赶|不赶/, tag: 'lively' },
  { re: /不要太贵|别太贵|不想太贵|不贵/, tag: 'upscale' },
  { re: /不要(去)?酒吧|不喝酒|没有酒/, tag: 'nightlife' },
];

const CAT_LEX: { cat: Category; words: string[] }[] = [
  { cat: 'dining', words: ['吃饭', '吃', '美食', '正餐', '晚饭', '午饭', '大餐', '餐厅'] },
  { cat: 'cafe', words: ['咖啡', '喝咖啡', '茶', '下午茶', '奶茶'] },
  { cat: 'culture', words: ['博物馆', '美术馆', '展', '园林', '书店', '历史', '文化', '科技馆'] },
  { cat: 'entertainment', words: ['演出', '话剧', '剧场', '电影', '密室', '桌游', '乐园', '玩'] },
  { cat: 'shopping', words: ['逛街', '购物', '商场', '买', '淘'] },
  { cat: 'nightscape', words: ['夜景', '酒吧', '看景', '江景', '登高', '夜游', '灯'] },
];

/** 解析时间:支持「下午/晚上/早上」「X点」「从下午到晚上」 */
function parseStartTime(raw: string): { hour: number; matched: string[] } {
  const matched: string[] = [];
  // 显式「X点」,但排除「X点前/之前/以前」这类截止语义(那是结束时间,不是出发)
  const m = raw.match(/(\d{1,2})\s*点(?!前|之前|以前|钟前|结束|回)/);
  if (m) {
    let h = parseInt(m[1], 10);
    // 模糊处理:若文本含「晚/下午」且 h<12 视作下午;但若同时出现「中午」起始信号则不强转
    if (/晚|下午/.test(raw) && h <= 9 && !/中午/.test(raw)) h += 12;
    matched.push(`${h}点出发`);
    return { hour: h, matched };
  }
  if (/凌晨|半夜/.test(raw)) { matched.push('凌晨'); return { hour: 0.5, matched }; }
  if (/早上|上午|一早/.test(raw)) { matched.push('上午'); return { hour: 10, matched }; }
  if (/中午/.test(raw)) { matched.push('中午'); return { hour: 12, matched }; }
  if (/下午/.test(raw)) { matched.push('下午'); return { hour: 14, matched }; }
  if (/傍晚/.test(raw)) { matched.push('傍晚'); return { hour: 17, matched }; }
  if (/晚上|夜里|晚/.test(raw)) { matched.push('晚上'); return { hour: 18.5, matched }; }
  if (/白天/.test(raw)) { matched.push('白天'); return { hour: 13, matched }; }
  return { hour: 14, matched }; // 默认下午 2 点
}

/** 解析人均预算:「人均X」「X左右」「X以内」「预算X」 */
function parseBudget(raw: string): { budget: number | null; matched: string[] } {
  const matched: string[] = [];
  const patterns = [
    /人均\s*(\d{2,4})/,
    /预算\s*(?:人均)?\s*(\d{2,4})/,
    /(\d{2,4})\s*(?:左右|以内|以下|块|元)/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) {
      const v = parseInt(m[1], 10);
      matched.push(`预算¥${v}`);
      return { budget: v, matched };
    }
  }
  return { budget: null, matched };
}

/** 解析时长/结束时间提示 */
function parseDuration(raw: string, startHour: number): { durationMin: number; matched: string[] } {
  const matched: string[] = [];
  // 「玩一天」
  if (/一天|整天|玩一天/.test(raw)) { matched.push('玩一天'); return { durationMin: 360, matched }; }
  // 「从下午到晚上 / 逛到晚上」
  if (/(下午|白天).*(晚上|夜)|逛到晚上|到晚上/.test(raw)) {
    matched.push('下午到晚上');
    return { durationMin: 300, matched };
  }
  // 「半天」
  if (/半天/.test(raw)) { matched.push('半天'); return { durationMin: 240, matched }; }
  // 「晚饭前结束 / X点前回家」→ 反推时长
  const endM = raw.match(/(\d{1,2})\s*点前/);
  if (endM) {
    let endH = parseInt(endM[1], 10);
    if (endH <= 9) endH += 12;
    matched.push(`${endH}点前结束`);
    return { durationMin: Math.max(120, Math.round((endH - startHour) * 60)), matched };
  }
  if (/晚饭前/.test(raw)) {
    matched.push('晚饭前结束');
    return { durationMin: Math.max(120, Math.round((18 - startHour) * 60)), matched };
  }
  // 默认按起始时间给:晚上偏短,白天偏长
  if (startHour >= 18) return { durationMin: 240, matched };
  return { durationMin: 300, matched };
}

function parseParty(raw: string): { party: number; matched: string[] } {
  const matched: string[] = [];
  const cnMap: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 };
  // 「五个朋友 / 几个同学」
  const m = raw.match(/([一两二三四五六七八]|\d+)\s*(?:个|位)?\s*(?:朋友|同学|人|家)/);
  if (m) {
    const n = cnMap[m[1]] ?? parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > 0) { matched.push(`${n}人`); return { party: n, matched }; }
  }
  if (/情侣|对象|女朋友|男朋友|两个人|和.*(她|他)/.test(raw)) { matched.push('2人'); return { party: 2, matched }; }
  if (/一个人|独自|自己/.test(raw)) { matched.push('1人'); return { party: 1, matched }; }
  if (/带娃|带孩子|一家|全家/.test(raw)) { matched.push('家庭3人'); return { party: 3, matched }; }
  return { party: 0, matched }; // 0 = 用画像默认
}

function parsePace(raw: string): 'relaxed' | 'normal' | 'packed' | null {
  if (/不要太赶|别太赶|不赶|慢慢|轻松|不要太累|别太累/.test(raw)) return 'relaxed';
  if (/多逛|多玩|尽量多|紧凑|赶一点/.test(raw)) return 'packed';
  return null;
}

function parseTransport(raw: string): Constraints['transport'] {
  if (/打车|地铁|公交|开车/.test(raw)) return 'mixed';
  if (/走路|步行|citywalk|散步/.test(raw)) return 'walk';
  return 'mixed';
}

/** 只做文本意图抽取,不注入任何画像默认值。 */
export function parseIntent(raw: string): IntentDraft {
  const matched: string[] = [];

  // city
  const cityHit = CITY_KEYS.find((c) => raw.includes(c));
  const city = cityHit ?? '上海';
  if (cityHit) matched.push(cityHit);

  // areas
  const areaHits: string[] = [];
  for (const [alias, key] of Object.entries(AREA_ALIASES)) {
    if (raw.includes(alias) && !areaHits.includes(key)) {
      areaHits.push(key);
      matched.push(alias);
    }
  }

  // time
  const st = parseStartTime(raw);
  matched.push(...st.matched);

  // duration
  const du = parseDuration(raw, st.hour);
  matched.push(...du.matched);

  // party
  const pa = parseParty(raw);
  matched.push(...pa.matched);

  // budget
  const bu = parseBudget(raw);
  matched.push(...bu.matched);

  // prefs (正向)
  const prefs = new Set<SceneTag>();
  for (const { tag, words } of PREF_LEX) {
    const hit = words.find((w) => raw.includes(w));
    if (hit) { prefs.add(tag); matched.push(hit); }
  }

  // avoid(规避):命中后从 prefs 移除并加入 avoid
  const avoid = new Set<SceneTag>();
  for (const { re, tag } of AVOID_PATTERNS) {
    const m = raw.match(re);
    if (m) { avoid.add(tag); prefs.delete(tag); matched.push(`规避「${m[0]}」`); }
  }

  // categories(必去类目)
  const mustCategories = new Set<Category>();
  for (const { cat, words } of CAT_LEX) {
    const hit = words.find((w) => raw.includes(w));
    if (hit) mustCategories.add(cat);
  }

  // pace
  return {
    city,
    areaHits,
    startTime: st.hour,
    durationMin: du.durationMin,
    party: pa.party,
    budgetPerCapita: bu.budget,
    prefs: [...prefs],
    avoid: [...avoid],
    mustCategories: [...mustCategories],
    avoidCategories: avoid.has('nightlife') ? ['nightscape'] : [],
    transport: parseTransport(raw),
    pace: parsePace(raw),
    raw,
    matched,
  };
}

/** 把 intent + 画像合成为可执行约束。画像只补默认,不覆盖显式文本。 */
export function finalizeConstraints(intent: IntentDraft, persona: Persona): Constraints {
  const areaTag = intent.areaHits.length ? `@${intent.areaHits.join(',')}` : '';

  return {
    city: intent.city + areaTag,
    startTime: intent.startTime,
    durationMin: intent.durationMin,
    party: intent.party || persona.partyDefault,
    budgetPerCapita: intent.budgetPerCapita,
    prefs: intent.prefs,
    avoid: intent.avoid,
    mustCategories: intent.mustCategories,
    avoidCategories: intent.avoidCategories,
    transport: intent.transport,
    pace: intent.pace ?? persona.pace,
    raw: intent.raw,
    matched: intent.matched,
  };
}

/**
 * 兼容旧入口。persona 用于补默认值(party / pace),但**不**覆盖文本里的显式信息。
 */
export function parseConstraints(raw: string, persona: Persona): Constraints {
  return finalizeConstraints(parseIntent(raw), persona);
}

/** 从 constraints.city 里解析出锚定区域 keys */
export function anchorAreas(c: Constraints): string[] {
  const at = c.city.split('@')[1];
  if (!at) return [];
  return at.split(',').filter((k) => AREAS.some((a) => a.key === k));
}
