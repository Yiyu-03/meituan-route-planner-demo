import { useMemo, useState } from 'react';
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
  Footprints,
  Landmark,
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
  WalletCards,
} from 'lucide-react';
import { DEMO_INPUTS, type DemoInput } from '../data/demoInputs';
import { PERSONA_MAP, PERSONAS } from '../data/personas';
import { runAgentLoop } from '../engine/agent/agentLoop';
import { applyRefine, parseRefine } from '../engine/replan';
import type { Category, CheckStatus, Persona, PlanResult, Route, RouteStop } from '../types';
import { CATEGORY_LABEL } from '../types';
import { AgentTrace } from '../components/AgentTrace';
import { ScoreBreakdownBars, fmtH } from '../components/ui';
import { budgetVerdict, formatAreas, formatTags, lifeTips, openingNote, routeAdvantage } from '../lib/display';
import { buildReplanChips, type ReplanChip } from '../lib/replanChips';

type PersonaPick = 'auto' | string;

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
}

const NOTE_COLORS: PlannerSession['color'][] = ['gold', 'leaf', 'coral', 'sky'];

const defaultPrompt =
  '朋友来上海，下午在新天地附近逛逛，3点想找个安静地方接电话，晚上吃饭别排队太久，人均300内';

function createPlan(input: string, personaPick: PersonaPick): PlanResult {
  const manualPersona = personaPick === 'auto' ? undefined : PERSONA_MAP[personaPick];
  return runAgentLoop(input, manualPersona);
}

function makeSession(input: string, personaPick: PersonaPick, index: number, label?: string): PlannerSession {
  const plan = createPlan(input, personaPick);
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
    toast: '已生成一页新的旅行路线，所有站点都经过预算、营业、距离和排队校验。',
  };
}

