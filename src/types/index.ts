// ============================================================
// types/index.ts — 单一事实源
// ============================================================

/** POI 大类 */
export type Category =
  | 'dining'        // 餐饮
  | 'cafe'          // 咖啡 / 茶
  | 'culture'       // 文化(美术馆/博物馆/历史街区/书店)
  | 'entertainment' // 娱乐(剧场/livehouse/密室/亲子乐园)
  | 'shopping'      // 购物
  | 'nightscape';   // 夜景 / 酒吧 / 江景

export const CATEGORY_LABEL: Record<Category, string> = {
  dining: '餐饮',
  cafe: '咖啡茶饮',
  culture: '文化艺术',
  entertainment: '娱乐体验',
  shopping: '购物',
  nightscape: '夜景酒吧',
};

/** 场景标签 —— 推荐模型的核心特征,画像在这些维度上有不同权重 */
export type SceneTag =
  | 'romantic'   // 情侣感
  | 'quiet'      // 安静
  | 'photo'      // 出片/拍照
  | 'family'     // 亲子友好
  | 'lively'     // 热闹
  | 'cultural'   // 文艺/有内容
  | 'trendy'     // 网红/潮流
  | 'local'      // 本地烟火
  | 'upscale'    // 高端精致
  | 'budget'     // 平价实惠
  | 'nature'     // 自然/绿意
  | 'nightlife'  // 夜生活
  | 'foodie';    // 资深吃货向

export const SCENE_LABEL: Record<SceneTag, string> = {
  romantic: '情侣氛围', quiet: '安静', photo: '出片', family: '亲子友好',
  lively: '热闹', cultural: '文艺', trendy: '网红潮流', local: '本地烟火',
  upscale: '精致高端', budget: '平价', nature: '自然绿意', nightlife: '夜生活',
  foodie: '吃货向',
};

/** Mock 数据来源,用于证明路线不是一句话写死,而是融合生活数据 + 导航数据 */
export type DataSource = 'mock_dianping' | 'mock_meituan' | 'mock_map' | 'amap';

export type Freshness = 'realtime' | 'daily' | 'static';

/** 区域(用于地理距离计算) */
export interface Area {
  key: string;
  name: string;
  lat: number;
  lng: number;
}

/** POI 数据结构 */
export interface POI {
  id: string;
  name: string;
  category: Category;
  area: string;          // Area.key
  lat: number;
  lng: number;
  rating: number;        // 1.0 - 5.0
  reviews: number;       // 点评数
  perCapita: number;     // 人均 ¥(cafe/culture 可为门票或单价)
  openHour: number;      // 24h 制,营业开始(小时,可含 .5)
  closeHour: number;     // 营业结束(可 >24 表示次日,如 26 = 次日2点)
  avgDuration: number;   // 建议停留(分钟)
  sceneTags: SceneTag[];
  ugc: string;           // 一句 UGC 摘要
  queueBase: number;     // 0-1 基础排队压力
  source: DataSource;    // mock 点评/美团/地图来源
  confidence: number;    // 0-1 数据可信度
  freshness: Freshness;  // 数据更新频率
}

export interface ReplanProfile {
  preserveMeal: boolean;
  preserveNightView: boolean;
  maxRepairRounds: number;
  preferCheaperOnBudgetFail: boolean;
}

/** 用户画像 */
export interface Persona {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  sceneWeights: Partial<Record<SceneTag, number>>; // 缺省为 0
  categoryPriority: Partial<Record<Category, number>>; // 该画像偏好的类目加权
  pace: 'relaxed' | 'normal' | 'packed';
  latestEnd: number;        // 期望最晚结束(小时)
  budgetSensitivity: number;// 0-1,越高越在意超预算
  walkTolerance: number;    // 单段可接受步行分钟(超过建议地铁/打车)
  partyDefault: number;     // 默认同行人数
  replanProfile?: ReplanProfile;
}

