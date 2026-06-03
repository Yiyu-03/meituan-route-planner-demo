import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  BookOpen,
  BookmarkPlus,
  CalendarDays,
  Camera,
  ChevronRight,
  Clock3,
  Coffee,
  Database,
  Footprints,
  History,
  Landmark,
  LogOut,
  MapPinned,
  Navigation,
  NotebookTabs,
  RefreshCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Ticket,
  Utensils,
  UserCircle,
  WalletCards,
  X,
} from 'lucide-react';
import { DEMO_INPUTS, type DemoInput } from '../data/demoInputs';
import { PERSONA_MAP, PERSONAS } from '../data/personas';
import { runAgentLoop } from '../engine/agent/agentLoop';
import { applyRefine, parseRefine } from '../engine/replan';
import type { Category, CheckStatus, Constraints, Persona, PlanResult, Route, RouteStop } from '../types';
import { CATEGORY_LABEL } from '../types';
import { AgentTrace } from '../components/AgentTrace';
import { ScoreBreakdownBars, fmtH } from '../components/ui';
import {
  budgetVerdict,
  formatAreas,
  formatDistance,
  formatLegMode,
  formatTags,
  lifeTips,
  openingNote,
  routeAdvantage,
  travelSummary,
} from '../lib/display';
import { buildReplanChips, type ReplanChip } from '../lib/replanChips';
import { buildAmapCityPlan } from '../lib/amapPlan';

type PersonaPick = 'auto' | string;
type UserPreferenceKey = 'quiet' | 'budget' | 'avoidQueue' | 'family';

interface UserProfile {
  userId: string;
  nickname: string;
  prefs: UserPreferenceKey[];
  budgetPref: number | null;
  updatedAt: number;
}

interface PlannerSession {
  id: string;
  title: string;
  note: string;
  color: 'gold' | 'leaf' | 'coral' | 'sky';
  input: string;
  personaPick: PersonaPick;
  plan: PlanResult;
  activeRouteIdx: number;
  changedIds: string[];
  toast: string;
  ownerId: string;
  profileNote?: string;
}

interface CityGateNotice {
  city: string;
  input: string;
}

const NOTE_COLORS: PlannerSession['color'][] = ['gold', 'leaf', 'coral', 'sky'];
const USER_STORAGE_KEY = 'meituan-route-demo-user-v1';
const HISTORY_STORAGE_KEY = 'meituan-route-demo-history-v1';
const ANON_USER_ID = 'anonymous-local-user';
const UNSUPPORTED_CITY_RULES: { city: string; re: RegExp }[] = [
  { city: '杭州/余杭', re: /杭州|余杭|西湖区|拱墅|萧山|滨江/ },
  { city: '北京', re: /北京|朝阳区|海淀区|三里屯|国贸/ },
  { city: '深圳', re: /深圳|南山|福田|宝安/ },
  { city: '广州', re: /广州|天河|越秀|珠江新城/ },
  { city: '南京', re: /南京|新街口|秦淮/ },
  { city: '苏州', re: /苏州|姑苏|工业园区/ },
  { city: '成都', re: /成都|锦江|太古里/ },
  { city: '重庆', re: /重庆|渝中|解放碑/ },
  { city: '武汉', re: /武汉|江汉|光谷/ },
  { city: '西安', re: /西安|碑林|雁塔/ },
];

const USER_PREF_OPTIONS: { key: UserPreferenceKey; label: string; planningText: string }[] = [
  { key: 'quiet', label: '安静', planningText: '偏好安静不吵' },
  { key: 'budget', label: '省钱', planningText: '希望便宜实惠性价比高' },
  { key: 'avoidQueue', label: '少排队', planningText: '别排队太久尽量少等位' },
  { key: 'family', label: '亲子友好', planningText: '亲子友好适合孩子' },
];

const defaultPrompt =
  '朋友来上海，下午在新天地附近逛逛，3点想找个安静地方接电话，晚上吃饭别排队太久，人均300内';

function hashUserId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `mock-user-${hash.toString(36)}`;
}

function historyKeyForUser(userId: string): string {
  return `${HISTORY_STORAGE_KEY}:${userId || ANON_USER_ID}`;
}

function profileUserId(profile: UserProfile | null): string {
  return profile?.userId ?? ANON_USER_ID;
}

