import type { Persona } from '../types';

// 4 个演示画像。sceneWeights / categoryPriority / pace / latestEnd 各不相同,
// 这是「相同输入→不同路线」的根因。
export const PERSONAS: Persona[] = [
  {
    id: 'couple',
    label: '情侣约会',
    emoji: '💕',
    blurb: '氛围 > 效率,愿意为浪漫和颜值买单',
    sceneWeights: {
      romantic: 1.0, photo: 0.8, quiet: 0.5, upscale: 0.5,
      trendy: 0.4, nightlife: 0.4, cultural: 0.3, nature: 0.3,
      lively: -0.2, budget: -0.3,
    },
    categoryPriority: { nightscape: 0.6, dining: 0.4, culture: 0.3, cafe: 0.3 },
    pace: 'relaxed',
    latestEnd: 24,
    budgetSensitivity: 0.3,
    walkTolerance: 18,
    partyDefault: 2,
    replanProfile: { preserveMeal: true, preserveNightView: true, maxRepairRounds: 2, preferCheaperOnBudgetFail: false },
  },
  {
    id: 'family',
    label: '带娃家庭',
    emoji: '👨‍👩‍👧',
    blurb: '安全省心 + 亲子友好,节奏要松、要早收尾',
    sceneWeights: {
      family: 1.0, quiet: 0.6, nature: 0.5, cultural: 0.4,
      local: 0.2, budget: 0.3,
      nightlife: -1.0, upscale: -0.2,
    },
    categoryPriority: { culture: 0.5, entertainment: 0.5, dining: 0.3 },
    pace: 'relaxed',
    latestEnd: 19.5,
    budgetSensitivity: 0.6,
    walkTolerance: 12,
    partyDefault: 3,
    replanProfile: { preserveMeal: true, preserveNightView: false, maxRepairRounds: 3, preferCheaperOnBudgetFail: true },
  },
  {
    id: 'friends',
    label: '朋友聚会',
    emoji: '🎉',
    blurb: '热闹好玩 + 性价比,能玩到晚一点',
    sceneWeights: {
      lively: 1.0, trendy: 0.6, foodie: 0.5, nightlife: 0.6,
      budget: 0.4, local: 0.3,
      quiet: -0.4, upscale: -0.2,
    },
    categoryPriority: { entertainment: 0.6, dining: 0.5, nightscape: 0.4 },
    pace: 'normal',
    latestEnd: 24.5,
    budgetSensitivity: 0.5,
    walkTolerance: 16,
    partyDefault: 4,
    replanProfile: { preserveMeal: true, preserveNightView: true, maxRepairRounds: 2, preferCheaperOnBudgetFail: true },
  },
  {
    id: 'solo',
    label: '独自闲逛',
    emoji: '🚶',
    blurb: '随性 citywalk,偏文艺、安静、出片',
    sceneWeights: {
      cultural: 1.0, quiet: 0.7, photo: 0.6, local: 0.6,
      nature: 0.5, trendy: 0.3,
      lively: -0.3, upscale: -0.1,
    },
    categoryPriority: { culture: 0.6, cafe: 0.5, shopping: 0.3 },
    pace: 'normal',
    latestEnd: 22,
    budgetSensitivity: 0.7,
    walkTolerance: 22,
    partyDefault: 1,
    replanProfile: { preserveMeal: false, preserveNightView: false, maxRepairRounds: 3, preferCheaperOnBudgetFail: true },
  },
];

export const PERSONA_MAP: Record<string, Persona> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p]),
);
