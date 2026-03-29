import {
  computeOpeningFinalScore,
  createNeutralEvaluation
} from "@/server/opening/llm-quality-evaluator";
import type { FeedbackPreferenceWeights } from "@/server/opening/feedback-preference";
import { computePreferenceAdjustmentScore } from "@/server/opening/preference-learning";
import type {
  GeneratedOpeningCandidate,
  InputAnalysisResult,
  OpeningQualityEvaluation,
  PreferenceProfileSnapshot,
  OpeningStrategyPlan
} from "@/server/opening/types";
import { buildOpeningOutputSignature } from "@/server/opening/output-signatures";

const CLICHE_PATTERNS = [
  "在这个",
  "随着",
  "总的来说",
  "首先",
  "其次",
  "最后",
  "让我们",
  "本文",
  "大家都知道",
  "不难发现",
  "时代",
  "一种",
  "仿佛",
  "似乎"
];

const AI_GIVEAWAYS = [
  "我们可以",
  "可以说",
  "综上所述",
  "与此同时",
  "也许有人会问",
  "值得一提的是"
];

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function countMatches(content: string, patterns: string[]) {
  return patterns.reduce((total, pattern) => total + (content.includes(pattern) ? 1 : 0), 0);
}

function containsQuestion(content: string) {
  return /[？?]/.test(content);
}

function containsConcreteImagery(content: string) {
  return /[海雨风灯车门窗手眼夜街船影]/.test(content);
}

function containsStrongVerbs(content: string) {
  return /[压握撞望听停走抬沉落]/.test(content);
}