/** 纯文本意图抽取结果:不带画像默认值,避免「一个人」套到情侣画像上 */
export interface IntentDraft {
  city: string;
  areaHits: string[];
  startTime: number;
  durationMin: number;
  party: number;
  budgetPerCapita: number | null;
  diningBudgetPerCapita: number | null;
  budgetSource: 'explicit_total' | 'explicit_dining' | 'soft' | null;
  prefs: SceneTag[];
  avoid: SceneTag[];
  mustCategories: Category[];
  avoidCategories: Category[];
  transport: Constraints['transport'];
  pace: Constraints['pace'] | null;
  raw: string;
  matched: string[];
}

/** 抽取出的结构化约束 */
export interface Constraints {
  city: string;
  startTime: number;        // 小时(可含 .5)
  durationMin: number;      // 计划总时长(分钟)
  party: number;            // 同行人数
  budgetPerCapita: number | null; // 人均预算 ¥(null = 未指定)
  diningBudgetPerCapita?: number | null; // 仅正餐预算,如「预算300吃午饭」
  budgetSource?: 'explicit_total' | 'explicit_dining' | 'soft' | null;
  prefs: SceneTag[];        // 正向偏好
  avoid: SceneTag[];        // 规避
  mustCategories: Category[];
  avoidCategories: Category[];
  transport: 'walk' | 'transit' | 'taxi' | 'mixed';
  pace: 'relaxed' | 'normal' | 'packed';
  raw: string;              // 原始输入
  matched: string[];        // 命中的关键词(可解释用)
}

/** 推荐打分明细(8 维)*/
export interface ScoreBreakdown {
  quality: number;
  popularity: number;
  sceneFit: number;
  prefMatch: number;
  budgetFit: number;
  proximity: number;
  companionFit: number;
  ugcBonus: number;
}

/** 打分后的 POI */
export interface ScoredPOI {
  poi: POI;
  score: number;            // 0-100 personalized_score
  breakdown: ScoreBreakdown;
  reasons: string[];        // 「为什么推荐」可读理由
}

export type LegMode = 'walk' | 'transit';

/** Mock 导航边:与生活 POI 数据分开,让评委看到数据源边界 */
export interface MapLeg {
  fromPoiId: string;
  toPoiId: string;
  distanceM: number;
  walkingMinutes: number;
  transitMinutes: number;
  chosenMode: LegMode;
  etaSource: DataSource;
  etaConfidence: number;
}

