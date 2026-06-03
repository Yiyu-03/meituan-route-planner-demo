import type { Category, Constraints, Persona } from '../types';
import {
  hasCultureLeisureIntent,
  isQuietIntent,
  wantsAdultNightlife,
  wantsNightView,
} from '../engine/semanticGuards';

const TEMPLATES: Record<string, Category[]> = {
  'couple.afternoon': ['culture', 'cafe', 'dining', 'nightscape'],
  'couple.night': ['dining', 'entertainment', 'nightscape'],
  'family.afternoon': ['culture', 'entertainment', 'dining'],
  'family.day': ['culture', 'entertainment', 'dining', 'shopping'],
  'friends.afternoon': ['cafe', 'entertainment', 'dining', 'nightscape'],
  'friends.night': ['dining', 'entertainment', 'nightscape'],
  'solo.afternoon': ['culture', 'cafe', 'shopping', 'culture'],
  'solo.night': ['culture', 'cafe', 'nightscape'],
};

function timeBucket(c: Constraints): 'day' | 'afternoon' | 'night' {
  if (c.startTime >= 17.5) return 'night';
  if (c.startTime >= 12) return 'afternoon';
  return 'day';
}

export function slotTemplateFor(c: Constraints, persona: Persona): Category[] {
  const bucket = timeBucket(c);
  const cultureLeisure = hasCultureLeisureIntent(c);
  const explicitCultureRoute = /园林|博物馆|博物院|美术馆|展|展馆|citywalk|逛|西湖|文化|历史|轻松|慢慢/.test(c.raw);
  const hasMeal = c.mustCategories.includes('dining') || /吃饭|午饭|午餐|晚饭|晚餐|正餐|美食/.test(c.raw);
  if (cultureLeisure && explicitCultureRoute && !wantsNightView(c) && !wantsAdultNightlife(c)) {
    const culturalSlots: Category[] = hasMeal
      ? ['culture', 'dining', 'culture', 'cafe']
      : ['culture', 'cafe', 'shopping', 'culture'];
    for (const cat of c.mustCategories) {
      if (!culturalSlots.includes(cat) && cat !== 'entertainment') culturalSlots.unshift(cat);
    }
    return culturalSlots;
  }

  const base = TEMPLATES[`${persona.id}.${bucket}`] ?? TEMPLATES[`${persona.id}.afternoon`] ?? ['culture', 'cafe', 'dining'];
  const slots = [...base];

  for (const cat of c.mustCategories) {
    if (!slots.includes(cat)) slots.unshift(cat);
  }

  const canSoftenEntertainment = slots.includes('entertainment')
    && !c.mustCategories.includes('entertainment')
    && (c.prefs.includes('quiet') || (c.budgetPerCapita != null && c.budgetPerCapita <= 320));
  if (canSoftenEntertainment) {
    const idx = slots.indexOf('entertainment');
    slots[idx] = c.startTime >= 17.5 || slots.includes('culture') ? 'cafe' : 'culture';
  }

  const quietWithoutNightAsk = isQuietIntent(c) && !wantsAdultNightlife(c) && !wantsNightView(c);
  if (quietWithoutNightAsk && !c.mustCategories.includes('nightscape')) {
    const idx = slots.indexOf('nightscape');
    if (idx >= 0) slots[idx] = 'shopping';
  }

  if (c.avoidCategories.length) {
    for (let i = 0; i < slots.length; i++) {
      if (c.avoidCategories.includes(slots[i])) slots[i] = 'culture';
    }
  }

  const durH = c.durationMin / 60;
  let n = durH <= 2.5 ? 3 : durH <= 4 ? 4 : 5;
  if (c.pace === 'relaxed') n = Math.max(durH <= 3 ? 2 : 3, n - 1);
  if (c.pace === 'packed') n = Math.min(5, n + 1);

  const fillers: Category[] = persona.id === 'solo'
    ? ['culture', 'cafe', 'shopping', 'nightscape']
    : persona.id === 'family'
      ? ['culture', 'entertainment', 'dining', 'shopping']
      : persona.id === 'friends'
        ? ['entertainment', 'dining', 'nightscape', 'cafe']
        : ['culture', 'cafe', 'dining', 'nightscape'];

  while (slots.length < n) {
    const next = fillers.find((cat) => !slots.includes(cat)) ?? fillers[slots.length % fillers.length];
    slots.push(next);
  }

  return slots.slice(0, n);
}