function normalizeShapeText(content: string) {
  return content.replace(/\s+/g, "").replace(/[“”"'.。！？!?，,；;、]/g, "");
}

function getSentenceStructureKey(content: string) {
  const text = normalizeShapeText(content);

  if (!text) return "empty";
  if (/[？?]/.test(content) || /^(为什么|如果|要是|是不是|难道|怎么|会不会|你有没有|你会不会)/.test(text)) {
    return "question";
  }
  if (/^(表面上|看起来|明明|越是|其实|虽然|可偏偏|偏偏|反而|却|外面看起来)/.test(text)) {
    return "contrast";
  }
  if (/^(镜头|灯光|门口|桌上|窗外|房间|现场|清晨|凌晨|夜里|那一秒|此刻|房间里|桌边|外头)/.test(text)) {
    return "scene";
  }
  if (/^(胸口|心里|心头|呼吸|一想到|提到|想到|说不清|有些压迫|那种|我知道|我总觉得)/.test(text)) {
    return "emotion";
  }
  if (/^(真正|很多时候|其实|有些|一旦|面对|时间|拖延|大多数|最难|最像|最不像)/.test(text)) {
    return "statement";
  }

  const lead = text.slice(0, 8);
  return `lead:${lead}`;
}

function getSentenceFormulaKey(content: string) {
  const text = normalizeShapeText(content);

  if (!text) return "empty";
  if (/^镜头[^，。！？]{0,8}落到/.test(text) || /^一开始就把/.test(text) || /^先露出来的不是/.test(text)) {
    return "scene:frame";
  }
  if (/^(桌上|门口|窗外|房间里|台灯|桌边|角落里|光线|灯光|空气里|影子|手里)/.test(text)) {
    return "scene:detail";
  }
  if (/^(提到|想到|一想到|胸口|心里|呼吸|说不清|有些压迫|那种|我知道|我总觉得)/.test(text)) {
    return "emotion:inner";
  }
  if (/^(为什么|如果|要是|是不是|难道|怎么|会不会|你有没有|你会不会)/.test(text)) {
    return "question:direct";
  }
  if (/^(真正|很多时候|其实|有些|一旦|面对|时间|拖延|大多数|最难|最像|最不像)/.test(text)) {
    return "statement:lead";
  }
  if (/^(表面上|看起来|明明|越是|其实|虽然|可偏偏|偏偏|反而|却|外面看起来)/.test(text)) {
    return "contrast:lead";
  }

  return `formula:${text.slice(0, 6)}`;
}

export function analyzeSentenceShape(content: string) {
  const text = normalizeShapeText(content);
  return {
    structureKey: getSentenceStructureKey(content),
    formulaKey: getSentenceFormulaKey(content),
    leadSignature: text.slice(0, 12)
  };
}

function lengthScore(content: string, analysis: InputAnalysisResult) {
  const length = content.replace(/\s+/g, "").length;
  const target =
    analysis.lengthPreference === "short"
      ? [40, 110]
      : analysis.lengthPreference === "long"
        ? [80, 180]
        : [60, 140];
  if (length >= target[0] && length <= target[1]) return 18;
  if (length >= target[0] - 15 && length <= target[1] + 20) return 12;
  return 4;
}

function toneScore(content: string, analysis: InputAnalysisResult) {
  let score = 0;

  if (analysis.contentType === "novel" && containsConcreteImagery(content)) score += 14;
  if (analysis.contentType === "article" && containsQuestion(content)) score += 12;
  if (/但是|却|偏偏|反而|可/.test(content)) score += 8;
  if (/沉默|孤独|温柔|难过|心里|情绪|安静/.test(content)) score += 8;
  if (/她|他|我|我们|女孩|男孩|人/.test(content)) score += 6;

  return score;
}

function styleAlignmentScore(strategy: OpeningStrategyPlan, content: string) {
  const text = content.replace(/\s+/g, "");
  switch (strategy.strategyType) {
    case "scene":
      return containsConcreteImagery(text) ? 12 : 4;
    case "emotion":
      return /心|沉默|难过|克制|安静|空|热|冷/.test(text) ? 12 : 4;
    case "question":
      return containsQuestion(text) ? 12 : 4;
    case "contrast":
      return /却|但|偏偏|反而|明明/.test(text) ? 12 : 4;
    case "statement":
      return /就是|其实|真正|从来|未必|并不是|最难|关键/.test(text) ? 12 : 4;
    default:
      return 5;
  }
}

function strategyCoverageScore(strategyType: string, counts: Map<string, number>) {
  const count = counts.get(strategyType) ?? 0;
  if (count <= 1) {
    return 6;
  }

  return -Math.min(18, (count - 1) * 8);
}

function sentenceDiversityScore(
  structureKey: string,
  formulaKey: string,
  leadSignature: string,
  structureCounts: Map<string, number>,
  formulaCounts: Map<string, number>,
  leadCounts: Map<string, number>
) {
  const structureCount = structureCounts.get(structureKey) ?? 0;
  const formulaCount = formulaCounts.get(formulaKey) ?? 0;
  const leadCount = leadCounts.get(leadSignature) ?? 0;
  let score = 0;

  if (structureCount <= 1) {
    score += 10;
  } else {
    score -= Math.min(24, (structureCount - 1) * 10);
  }

  if (formulaCount <= 1) {
    score += 8;
  } else {
    score -= Math.min(30, (formulaCount - 1) * 12);
  }

  if (leadCount <= 1) {
    score += 6;
  } else {
    score -= Math.min(12, (leadCount - 1) * 6);
  }

  return score;
}

function applyFeedbackScore(candidate: GeneratedOpeningCandidate, feedbackWeights?: FeedbackPreferenceWeights | null) {
  const K = 3;
  return (feedbackWeights?.[candidate.strategyType] ?? 0) * K;
}

function diversifyBySentenceShape<
  T extends GeneratedOpeningCandidate & { structureKey: string; formulaKey: string; leadSignature: string }
>(candidates: T[]) {
  const remaining = [...candidates];
  const selected: T[] = [];
  const usedStructureKeys = new Set<string>();
  const usedFormulaKeys = new Set<string>();
  const usedLeadSignatures = new Set<string>();

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      let adjustedScore = candidate.qualityScore;

      if (usedStructureKeys.has(candidate.structureKey)) {
        adjustedScore -= selected.length < 3 ? 22 : 14;
      }
      if (usedFormulaKeys.has(candidate.formulaKey)) {
        adjustedScore -= selected.length < 3 ? 26 : 18;
      }
      if (usedLeadSignatures.has(candidate.leadSignature)) {
        adjustedScore -= 8;
      }
      if (!usedStructureKeys.has(candidate.structureKey)) {
        adjustedScore += selected.length < 3 ? 8 : 4;
      }

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    usedStructureKeys.add(picked.structureKey);
    usedFormulaKeys.add(picked.formulaKey);
    usedLeadSignatures.add(picked.leadSignature);
  }

  return selected;
}

export function rankCandidates<T extends GeneratedOpeningCandidate>(
  candidates: T[],
  _analysis: InputAnalysisResult,
  _strategies: OpeningStrategyPlan[],
  preferenceProfile?: PreferenceProfileSnapshot | null,
  feedbackWeights?: FeedbackPreferenceWeights | null
): T[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    rankOrder: index + 1
  }));
}
