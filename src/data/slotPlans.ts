import type { Category, Constraints, Persona } from '../types';

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
  const base = TEMPLATES[`${persona.id}.${bucket}`] ?? TEMPLATES[`${persona.id}.afternoon`] ?? ['culture', 'cafe', 'dining'];
  const slots = [...base];

  for (const cat of c.mustCategories) {
    if (!slots.includes(cat)) slots.unshift(cat);
  }

  if (c.avoidCategories.length) {
    for (let i = 0; i < slots.length; i++) {
      if (c.avoidCategories.includes(slots[i])) slots[i] = 'culture';
    }
  }

  const durH = c.durationMin / 60;
  let n = durH <= 2.5 ? 3 : durH <= 4 ? 4 : 5;
  if (c.pace === 'relaxed') n = Math.max(3, n - 1);
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

