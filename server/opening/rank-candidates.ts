import type { GeneratedOpeningCandidate, InputAnalysisResult, OpeningStrategyPlan } from "@/server/opening/types";

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

  if (analysis.primaryNeeds.includes("画面") && containsConcreteImagery(content)) score += 14;
  if (analysis.primaryNeeds.includes("钩子") && containsQuestion(content)) score += 12;
  if (analysis.primaryNeeds.includes("冲突") && /但是|却|偏偏|反而|可/.test(content)) score += 12;
  if (analysis.primaryNeeds.includes("情绪") && /沉默|孤独|温柔|难过|心里|情绪|安静/.test(content)) score += 10;
  if (analysis.primaryNeeds.includes("人物") && /她|他|我|我们|女孩|男孩|人/.test(content)) score += 10;

  return score;
}

function styleAlignmentScore(strategy: OpeningStrategyPlan, content: string) {
  const text = content.replace(/\s+/g, "");
  switch (strategy.key) {
    case "scene":
      return containsConcreteImagery(text) ? 12 : 4;
    case "emotion":
      return /心|沉默|难过|克制|安静|空|热|冷/.test(text) ? 12 : 4;
    case "conflict":
      return /但是|却|偏偏|可偏偏|明明|然而/.test(text) ? 12 : 4;
    case "question":
      return containsQuestion(text) ? 12 : 4;
    case "character":
      return /她|他|我|动作|站|看|握|抬|低/.test(text) ? 12 : 4;
    case "contrast":
      return /却|但|偏偏|反而|明明/.test(text) ? 12 : 4;
    case "detail":
      return /杯|门|窗|雨|灯|鞋|桌|风|车|街/.test(text) ? 12 : 4;
    default:
      return 5;
  }
}

export function rankCandidates<T extends GeneratedOpeningCandidate>(
  candidates: T[],
  analysis: InputAnalysisResult,
  strategies: OpeningStrategyPlan[]
): T[] {
  const strategyMap = new Map(strategies.map((strategy) => [strategy.label, strategy]));

  const scored = candidates.map((candidate) => {
    const strategy = strategyMap.get(candidate.openingStrategy);
    const content = candidate.content.trim();
    let score = candidate.qualityScore;

    score += lengthScore(content, analysis);
    score += toneScore(content, analysis);
    score += strategy ? styleAlignmentScore(strategy, content) : 0;
    score += Math.min(8, containsConcreteImagery(content) ? 4 : 0);
    score += Math.min(6, containsStrongVerbs(content) ? 3 : 0);
    score -= countMatches(content, CLICHE_PATTERNS) * 8;
    score -= countMatches(content, AI_GIVEAWAYS) * 10;
    score -= /```|^\s*[-*]/m.test(content) ? 8 : 0;
    score -= content.length < 20 ? 12 : 0;

    return {
      ...candidate,
      qualityScore: clampScore(score)
    };
  });

  return scored.sort((left, right) => right.qualityScore - left.qualityScore).map((candidate, index) => ({
    ...candidate,
    rankOrder: index + 1
  }));
}
