import type { Conflict, PersonaInference } from '../../types';
import { PERSONA_MAP } from '../../data/personas';

export function detectConflict(inference: PersonaInference, manualPersonaId?: string): Conflict {
  const inferred = inference.personaId;
  const manual = manualPersonaId && PERSONA_MAP[manualPersonaId] ? manualPersonaId : undefined;

  if (!manual || manual === inferred) {
    return {
      hasConflict: false,
      manualPersonaId: manual,
      inferredPersonaId: inferred,
      resolvedPersonaId: inferred,
      resolution: 'no_conflict',
      message: `文本识别为「${PERSONA_MAP[inferred].label}」,置信度 ${Math.round(inference.confidence * 100)}%。`,
    };
  }

  const useInferred = inference.confidence >= 0.65;
  const resolved = useInferred ? inferred : manual;
  return {
    hasConflict: true,
    manualPersonaId: manual,
    inferredPersonaId: inferred,
    resolvedPersonaId: resolved,
    resolution: useInferred ? 'use_inferred' : 'use_manual',
    message: useInferred
      ? `检测到画像冲突:左侧选择「${PERSONA_MAP[manual].label}」,但文本强信号指向「${PERSONA_MAP[inferred].label}」。本次已按文本优先。`
      : `检测到画像冲突:文本像「${PERSONA_MAP[inferred].label}」,但置信度不足,本次沿用手动选择「${PERSONA_MAP[manual].label}」。`,
  };
}