function loadStoredUser(): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (!parsed.nickname) return null;
    const nickname = parsed.nickname;
    return {
      userId: parsed.userId ?? hashUserId(nickname),
      nickname,
      prefs: (parsed.prefs ?? []).filter((p): p is UserPreferenceKey =>
        USER_PREF_OPTIONS.some((opt) => opt.key === p),
      ),
      budgetPref: typeof parsed.budgetPref === 'number' ? parsed.budgetPref : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function loadStoredSessions(userId: string): PlannerSession[] {
  try {
    const raw = window.localStorage.getItem(historyKeyForUser(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlannerSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item?.id && item?.plan?.routes?.length)
      .map((item) => ({ ...item, ownerId: item.ownerId ?? userId }))
      .filter((item) => item.ownerId === userId)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function saveStoredSessions(userId: string, sessions: PlannerSession[]) {
  window.localStorage.setItem(historyKeyForUser(userId), JSON.stringify(sessions.slice(0, 6)));
}

function seedSessions(profile: UserProfile | null): PlannerSession[] {
  const ownerId = profileUserId(profile);
  const stored = loadStoredSessions(ownerId);
  if (stored.length) return stored;
  return [
    makeSession(defaultPrompt, 'auto', 0, '朋友·新天地下午', profile, ownerId),
    ...DEMO_INPUTS.slice(1, 4).map((demo, index) => demoSession(demo, index + 1, profile, ownerId)),
  ];
}

function userPreferenceNote(profile: UserProfile | null): string {
  if (!profile) return '';
  const labels = profile.prefs
    .map((pref) => USER_PREF_OPTIONS.find((opt) => opt.key === pref)?.label)
    .filter(Boolean);
  if (profile.budgetPref != null) labels.push(`人均约¥${profile.budgetPref}`);
  return labels.length ? labels.join('、') : '暂无长期偏好';
}

function applyUserProfileToInput(input: string, profile: UserProfile | null): string {
  if (!profile) return input;
  const bits = profile.prefs
    .map((pref) => USER_PREF_OPTIONS.find((opt) => opt.key === pref)?.planningText)
    .filter(Boolean);
  if (profile.budgetPref != null && !/(人均|预算|以内|以下|左右|块|元)/.test(input)) {
    bits.push(`人均预算${profile.budgetPref}左右`);
  }
  if (!bits.length) return input;
  return `${input}。用户长期偏好:${bits.join('、')}`;
}

function detectUnsupportedCity(input: string): CityGateNotice | null {
  const hit = UNSUPPORTED_CITY_RULES.find((rule) => rule.re.test(input));
  if (!hit) return null;
  return { city: hit.city, input };
}

function createPlan(input: string, personaPick: PersonaPick, profile: UserProfile | null = null): PlanResult {
  const manualPersona = personaPick === 'auto' ? undefined : PERSONA_MAP[personaPick];
  return runAgentLoop(applyUserProfileToInput(input, profile), manualPersona);
}

function makeSession(
  input: string,
  personaPick: PersonaPick,
  index: number,
  label?: string,
  profile: UserProfile | null = null,
  ownerId = profileUserId(profile),
): PlannerSession {
  const plan = createPlan(input, personaPick, profile);
  const route = plan.routes[0];
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    title: label ?? titleFromPlan(plan),
    note: noteFromRoute(route),
    color: NOTE_COLORS[index % NOTE_COLORS.length],
    input,
    personaPick,
    plan,
    activeRouteIdx: 0,
    changedIds: [],
    toast: budgetGuidance(route, plan.constraints.budgetPerCapita),
    ownerId,
    profileNote: userPreferenceNote(profile),
  };
}

function makeSessionFromPlan(
  input: string,
  personaPick: PersonaPick,
  index: number,
  plan: PlanResult,
  label: string | undefined,
  profile: UserProfile | null = null,
  ownerId = profileUserId(profile),
  toast?: string,
): PlannerSession {
  const route = plan.routes[0];
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    title: label ?? titleFromPlan(plan),
    note: noteFromRoute(route),
    color: NOTE_COLORS[index % NOTE_COLORS.length],
    input,
    personaPick,
    plan,
    activeRouteIdx: 0,
    changedIds: [],
    toast: [toast, budgetGuidance(route, plan.constraints.budgetPerCapita)].filter(Boolean).join(' '),
    ownerId,
    profileNote: userPreferenceNote(profile),
  };
}

function demoSession(
  demo: DemoInput,
  index: number,
  profile: UserProfile | null = null,
  ownerId = profileUserId(profile),
): PlannerSession {
  return makeSession(demo.text, demo.suggestPersona ?? 'auto', index, demo.label, profile, ownerId);
}

function titleFromPlan(plan: PlanResult): string {
  const c = plan.constraints;
  const first = formatAreas(c);
  const persona = PERSONA_MAP[plan.personaId]?.label ?? '智能路线';
  return `${first} · ${persona}`;
}

function noteFromRoute(route?: Route): string {
  if (!route) return '等待规划';
  const cover = route.coverage.map((c) => CATEGORY_LABEL[c]).slice(0, 3).join(' / ');
  return `${route.stops.length}站 · ${cover}`;
}

function sessionTitleFromInput(input: string) {
  const clean = input.replace(/[，。,.]/g, ' ').trim();
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean || '新的路线规划';
}

function understoodChips(plan: PlanResult, persona: Persona) {
  const c = plan.constraints;
  const area = [formatAreas(c)];
  const chips = [
    ...area,
    `${fmtH(c.startTime)} 出发`,
    `${c.party}人`,
    c.budgetPerCapita
      ? `${c.budgetSource === 'soft' ? '软预算' : '人均'}≤¥${c.budgetPerCapita}`
      : c.diningBudgetPerCapita
        ? `正餐≤¥${c.diningBudgetPerCapita}`
        : '预算不限',
    persona.label,
    ...formatTags(c.prefs).slice(0, 3),
  ];
  return [...new Set(chips)].slice(0, 8);
}

function budgetMeta(route: Route, budget: number | null): {
  value: string;
  tone: 'neutral' | 'green' | 'amber' | 'red';
  helper: string;
} {
  const verdict = budgetVerdict(route.totalCost, budget);
  const tone = verdict.tone === 'ok' ? 'green' : verdict.tone === 'warn' ? 'amber' : 'red';
  return { value: verdict.display, tone, helper: verdict.label };
}

function budgetGuidance(route: Route, budget: number | null): string {
  if (budget == null || route.totalCost <= budget) return '';
  const verdict = budgetVerdict(route.totalCost, budget);
  return `人均已超预算：${verdict.display}。当前方案仍需调整，可点「便宜一点」或选择相对省钱版继续压预算。`;
}

function importantChecks(route: Route) {
  const keys = ['budget', 'queue', 'open'];
  return keys
    .map((key) => route.checks.find((check) => check.key === key))
    .filter(Boolean)
    .slice(0, 3) as Route['checks'];
}

function safeRoute(session: PlannerSession): Route {
  return session.plan.routes[session.activeRouteIdx] ?? session.plan.routes[0];
}

function routeRisk(route: Route): { label: string; tone: 'green' | 'amber' | 'red' } {
  const fail = route.checks.some((c) => c.status === 'fail');
  const warn = route.checks.some((c) => c.status === 'warn');
  if (fail) return { label: '需调整', tone: 'red' };
  if (warn) return { label: '有提醒', tone: 'amber' };
  return { label: '行程宽松', tone: 'green' };
}

function riskClass(tone: 'green' | 'amber' | 'red') {
  if (tone === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-rose-200 bg-rose-50 text-rose-800';
}

function statusClass(status: CheckStatus) {
  if (status === 'pass') return 'bg-emerald-100 text-emerald-800';
  if (status === 'warn') return 'bg-amber-100 text-amber-800';
  return 'bg-rose-100 text-rose-800';
}

function checkMark(status: CheckStatus) {
  return status === 'pass' ? '通过' : status === 'warn' ? '提醒' : '冲突';
}

function categoryIcon(category: Category): LucideIcon {
  const map: Record<Category, LucideIcon> = {
    dining: Utensils,
    cafe: Coffee,
    culture: Landmark,
    entertainment: Ticket,
    shopping: BookmarkPlus,
    nightscape: Camera,
  };
  return map[category];
}

function queueText(base: number) {
  if (base >= 0.68) return { label: '排队偏高', hint: '建议提前订座或避开饭点', tone: 'amber' as const };
  if (base >= 0.45) return { label: '可能等位', hint: '到店前再确认', tone: 'amber' as const };
  return { label: '排队低', hint: '当前节奏稳定', tone: 'green' as const };
}

function routeLabel(route: Route, best: Route, index: number, budget?: number | null) {
  return routeAdvantage([best, route], index === 0 ? 0 : 1, budget).label;
}

export function MainDashboard() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => loadStoredUser());
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [historyOwnerId, setHistoryOwnerId] = useState(() => profileUserId(loadStoredUser()));
  const [sessions, setSessions] = useState<PlannerSession[]>(() => seedSessions(loadStoredUser()));
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id ?? '');
  const [draft, setDraft] = useState(defaultPrompt);
  const [personaPick, setPersonaPick] = useState<PersonaPick>('auto');
  const [judgeMode, setJudgeMode] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [cityGateNotice, setCityGateNotice] = useState<CityGateNotice | null>(null);

  useEffect(() => {
    saveStoredSessions(historyOwnerId, sessions);
  }, [sessions, historyOwnerId]);

  useEffect(() => {
    if (userProfile) window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfile));
    else window.localStorage.removeItem(USER_STORAGE_KEY);
  }, [userProfile]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const activeRoute = safeRoute(activeSession);
  const activePersona = PERSONA_MAP[activeSession.plan.personaId] ?? PERSONA_MAP.solo;
  const risk = routeRisk(activeRoute);
  const budget = budgetMeta(activeRoute, activeSession.plan.constraints.budgetPerCapita);
  const understood = understoodChips(activeSession.plan, activePersona);
  const quickActions = useMemo(
    () => buildReplanChips(activeRoute, activeSession.plan.constraints),
    [activeRoute, activeSession.plan.constraints],
  );

  useEffect(() => {
    if (!activeSession) return;
    setDraft(activeSession.input);
    setPersonaPick(activeSession.personaPick);
  }, [activeSession?.id]);

  const updateActiveSession = (updater: (session: PlannerSession) => PlannerSession) => {
    setSessions((prev) => prev.map((item) => (item.id === activeSession.id ? updater(item) : item)));
  };

  const switchToSessions = (nextSessions: PlannerSession[]) => {
    const first = nextSessions[0];
    setSessions(nextSessions);
    setActiveSessionId(first?.id ?? '');
    setDraft(first?.input ?? defaultPrompt);
    setPersonaPick(first?.personaPick ?? 'auto');
    setRefineText('');
  };

  const switchUserProfile = (profile: UserProfile | null) => {
    saveStoredSessions(historyOwnerId, sessions);
    const nextOwnerId = profileUserId(profile);
    const nextSessions = seedSessions(profile);
    setUserProfile(profile);
    setHistoryOwnerId(nextOwnerId);
    switchToSessions(nextSessions);
  };

  const submitPlan = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || isPlanning) return;
    const unsupportedCity = detectUnsupportedCity(text);
    if (unsupportedCity) {
      setCityGateNotice(null);
      setIsPlanning(true);
      try {
        const manualPersona = personaPick === 'auto' ? undefined : PERSONA_MAP[personaPick];
        const plan = await buildAmapCityPlan(applyUserProfileToInput(text, userProfile), unsupportedCity, manualPersona);
        if (!plan?.routes.length) {
          setCityGateNotice(unsupportedCity);
          return;
        }
        const next = makeSessionFromPlan(
          text,
          personaPick,
          sessions.length,
          plan,
          `${unsupportedCity.city} · 高德真实 POI`,
          userProfile,
          historyOwnerId,
          '已调用高德真实 POI 生成试验路线；价格、排队、偏好解释仍为本地规则估算。',
        );
        setSessions((prev) => [next, ...prev].slice(0, 6));
        setActiveSessionId(next.id);
        setDraft(next.input);
        setPersonaPick(next.personaPick);
      } catch {
        setCityGateNotice(unsupportedCity);
      } finally {
        setIsPlanning(false);
      }
      return;
    }
    setCityGateNotice(null);
    setIsPlanning(true);
    window.setTimeout(() => {
      const next = makeSession(text, personaPick, sessions.length, undefined, userProfile, historyOwnerId);
      setSessions((prev) => [next, ...prev].slice(0, 6));
      setActiveSessionId(next.id);
      setDraft(next.input);
      setPersonaPick(next.personaPick);
      setIsPlanning(false);
    }, 260);
  };

  const loadDemo = (demo: DemoInput) => {
    const pick = demo.suggestPersona ?? 'auto';
    const profileNote = userPreferenceNote(userProfile);
    const existing = sessions.find((item) =>
      item.input === demo.text && item.personaPick === pick && (item.profileNote ?? '') === profileNote,
    );
    setDraft(demo.text);
    setPersonaPick(pick);
    if (existing) {
      setActiveSessionId(existing.id);
      return;
    }
    const next = makeSession(demo.text, pick, sessions.length, demo.label, userProfile, historyOwnerId);
    setSessions((prev) => [next, ...prev].slice(0, 6));
    setActiveSessionId(next.id);
  };

  const pickSession = (id: string) => {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setActiveSessionId(id);
    setDraft(session.input);
    setPersonaPick(session.personaPick);
  };

  const applyRoutePick = (routeIdx: number) => {
    updateActiveSession((session) => ({
      ...session,
      activeRouteIdx: routeIdx,
      changedIds: [],
      toast: `已切到「${routeLabel(
        session.plan.routes[routeIdx],
        session.plan.routes[0],
        routeIdx,
        session.plan.constraints.budgetPerCapita,
      )}」，右侧旅行页同步更新。${budgetGuidance(session.plan.routes[routeIdx], session.plan.constraints.budgetPerCapita)}`,
    }));
  };

  const applyRefineText = (text: string) => {
    const value = text.trim();
    if (!value) return;
    const action = parseRefine(value);
    const result = applyRefine(
      action,
      activeRoute,
      activeSession.plan.constraints,
      activePersona,
      activeSession.plan.candidates,
    );

    updateActiveSession((session) => {
      const routes = [...session.plan.routes];
      routes[session.activeRouteIdx] = result.route;
      return {
        ...session,
        plan: { ...session.plan, constraints: result.constraints, routes },
        changedIds: result.changed,
        toast: result.message,
      };
    });
    setRefineText('');
  };

  return (
    <div className="travel-desk min-h-screen px-3 py-4 text-[#201B16] sm:px-5 lg:px-8">
      <header className="mx-auto mb-4 flex max-w-[1480px] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#2B2118]/10 bg-[#F7C948] shadow-[0_4px_0_rgba(32,27,22,.18)]">
            <BookOpen size={22} strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.28em] text-[#7A6A58]">美团本地路线规划</p>
            <h1 className="text-[24px] font-semibold leading-tight sm:text-[30px]">AI 本地路线旅行书</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UserStatus profile={userProfile} onOpen={() => setUserModalOpen(true)} onLogout={() => switchUserProfile(null)} />
          <button
            type="button"
            onClick={() => setJudgeMode((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-[13px] font-semibold ${judgeMode ? 'border-[#201B16] bg-[#201B16] text-white' : 'border-[#D9CBB6] bg-[#FFF9ED] text-[#625545]'}`}
          >
            {judgeMode ? '收起规划依据' : '查看规划依据'}
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1480px] gap-3 lg:grid-cols-[minmax(0,1fr)_118px]">
        <section className="travel-book-spread grid min-h-[760px] overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="book-page book-page-left border-b border-[#DED0BB] p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <form onSubmit={submitPlan} className="space-y-4">
              <div>
                <p className="mb-2 text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">写下这次出门</p>
                <textarea
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (cityGateNotice) setCityGateNotice(null);
                  }}
                  rows={4}
                  className="min-h-[118px] w-full resize-none rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-3 text-[15px] leading-7 text-[#201B16] outline-none transition placeholder:text-[#9A8B79] focus:border-[#201B16] focus:ring-2 focus:ring-[#F7C948]/40"
                  placeholder="朋友来上海，下午在新天地附近逛逛，3点想找个安静地方接电话，晚上吃饭别排队太久，人均300内"
                />
                {cityGateNotice && (
                  <UnsupportedCityNotice notice={cityGateNotice} compact />
                )}
              </div>

              <div className="rounded-lg border border-[#E2D3BD] bg-[#FFF9ED] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">已理解</span>
                  <span className="rounded-full bg-[#E9F4DF] px-2 py-1 text-[11px] font-medium text-[#456B35]">
                    当前查看：{sessionTitleFromInput(activeSession.input)}
                  </span>
                </div>
                {activeSession.profileNote && activeSession.profileNote !== '暂无长期偏好' && (
                  <p className="mb-2 rounded-lg border border-[#E2D3BD] bg-[#FFFDF8] px-2 py-1.5 text-[11px] leading-5 text-[#6F604E]">
                    已带入用户偏好：{activeSession.profileNote}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {understood.map((chip) => <PaperChip key={chip}>{chip}</PaperChip>)}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[12px] font-semibold text-[#776755]">需要手动换场景？</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <PersonaButton active={personaPick === 'auto'} onClick={() => setPersonaPick('auto')} label="自动识别" sub="让文本决定" />
                    {PERSONAS.map((persona) => (
                      <PersonaButton
                        key={persona.id}
                        active={personaPick === persona.id}
                        onClick={() => setPersonaPick(persona.id)}
                        label={`${persona.emoji} ${persona.label}`}
                        sub={persona.blurb}
                      />
                    ))}
                  </div>
                </details>
              </div>

              <button
                type="submit"
                disabled={isPlanning}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#201B16] px-4 text-[15px] font-semibold text-white shadow-[0_5px_0_rgba(32,27,22,.18)] transition active:translate-y-[1px] disabled:opacity-60"
              >
                <Send size={17} strokeWidth={1.7} />
                {isPlanning ? '正在生成旅行页' : '生成新的旅行页'}
              </button>
            </form>

            <details className="mt-5 rounded-lg border border-[#D9CBB6] bg-[#F7F0E2] p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-[#665744]">查看示例需求</summary>
              <div className="mt-3 space-y-2">
                {DEMO_INPUTS.slice(0, 6).map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    onClick={() => loadDemo(demo)}
                    className="group flex w-full items-start justify-between gap-3 rounded-lg border border-[#E2D3BD] bg-[#FFFDF8] px-3 py-2 text-left transition hover:border-[#201B16]"
                  >
                    <span>
                      <span className="block text-[13px] font-semibold text-[#201B16]">{demo.label}</span>
                      <span className="line-clamp-1 text-[12px] text-[#857562]">{demo.text}</span>
                    </span>
                    <ChevronRight size={15} className="mt-1 text-[#A89272] transition group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            </details>
          </aside>

          <section className="book-page book-page-right p-4 sm:p-6">
            {cityGateNotice && (
              <div className="mb-4">
                <UnsupportedCityNotice notice={cityGateNotice} />
              </div>
            )}
            <RouteCover route={activeRoute} persona={activePersona} risk={risk} budget={budget} />

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4">
                {activeSession.toast && (
                  <div className="rounded-lg border border-[#F0D28A] bg-[#FFF6D8] px-3 py-2 text-[13px] leading-6 text-[#6D5221]">
                    {activeSession.toast}
                  </div>
                )}

                <RouteJournalTimeline
                  route={activeRoute}
                  constraints={activeSession.plan.constraints}
                  changedIds={activeSession.changedIds}
                />

                <RouteAlternatives
                  routes={activeSession.plan.routes}
                  budget={activeSession.plan.constraints.budgetPerCapita}
                  activeRouteIdx={activeSession.activeRouteIdx}
                  onPick={applyRoutePick}
                />
              </div>

              <aside className="space-y-4">
                <ReplanCard
                  actions={quickActions}
                  value={refineText}
                  onChange={setRefineText}
                  onPick={applyRefineText}
                />
                <TripTipsCard route={activeRoute} />
              </aside>
            </div>
          </section>
        </section>

        <SessionNotes
          sessions={sessions}
          activeSessionId={activeSession.id}
          onPick={pickSession}
        />
      </main>

      {judgeMode && (
        <JudgeAppendix session={activeSession} route={activeRoute} />
      )}

      {userModalOpen && (
        <UserProfileModal
          profile={userProfile}
          onClose={() => setUserModalOpen(false)}
          onSave={(profile) => {
            switchUserProfile(profile);
            setUserModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PersonaButton({
  active, onClick, label, sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[72px] rounded-lg border px-2.5 py-2 text-left transition ${
        active
          ? 'border-[#201B16] bg-[#F7C948]/35 text-[#201B16]'
          : 'border-[#E2D3BD] bg-[#FFFDF8] text-[#625545] hover:border-[#201B16]'
      }`}
    >
      <span className="block text-[12px] font-semibold">{label}</span>
      <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-[#857562]">{sub}</span>
    </button>
  );
}

function PaperChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[#D8C6A8] bg-[#FFFDF8] px-2 py-1 text-[11px] font-medium text-[#665744]">
      {children}
    </span>
  );
}

function UserStatus({
  profile, onOpen, onLogout,
}: {
  profile: UserProfile | null;
  onOpen: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-2 py-1.5">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-2 text-left text-[12px] font-semibold text-[#4F4233]"
      >
        <UserCircle size={17} strokeWidth={1.6} />
          <span>
          <span className="block leading-4">{profile ? profile.nickname : '未登录'}</span>
          <span className="block max-w-[180px] truncate text-[10px] font-medium text-[#8A765F]">
            {profile ? userPreferenceNote(profile) : '本地访客 · 独立规划记录'}
          </span>
        </span>
      </button>
      {profile && (
        <button
          type="button"
          onClick={onLogout}
          className="rounded-md p-1 text-[#8A765F] transition hover:bg-[#EFE3D0] hover:text-[#201B16]"
          aria-label="退出本地登录"
          title="退出本地登录"
        >
          <LogOut size={14} strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
}

function UserProfileModal({
  profile, onClose, onSave,
}: {
  profile: UserProfile | null;
  onClose: () => void;
  onSave: (profile: UserProfile) => void;
}) {
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [budgetPref, setBudgetPref] = useState(profile?.budgetPref != null ? String(profile.budgetPref) : '');
  const [prefs, setPrefs] = useState<UserPreferenceKey[]>(profile?.prefs ?? ['quiet', 'avoidQueue']);

  const togglePref = (key: UserPreferenceKey) => {
    setPrefs((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = nickname.trim() || '演示用户';
    const budget = budgetPref.trim() ? Number(budgetPref.trim()) : null;
    onSave({
      userId: profile?.nickname.trim() === trimmed ? profile.userId : hashUserId(trimmed),
      nickname: trimmed,
      prefs,
      budgetPref: Number.isFinite(budget) && budget != null ? budget : null,
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#201B16]/35 px-4 py-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-5 shadow-[0_18px_46px_rgba(32,27,22,.22)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">本地用户</p>
            <h2 className="text-[22px] font-semibold text-[#201B16]">登录 / 注册</h2>
            <p className="mt-1 text-[12px] leading-5 text-[#776755]">仅保存到 localStorage，用于演示 session 和个性化偏好。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[#8A765F] transition hover:bg-[#F7F0E2]">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold text-[#4F4233]">昵称</span>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            className="w-full rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-3 py-2 text-[14px] outline-none focus:border-[#201B16]"
            placeholder="比如：小王"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold text-[#4F4233]">预算偏好</span>
          <input
            value={budgetPref}
            onChange={(event) => setBudgetPref(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            className="w-full rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-3 py-2 text-[14px] outline-none focus:border-[#201B16]"
            placeholder="可选，例如 200"
            inputMode="numeric"
          />
        </label>

        <div className="mb-4">
          <span className="mb-2 block text-[12px] font-semibold text-[#4F4233]">出行偏好</span>
          <div className="grid grid-cols-2 gap-2">
            {USER_PREF_OPTIONS.map((option) => {
              const active = prefs.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => togglePref(option.key)}
                  className={`rounded-lg border px-3 py-2 text-left text-[13px] font-semibold transition ${
                    active
                      ? 'border-[#201B16] bg-[#F7C948]/35 text-[#201B16]'
                      : 'border-[#E2D3BD] bg-[#FFF9ED] text-[#6F604E] hover:border-[#201B16]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <button type="submit" className="h-11 w-full rounded-lg bg-[#201B16] text-[14px] font-semibold text-white">
          保存到本地并使用
        </button>
      </form>
    </div>
  );
}

function UnsupportedCityNotice({ notice, compact = false }: { notice: CityGateNotice; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-900 ${compact ? 'mt-2 px-3 py-2 text-[12px]' : 'px-4 py-3 text-[13px]'}`}>
      <div className="flex items-start gap-2">
        <Database size={compact ? 14 : 16} strokeWidth={1.7} className="mt-0.5 shrink-0" />
        <div className="leading-6">
          <p className="font-semibold">暂未生成 {notice.city} 路线</p>
          <p>
            当前本地 mock POI 主要覆盖上海。这个城市需要配置真实地图/POI API 后生成，
            系统不会把上海 POI 包装成 {notice.city} 路线。
          </p>
          {!compact && (
            <p className="mt-1 text-[12px] text-amber-800/80">
              已保留你的输入：“{notice.input}”。右侧仍显示上一条已生成路线。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RouteCover({
  route, persona, risk, budget,
}: {
  route: Route;
  persona: Persona;
  risk: { label: string; tone: 'green' | 'amber' | 'red' };
  budget: { value: string; tone: 'neutral' | 'green' | 'amber' | 'red'; helper: string };
}) {
  const movement = travelSummary(route);
  const budgetOver = budget.tone === 'amber' || budget.tone === 'red';
  return (
    <section className="relative overflow-hidden rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4 shadow-[0_10px_24px_rgba(68,50,31,.08)]">
      <div className={`travel-route-stamp ${budgetOver ? 'travel-route-stamp-warning' : ''}`}>
        {budgetOver ? '超预算·建议调整' : '拿来就走'}
      </div>
      <div className="max-w-3xl">
        <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-[0.2em] text-[#8A765F]">
          <NotebookTabs size={15} strokeWidth={1.6} />
          今日路线
        </p>
        <h2 className="text-[28px] font-semibold leading-tight text-[#201B16] sm:text-[38px]">
          {persona.label}的一页城市路线
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[#6F604E]">{route.explanation}</p>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <CoverMetric icon={Clock3} label="总时长" value={`${fmtH(route.stops[0].arrive)}-${fmtH(route.endTime)}`} />
        <CoverMetric icon={WalletCards} label="预算" value={budget.value} helper={budget.helper} tone={budget.tone} />
        <CoverMetric icon={Footprints} label={movement.label} value={movement.value} />
        <CoverMetric icon={ShieldCheck} label="提醒" value={risk.label} tone={risk.tone} />
      </div>
    </section>
  );
}

function CoverMetric({
  icon: Icon, label, value, tone = 'neutral', helper,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
  helper?: string;
}) {
  const toneCls = tone === 'neutral' ? 'border-[#E4D5BE] bg-[#FBF4E7]' : riskClass(tone);
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <Icon size={17} strokeWidth={1.6} className="mb-2" />
      <p className="text-[11px] text-[#8A765F]">{label}</p>
      <p className="tnum text-[17px] font-semibold text-[#201B16]">{value}</p>
      {helper && <p className="mt-1 text-[11px] font-medium">{helper}</p>}
    </div>
  );
}

function RouteJournalTimeline({
  route, constraints, changedIds,
}: {
  route: Route;
  constraints: Constraints;
  changedIds: string[];
}) {
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">行程安排</p>
          <h3 className="text-[22px] font-semibold text-[#201B16]">路线时间轴</h3>
        </div>
        <span className="rounded-full border border-[#D8C6A8] bg-[#F7F0E2] px-3 py-1 text-[12px] font-medium text-[#665744]">
          {route.stops.length} 站 · 已检查营业/排队/步行
        </span>
      </div>

      <div className="relative space-y-3">
        <div className="absolute left-[23px] top-3 h-[calc(100%-28px)] w-px bg-[#D8C6A8]" />
        {route.stops.map((stop, index) => (
          <StopCard
            key={`${stop.scored.poi.id}-${index}`}
            stop={stop}
            constraints={constraints}
            index={index}
            isChanged={changedIds.includes(stop.scored.poi.id)}
          />
        ))}
      </div>
    </section>
  );
}

function StopCard({
  stop, constraints, index, isChanged,
}: {
  stop: RouteStop;
  constraints: Constraints;
  index: number;
  isChanged: boolean;
}) {
  const poi = stop.scored.poi;
  const Icon = categoryIcon(poi.category);
  const queue = queueText(poi.queueBase);
  const tips = lifeTips(poi, stop.arrive);
  const caution = tips.caution ?? (poi.queueBase >= 0.45 ? queue.hint : undefined);
  return (
    <article className="relative pl-12">
      <div className="absolute left-0 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-[#D8C6A8] bg-[#FFFDF8] text-[#201B16] shadow-sm">
        <span className="tnum text-[13px] font-semibold">{index + 1}</span>
      </div>

      {index > 0 && stop.legFromPrev && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#E6D8C3] bg-[#FBF4E7] px-3 py-2 text-[12px] text-[#6F604E]">
          <Navigation size={14} strokeWidth={1.6} />
          上一站 → 本站：{formatLegMode(stop.legFromPrev.mode)} {stop.legFromPrev.minutes} 分钟 · {formatDistance(stop.legFromPrev.distM)}
        </div>
      )}

      <div className={`rounded-lg border p-3 shadow-[0_6px_14px_rgba(68,50,31,.06)] ${isChanged ? 'border-[#6EA65D] bg-[#F1F8EA]' : 'border-[#E4D5BE] bg-[#FFFDF8]'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#201B16] px-2 py-1 text-[11px] font-semibold text-white">
                {fmtH(stop.arrive)} - {fmtH(stop.depart)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#D8C6A8] bg-[#F7F0E2] px-2 py-1 text-[11px] text-[#665744]">
                <Icon size={13} strokeWidth={1.6} />
                {CATEGORY_LABEL[poi.category]}
              </span>
              {poi.source === 'amap' && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
                  高德真实 POI
                </span>
              )}
              {isChanged && (
                <span className="rounded-full bg-[#DDEFD2] px-2 py-1 text-[11px] font-semibold text-[#426D32]">
                  局部更新
                </span>
              )}
            </div>
            <h4 className="text-[20px] font-semibold leading-tight text-[#201B16]">{poi.name}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#776755]">
              <span className="inline-flex items-center gap-1"><Star size={13} fill="#F7C948" strokeWidth={1.5} />{poi.rating} · {poi.reviews} 条</span>
              <span>{poi.source === 'amap' ? `人均估算 ¥${poi.perCapita}` : `¥${poi.perCapita}/人`}</span>
              <span>{openingNote(poi, stop.arrive)}</span>
              <span className={queue.tone === 'green' ? 'text-emerald-700' : 'text-amber-700'}>{queue.label}</span>
            </div>
          </div>
          <div className="rounded-lg bg-[#F7C948] px-3 py-2 text-center text-[#201B16]">
            <SlidersHorizontal className="mx-auto" size={17} strokeWidth={1.8} />
            <span className="mt-1 block text-[10px] font-semibold">推荐依据</span>
          </div>
        </div>

        <p className="mt-3 rounded-lg border border-[#E9D7B4] bg-[#FFF8E8] px-3 py-2 text-[13px] leading-6 text-[#5F4D36]">
          {stop.scored.reasons[0] ?? '符合本次路线约束'}。{compareSentence(stop, constraints)}
        </p>

        <div className="mt-2 rounded-lg bg-[#F7F0E2] px-3 py-2 text-[12px] leading-5 text-[#665744]">
          <b>亮点：</b>{tips.highlight}
          {caution && (
            <>
              <span className="mx-1 text-[#B09C80]">｜</span>
              <b>提醒：</b>{caution}
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <MockAction icon={CalendarDays} label="订座" />
          <MockAction icon={MapPinned} label="导航" />
          <MockAction icon={BookmarkPlus} label="收藏" />
          <details className="group">
            <summary className="cursor-pointer rounded-lg border border-[#D8C6A8] bg-[#FFFDF8] px-3 py-2 text-[12px] font-semibold text-[#5F4D36] marker:content-['']">
              查看推荐依据
            </summary>
            <div className="mt-2 rounded-lg border border-[#E4D5BE] bg-white/80 p-3">
              <ScoreBreakdownBars b={stop.scored.breakdown} />
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

function compareSentence(stop: RouteStop, constraints: Constraints) {
  const tags = stop.scored.poi.sceneTags;
  const raw = constraints.raw;
  const askedPhone = /接电话|打电话|办公|开会/.test(raw);
  const askedQuiet = constraints.prefs.includes('quiet') || /安静|清净|不吵|别太吵|不要太吵/.test(raw);
  const cultureLeisure = /园林|博物馆|博物院|展馆|展览|citywalk|逛|西湖|文化|历史|轻松|慢慢/.test(raw)
    || constraints.prefs.includes('cultural');
  if (cultureLeisure && stop.scored.poi.category === 'culture') return '适合作为主景点慢慢逛，停留节奏更稳';
  if (cultureLeisure && tags.includes('quiet')) return '更适合中途放慢脚步，避免路线太赶';
  if (tags.includes('quiet') && askedPhone) return '比同区域热闹店更安静，适合短暂停下来接电话';
  if (tags.includes('quiet') && askedQuiet) return '比同区域热闹店更安静，适合慢慢聊';
  if (tags.includes('photo')) return '比附近普通打卡点更容易出片';
  if (tags.includes('family')) return '比夜生活点更适合带娃，收尾更稳';
  if (tags.includes('budget')) return '比附近同类更实惠';
  return '更贴合这次出行节奏';
}

function MockAction({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8C6A8] bg-[#FFFDF8] px-3 py-2 text-[12px] font-semibold text-[#5F4D36] transition hover:border-[#201B16]"
    >
      <Icon size={14} strokeWidth={1.6} />
      {label}
    </button>
  );
}

function RouteAlternatives({
  routes, budget, activeRouteIdx, onPick,
}: {
  routes: Route[];
  budget: number | null;
  activeRouteIdx: number;
  onPick: (idx: number) => void;
}) {
  const best = routes[0];
  if (routes.length < 2) return null;
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#8A765F]">备选便签</p>
      <div className="grid gap-2 md:grid-cols-2">
        {routes.slice(0, 4).map((route, idx) => {
          const active = idx === activeRouteIdx;
          const advantage = routeAdvantage(routes, idx, budget);
          const budgetInfo = budgetVerdict(route.totalCost, budget);
          const budgetCls = budgetInfo.tone === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : budgetInfo.tone === 'warn'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-rose-200 bg-rose-50 text-rose-800';
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => onPick(idx)}
              className={`rounded-lg border p-3 text-left transition ${
                active ? 'border-[#201B16] bg-[#F7C948]/30' : 'border-[#E4D5BE] bg-[#FFF9ED] hover:border-[#201B16]'
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold text-[#201B16]">{advantage.label}</span>
                <span className={`tnum rounded-full border px-2 py-0.5 text-[11px] font-semibold ${budgetCls}`}>
                  {budgetInfo.display}
                </span>
              </div>
              <p className="mb-1 text-[12px] text-[#8A765F]">{advantage.note}</p>
              <p className="line-clamp-2 text-[12px] leading-5 text-[#6F604E]">
                {route.stops.map((s) => s.scored.poi.name).join(' → ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#776755]">
                <span>{travelSummary(route).value}</span>
                <span>{fmtH(route.endTime)} 结束</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ReplanCard({
  actions, value, onChange, onPick,
}: {
  actions: ReplanChip[];
  value: string;
  onChange: (value: string) => void;
  onPick: (value: string) => void;
}) {
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <div className="mb-3 flex items-center gap-2">
        <RefreshCcw size={17} strokeWidth={1.6} />
        <h3 className="font-semibold text-[#201B16]">临时改一下</h3>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.instruction}
            type="button"
            onClick={() => onPick(action.instruction)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition hover:border-[#201B16] ${
              action.emphasize
                ? 'border-amber-300 bg-amber-100 text-amber-900'
                : 'border-[#D8C6A8] bg-[#F7F0E2] text-[#5F4D36]'
            }`}
          >
            {action.text}
          </button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onPick(value);
        }}
        className="flex gap-2"
      >
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] px-3 py-2 text-[13px] outline-none focus:border-[#201B16]"
          placeholder="比如：第二站换个安静咖啡"
        />
        <button type="submit" className="rounded-lg bg-[#201B16] px-3 text-white">
          <Send size={16} strokeWidth={1.7} />
        </button>
      </form>
    </section>
  );
}

function TripTipsCard({ route }: { route: Route }) {
  const checks = importantChecks(route);
  const visibleChecks = checks.filter((check) => check.status !== 'pass');
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={17} strokeWidth={1.6} />
        <h3 className="font-semibold text-[#201B16]">出行提醒</h3>
      </div>
      <div className="space-y-2">
        {visibleChecks.length === 0 && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] leading-5 text-emerald-800">
            营业、预算和排队已检查，目前没有明显提醒。
          </p>
        )}
        {visibleChecks.map((check) => (
          <div key={check.key} className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[#201B16]">{check.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(check.status)}`}>
                {checkMark(check.status)}
              </span>
            </div>
            <p className="text-[11px] leading-4 text-[#776755]">{check.detail}</p>
          </div>
        ))}
        <details>
          <summary className="cursor-pointer text-[12px] font-semibold text-[#776755]">查看完整校验</summary>
          <div className="mt-2 space-y-2">
            {checks.map((check) => (
              <div key={check.key} className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#201B16]">{check.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(check.status)}`}>
                    {checkMark(check.status)}
                  </span>
                </div>
                <p className="text-[11px] leading-4 text-[#776755]">{check.detail}</p>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function SessionNotes({
  sessions, activeSessionId, onPick,
}: {
  sessions: PlannerSession[];
  activeSessionId: string;
  onPick: (id: string) => void;
}) {
  return (
    <aside className="session-notes flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-20 lg:block lg:space-y-3 lg:overflow-visible lg:pb-0">
      <div className="hidden rounded-lg border border-[#D9CBB6] bg-[#FFF9ED] px-3 py-2 text-[12px] font-semibold text-[#665744] lg:flex lg:items-center lg:gap-2">
        <History size={15} strokeWidth={1.6} />
        规划记录
      </div>
      {sessions.map((session, index) => {
        const active = session.id === activeSessionId;
        const route = safeRoute(session);
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onPick(session.id)}
            className={`session-note session-note-${session.color} ${active ? 'session-note-active' : ''}`}
            style={{ '--tilt': `${index % 2 === 0 ? -1.5 : 1.2}deg` } as CSSProperties}
          >
            <span className="block text-[11px] font-semibold tracking-[0.16em] opacity-70">规划记录</span>
            <span className="mt-1 block text-[13px] font-semibold leading-5">{session.title}</span>
            <span className="mt-1 block text-[11px] leading-4 opacity-75">
              ¥{route.totalCost} · {route.stops.length}站
            </span>
            {session.profileNote && session.profileNote !== '暂无长期偏好' && (
              <span className="mt-1 line-clamp-2 block text-[10px] leading-4 opacity-70">
                偏好：{session.profileNote}
              </span>
            )}
          </button>
        );
      })}
    </aside>
  );
}

function JudgeAppendix({ session, route }: { session: PlannerSession; route: Route }) {
  const plan = session.plan;
  return (
    <section className="mx-auto mt-4 max-w-[1480px] rounded-lg border border-[#201B16]/20 bg-[#FFFDF8] p-4 shadow-[0_12px_24px_rgba(68,50,31,.08)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">规划依据</p>
          <h2 className="text-[22px] font-semibold text-[#201B16]">动态链路与校验记录</h2>
        </div>
        <span className="rounded-full border border-[#D8C6A8] bg-[#F7F0E2] px-3 py-1 text-[12px] font-medium text-[#665744]">
          parseConstraints → retrieveCandidates → scorePOIs → buildRouteCandidates → validateRoute → repair/replan → explainRoute
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AgentTrace trace={plan.agentTrace ?? []} />
        <div className="space-y-4">
          <DataSourceCard plan={plan} />

          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-3">
            <div className="mb-2 flex items-center gap-2">
              <SlidersHorizontal size={16} strokeWidth={1.6} />
              <h3 className="font-semibold">候选 POI 打分 Top 8</h3>
            </div>
            <div className="space-y-2">
              {plan.candidates.slice(0, 8).map((candidate) => (
                <div key={candidate.poi.id} className="rounded-lg border border-[#E4D5BE] bg-[#FFFDF8] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold">{candidate.poi.name}</span>
                    <span className="tnum rounded bg-[#F7C948] px-2 py-0.5 text-[11px] font-bold">{Math.round(candidate.score)}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[11px] text-[#776755]">{candidate.reasons.join(' / ')}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-3">
            <div className="mb-2 flex items-center gap-2">
              <BadgeCheck size={16} strokeWidth={1.6} />
              <h3 className="font-semibold">校验与修复</h3>
            </div>
            <div className="space-y-2">
              {route.checks.map((check) => (
                <div key={check.key} className="text-[12px] leading-5 text-[#665744]">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(check.status)}`}>
                    {checkMark(check.status)}
                  </span>
                  {check.label}：{check.detail}
                </div>
              ))}
              {(plan.repairLog ?? []).map((log) => (
                <div key={log.round} className="rounded-lg bg-[#F1F8EA] p-2 text-[12px] leading-5 text-[#426D32]">
                  第 {log.round} 轮：{log.action}，{log.before} → {log.after}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DataSourceCard({ plan }: { plan: PlanResult }) {
  const [amapStatus, setAmapStatus] = useState<'checking' | 'configured' | 'not_configured' | 'unreachable'>('checking');
  const usesAmapPoi = plan.candidates.some((candidate) => candidate.poi.source === 'amap');

  useEffect(() => {
    let alive = true;
    fetch('/api/amap/poi-search?keyword=status&city=上海&limit=1')
      .then(async (res) => {
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) return null;
        return res.json();
      })
      .then((data) => {
        if (!alive) return;
        if (!data) setAmapStatus('unreachable');
        else if (data.configured) setAmapStatus('configured');
        else if (data.status === 'not_configured') setAmapStatus('not_configured');
        else setAmapStatus('unreachable');
      })
      .catch(() => {
        if (alive) setAmapStatus('unreachable');
      });
    return () => {
      alive = false;
    };
  }, []);

  const apiLabel = amapStatus === 'configured'
    ? '已配置'
    : amapStatus === 'checking'
      ? '检测中'
      : '未配置';
  const apiTone = amapStatus === 'configured'
    ? 'bg-emerald-100 text-emerald-800'
    : 'bg-amber-100 text-amber-800';

  return (
    <div className="rounded-lg border border-[#E4D5BE] bg-[#FFF9ED] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Database size={16} strokeWidth={1.6} />
        <h3 className="font-semibold">数据来源与当前能力</h3>
      </div>
      <div className="space-y-2 text-[12px] leading-5 text-[#665744]">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFFDF8] p-2">
            <span className="text-[11px] text-[#8A765F]">高德 API</span>
            <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${apiTone}`}>
              {apiLabel}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4D5BE] bg-[#FFFDF8] p-2">
            <span className="text-[11px] text-[#8A765F]">当前路线数据源</span>
            <p className="mt-1 font-semibold text-[#201B16]">
              {usesAmapPoi ? '高德真实 POI · 本地规则估算' : 'mock POI · API adapter available'}
            </p>
          </div>
        </div>
        {usesAmapPoi ? (
          <p>
            当前这条非上海试验路线使用高德真实 POI 名称、地址与坐标；人均、排队、UGC、偏好解释仍由本地规则估算。
          </p>
        ) : (
          <p>
            当前路线主流程默认使用本地 mock POI、mock UGC、人均、排队、评分、营业与地图距离字段，
            保证 Demo 稳定可演示,再由规则化 Agent Loop 完成规划。
          </p>
        )}
        <p>
          链路为 parseConstraints → retrieveCandidates → scorePOIs → buildRouteCandidates → validateRoute → repair/replan → explainRoute。
        </p>
        <p>
          已提供 Vercel 高德 API adapter 雏形:/api/amap/poi-search 与 /api/amap/route-walking。
          在 Vercel 配置 AMAP_KEY 后可调用真实高德 POI 搜索与步行路径估算。
          当前没有接入美团/点评真实交易、排队、UGC 或团购数据。
        </p>
      </div>
    </div>
  );
}