/** 路线中的一站 */
export interface RouteStop {
  scored: ScoredPOI;
  arrive: number;           // 到达(小时)
  depart: number;           // 离开(小时)
  legFromPrev: {            // 从上一站到本站
    distM: number;
    minutes: number;
    mode: LegMode;
    etaSource?: DataSource;
    etaConfidence?: number;
  } | null;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

/** 一条完整路线 */
export interface Route {
  id: string;
  stops: RouteStop[];
  totalCost: number;        // 人均合计 ¥
  totalWalkMin: number;
  totalTransitMin: number;
  endTime: number;          // 结束(小时)
  score: number;            // 综合排序分
  checks: Check[];
  coverage: Category[];
  explanation: string;      // 路线级解释
  risks: string[];          // 风险提示
  violations?: Violation[];
}

export interface PersonaSignal {
  keyword: string;
  personaId: string;
  weight: number;
  reason: string;
}

export interface PersonaInference {
  personaId: string;
  confidence: number;
  signals: PersonaSignal[];
  alternatives: { personaId: string; confidence: number }[];
}

export interface Conflict {
  hasConflict: boolean;
  manualPersonaId?: string;
  inferredPersonaId: string;
  resolvedPersonaId: string;
  resolution: 'use_inferred' | 'use_manual' | 'no_conflict';
  message: string;
}

export interface Violation {
  checkKey: string;
  severity: 'warn' | 'fail';
  poiId?: string;
  detail: string;
}

export interface RepairLog {
  round: number;
  trigger: string;
  action: string;
  before: string;
  after: string;
  resolved: boolean;
}

/** Pipeline 阶段(用于分阶段可视化) */
export type StageKey =
  | 'parse' | 'retrieve' | 'score' | 'build' | 'validate' | 'rank' | 'explain';

export type AgentStageKey =
  | 'parseIntent'
  | 'inferPersona'
  | 'detectConflict'
  | 'retrieveCandidates'
  | 'scorePOIs'
  | 'planRoute'
  | 'validateConstraints'
  | 'repairIfNeeded'
  | 'explainRoute';

export interface AgentTraceStep {
  key: AgentStageKey;
  label: string;
  input: string;
  output: string;
  ms: number;
  status: 'ok' | 'fallback' | 'skip';
}

export interface StageInfo {
  key: StageKey;
  label: string;
  desc: string;
}

export const STAGES: StageInfo[] = [
  { key: 'parse',    label: '约束抽取',  desc: 'parseConstraints' },
  { key: 'retrieve', label: '候选召回',  desc: 'retrieveCandidates' },
  { key: 'score',    label: '个性化评分', desc: 'scorePOIs' },
  { key: 'build',    label: '路线组合',  desc: 'buildRouteCandidates' },
  { key: 'validate', label: '约束校验',  desc: 'validateRoute' },
  { key: 'rank',     label: '路线排序',  desc: 'rankRoutes' },
  { key: 'explain',  label: '解释生成',  desc: 'explainRoute' },
];

/** pipeline 完整产物 */
export interface PlanResult {
  constraints: Constraints;
  candidates: ScoredPOI[];      // 召回+打分后的候选(用于候选面板)
  routes: Route[];              // 已排序;routes[0] = 推荐,其余 = 备选
  personaId: string;
  stageTimings: Record<StageKey, number>; // 每段耗时(ms)
  intent?: IntentDraft;
  personaInference?: PersonaInference;
  conflict?: Conflict;
  resolvedPersonaId?: string;
  agentTrace?: AgentTraceStep[];
  repairLog?: RepairLog[];
  slotPlan?: Category[];
  retrieveNote?: string;
}

/** refine 解析出的动作 */
export interface RefineAction {
  kind:
    | 'replaceCategory'   // 换某类目里的某一家
    | 'setBudget'         // 调整预算
    | 'relaxPace'         // 不要太赶
    | 'reduceTravel'      // 车程太久/太远,压缩移动距离
    | 'packPace'          // 再多逛点
    | 'addPreference'     // 加一个偏好(如拍照)
    | 'unknown';
  category?: Category;
  criterion?: 'higherRating' | 'cheaper' | 'closer';
  budget?: number;
  pref?: SceneTag;
  raw: string;
  note: string;            // 给用户看的解析说明
}

export type RefinePrimaryIntent =
  | 'reduceTravel'
  | 'addStop'
  | 'addFoodOrDrink'
  | 'replaceFood'
  | 'lowerBudget'
  | 'makeQuiet'
  | 'makePhotoFriendly'
  | 'changeArea'
  | 'unknown';

export interface RefineIntentSlots {
  targetStop?: string;
  category?: string;
  area?: string;
  budget?: number;
  tone?: string;
}

export interface RefineIntentJSON {
  primaryIntent: RefinePrimaryIntent;
  secondaryIntents: RefinePrimaryIntent[];
  slots: RefineIntentSlots;
  confidence: number;
  reason: string;
  source?: 'llm' | 'local' | 'fallback';
}

export interface RefineAgentSummary {
  primaryIntent: RefinePrimaryIntent;
  confidence: number;
  slots: RefineIntentSlots;
  reason: string;
  source: 'llm' | 'local' | 'fallback';
  tool: string;
  executed: boolean;
  validationStatus: 'pass' | 'warn' | 'fail';
  repairApplied: boolean;
  fallbackUsed: boolean;
  message: string;
}