function demoSession(demo: DemoInput, index: number): PlannerSession {
  return makeSession(demo.text, demo.suggestPersona ?? 'auto', index, demo.label);
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
    c.budgetPerCapita ? `人均≤¥${c.budgetPerCapita}` : '预算不限',
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
  if (warn) return { label: '轻风险', tone: 'amber' };
  return { label: '低风险', tone: 'green' };
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

function routeLabel(route: Route, best: Route, index: number) {
  return routeAdvantage([best, route], index === 0 ? 0 : 1).label;
}

export function MainDashboard() {
  const [sessions, setSessions] = useState<PlannerSession[]>(() =>
    [
      makeSession(defaultPrompt, 'auto', 0, '朋友·新天地下午'),
      ...DEMO_INPUTS.slice(1, 4).map((demo, index) => demoSession(demo, index + 1)),
    ],
  );
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id ?? '');
  const [draft, setDraft] = useState(defaultPrompt);
  const [personaPick, setPersonaPick] = useState<PersonaPick>('auto');
  const [judgeMode, setJudgeMode] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [refineText, setRefineText] = useState('');

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

  const updateActiveSession = (updater: (session: PlannerSession) => PlannerSession) => {
    setSessions((prev) => prev.map((item) => (item.id === activeSession.id ? updater(item) : item)));
  };

  const submitPlan = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || isPlanning) return;
    setIsPlanning(true);
    window.setTimeout(() => {
      const next = makeSession(text, personaPick, sessions.length);
      setSessions((prev) => [next, ...prev].slice(0, 6));
      setActiveSessionId(next.id);
      setDraft(next.input);
      setPersonaPick(next.personaPick);
      setIsPlanning(false);
    }, 260);
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
      toast: `已切到「${routeLabel(session.plan.routes[routeIdx], session.plan.routes[0], routeIdx)}」，右侧旅行页同步更新。`,
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
        <button
          type="button"
          onClick={() => setJudgeMode((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-[13px] font-semibold ${judgeMode ? 'border-[#201B16] bg-[#201B16] text-white' : 'border-[#D9CBB6] bg-[#FFF9ED] text-[#625545]'}`}
        >
          {judgeMode ? '收起规划依据' : '查看规划依据'}
        </button>
      </header>

      <main className="mx-auto grid max-w-[1480px] gap-3 lg:grid-cols-[minmax(0,1fr)_118px]">
        <section className="travel-book-spread grid min-h-[760px] overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="book-page book-page-left border-b border-[#DED0BB] p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <form onSubmit={submitPlan} className="space-y-4">
              <div>
                <p className="mb-2 text-[12px] font-semibold tracking-[0.18em] text-[#8A765F]">写下这次出门</p>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={4}
                  className="min-h-[118px] w-full resize-none rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-3 text-[15px] leading-7 text-[#201B16] outline-none transition placeholder:text-[#9A8B79] focus:border-[#201B16] focus:ring-2 focus:ring-[#F7C948]/40"
                  placeholder="朋友来上海，下午在新天地附近逛逛，3点想找个安静地方接电话，晚上吃饭别排队太久，人均300内"
                />
              </div>

              <div className="rounded-lg border border-[#E2D3BD] bg-[#FFF9ED] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">已理解</span>
                  <span className="rounded-full bg-[#E9F4DF] px-2 py-1 text-[11px] font-medium text-[#456B35]">
                    当前查看：{sessionTitleFromInput(activeSession.input)}
                  </span>
                </div>
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
              <summary className="cursor-pointer text-[13px] font-semibold text-[#665744]">展开试讲样例</summary>
              <div className="mt-3 space-y-2">
                {DEMO_INPUTS.slice(0, 6).map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    onClick={() => {
                      setDraft(demo.text);
                      setPersonaPick('auto');
                    }}
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
            <RouteCover route={activeRoute} persona={activePersona} risk={risk} budget={budget} />

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4">
                {activeSession.toast && (
                  <div className="rounded-lg border border-[#F0D28A] bg-[#FFF6D8] px-3 py-2 text-[13px] leading-6 text-[#6D5221]">
                    {activeSession.toast}
                  </div>
                )}

                <RouteJournalTimeline route={activeRoute} changedIds={activeSession.changedIds} />

                <RouteAlternatives
                  routes={activeSession.plan.routes}
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

function RouteCover({
  route, persona, risk, budget,
}: {
  route: Route;
  persona: Persona;
  risk: { label: string; tone: 'green' | 'amber' | 'red' };
  budget: { value: string; tone: 'neutral' | 'green' | 'amber' | 'red'; helper: string };
}) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4 shadow-[0_10px_24px_rgba(68,50,31,.08)]">
      <div className="travel-route-stamp">拿来就走</div>
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
        <CoverMetric icon={Footprints} label="步行" value={`${route.totalWalkMin} min`} />
        <CoverMetric icon={ShieldCheck} label="风险" value={risk.label} tone={risk.tone} />
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

function RouteJournalTimeline({ route, changedIds }: { route: Route; changedIds: string[] }) {
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
            index={index}
            isChanged={changedIds.includes(stop.scored.poi.id)}
          />
        ))}
      </div>
    </section>
  );
}

function StopCard({
  stop, index, isChanged,
}: {
  stop: RouteStop;
  index: number;
  isChanged: boolean;
}) {
  const poi = stop.scored.poi;
  const Icon = categoryIcon(poi.category);
  const queue = queueText(poi.queueBase);
  const tips = lifeTips(poi, stop.arrive);
  return (
    <article className="relative pl-12">
      <div className="absolute left-0 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-[#D8C6A8] bg-[#FFFDF8] text-[#201B16] shadow-sm">
        <span className="tnum text-[13px] font-semibold">{index + 1}</span>
      </div>

      {index > 0 && stop.legFromPrev && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#E6D8C3] bg-[#FBF4E7] px-3 py-2 text-[12px] text-[#6F604E]">
          <Navigation size={14} strokeWidth={1.6} />
          从上一站{stop.legFromPrev.mode === 'walk' ? '步行' : '地铁/打车'} {stop.legFromPrev.minutes} 分钟 · {stop.legFromPrev.distM}m
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
              {isChanged && (
                <span className="rounded-full bg-[#DDEFD2] px-2 py-1 text-[11px] font-semibold text-[#426D32]">
                  局部更新
                </span>
              )}
            </div>
            <h4 className="text-[20px] font-semibold leading-tight text-[#201B16]">{poi.name}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#776755]">
              <span className="inline-flex items-center gap-1"><Star size={13} fill="#F7C948" strokeWidth={1.5} />{poi.rating} · {poi.reviews} 条</span>
              <span>¥{poi.perCapita}/人</span>
              <span>{openingNote(poi, stop.arrive)}</span>
              <span className={queue.tone === 'green' ? 'text-emerald-700' : 'text-amber-700'}>{queue.label}</span>
            </div>
          </div>
          <div className="tnum rounded-lg bg-[#F7C948] px-3 py-2 text-center text-[18px] font-bold text-[#201B16]">
            {Math.round(stop.scored.score)}
            <span className="block text-[10px] font-medium">匹配</span>
          </div>
        </div>

        <p className="mt-3 rounded-lg border border-[#E9D7B4] bg-[#FFF8E8] px-3 py-2 text-[13px] leading-6 text-[#5F4D36]">
          {stop.scored.reasons[0] ?? '符合本次路线约束'}。{compareSentence(stop)}
        </p>

        <div className="mt-2 rounded-lg bg-[#F7F0E2] px-3 py-2 text-[12px] leading-5 text-[#665744]">
          <b>亮点：</b>{tips.highlight}
          {(tips.caution ?? queue.hint) && (
            <>
              <span className="mx-1 text-[#B09C80]">｜</span>
              <b>提醒：</b>{tips.caution ?? queue.hint}
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

function compareSentence(stop: RouteStop) {
  const tags = stop.scored.poi.sceneTags;
  if (tags.includes('quiet')) return '比同区域热闹店更安静，适合聊天或接电话';
  if (tags.includes('photo')) return '比普通打卡点更容易出片，停留成本也低';
  if (tags.includes('family')) return '比夜生活点更适合带娃，收尾更稳';
  if (tags.includes('budget')) return '比同类高价选择更省预算';
  return '比只按评分排序更贴合本次出行节奏';
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
  routes, activeRouteIdx, onPick,
}: {
  routes: Route[];
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
          const advantage = routeAdvantage(routes, idx);
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
                <span className="tnum text-[12px] text-[#776755]">综合 {route.score.toFixed(1)}</span>
              </div>
              <p className="mb-1 text-[12px] text-[#8A765F]">{advantage.note}</p>
              <p className="line-clamp-2 text-[12px] leading-5 text-[#6F604E]">
                {route.stops.map((s) => s.scored.poi.name).join(' → ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#776755]">
                <span>¥{route.totalCost}/人</span>
                <span>步行 {route.totalWalkMin}min</span>
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
  return (
    <section className="rounded-lg border border-[#D9CBB6] bg-[#FFFDF8] p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={17} strokeWidth={1.6} />
        <h3 className="font-semibold text-[#201B16]">出行提醒</h3>
      </div>
      <div className="space-y-2">
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
          parse → retrieve → score → build → validate → repair → explain
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AgentTrace trace={plan.agentTrace ?? []} />
        <div className="space-y-4">
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
