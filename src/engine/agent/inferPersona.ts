import type { IntentDraft, PersonaInference, PersonaSignal } from '../../types';
import { PERSONAS } from '../../data/personas';

const RULES: { personaId: string; re: RegExp; weight: number; reason: string }[] = [
  { personaId: 'solo', re: /一个人|独自|自己|solo|citywalk|散步/, weight: 0.42, reason: '文本表达独自/闲逛场景' },
  { personaId: 'couple', re: /对象|约会|情侣|女朋友|男朋友|纪念日|浪漫/, weight: 0.55, reason: '文本表达情侣/约会场景' },
  { personaId: 'family', re: /带娃|孩子|亲子|小孩|宝宝|一家|全家|遛娃/, weight: 0.58, reason: '文本表达亲子/家庭场景' },
  { personaId: 'friends', re: /朋友|同学|聚会|几个人|团建|桌游|热闹/, weight: 0.5, reason: '文本表达朋友聚会场景' },
];

export function inferPersona(intent: IntentDraft): PersonaInference {
  const scores: Record<string, number> = Object.fromEntries(PERSONAS.map((p) => [p.id, 0.12]));
  const signals: PersonaSignal[] = [];

  for (const rule of RULES) {
    const m = intent.raw.match(rule.re);
    if (m) {
      scores[rule.personaId] += rule.weight;
      signals.push({
        keyword: m[0],
        personaId: rule.personaId,
        weight: rule.weight,
        reason: rule.reason,
      });
    }
  }

  if (intent.party === 1) {
    scores.solo += 0.36;
    signals.push({ keyword: '1人', personaId: 'solo', weight: 0.36, reason: '同行人数为 1' });
  } else if (intent.party >= 3) {
    scores.friends += 0.18;
    scores.family += intent.raw.match(/娃|孩|亲子|家庭|一家/) ? 0.28 : 0;
    signals.push({ keyword: `${intent.party}人`, personaId: 'friends', weight: 0.18, reason: '多人出行更接近朋友/家庭场景' });
  } else if (intent.party === 2 && /对象|情侣|约会|女朋友|男朋友/.test(intent.raw)) {
    scores.couple += 0.26;
    signals.push({ keyword: '2人约会', personaId: 'couple', weight: 0.26, reason: '两人且包含约会语义' });
  }

  if (intent.prefs.includes('family')) scores.family += 0.24;
  if (intent.prefs.includes('romantic')) scores.couple += 0.2;
  if (intent.prefs.includes('lively')) scores.friends += 0.16;
  if (intent.prefs.includes('quiet') || intent.prefs.includes('cultural')) scores.solo += 0.12;

  const alternatives = Object.entries(scores)
    .map(([personaId, score]) => ({ personaId, confidence: Math.min(0.98, +score.toFixed(2)) }))
    .sort((a, b) => b.confidence - a.confidence);

  const winner = alternatives[0];
  return {
    personaId: winner.personaId,
    confidence: winner.confidence,
    signals,
    alternatives,
  };
}

