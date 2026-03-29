import {
  getPreferenceProfile,
  listCandidatesByGenerationRequest,
  recordPreferenceLearningEvent
} from "@/server/db/generation-repo";
import { logInfo, logWarn, summarizeError } from "@/server/logger";
import type {
  OpeningCandidateView,
  OpeningQualityDimensions,
  OpeningQualityEvaluation,
  PreferenceLearningResult,
  PreferenceProfileSnapshot,
  PreferenceProfileWeights
} from "@/server/opening/types";

export const PREFERENCE_DIMENSIONS: Array<keyof OpeningQualityDimensions> = [
  "hookStrength",
  "clarity",
  "novelty",
  "emotionalResonance",
  "visualImagery",
  "thematicFit"
];

const PREFERENCE_DIMENSION_SCALE: Record<keyof OpeningQualityDimensions, number> = {
  hookStrength: 4.6,
  clarity: 3,
  novelty: 5,
  emotionalResonance: 3.2,
  visualImagery: 3.4,
  thematicFit: 4.4
} as const;

const MIN_WEIGHT = -0.3;
const MAX_WEIGHT = 0.3;
const WEIGHT_DECAY = 0.98;
const ALPHA = 0.2;
const MAX_ADJUSTMENT_SCORE = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampWeight(weight: number) {
  return clamp(weight, MIN_WEIGHT, MAX_WEIGHT);
}

function createZeroWeights(): PreferenceProfileWeights {
  return {
    hookStrength: 0,
    clarity: 0,
    novelty: 0,
    emotionalResonance: 0,
    visualImagery: 0,
    thematicFit: 0
  };
}

function weightToArray(weights: PreferenceProfileWeights) {
  return PREFERENCE_DIMENSIONS.map((dimension) => weights[dimension]);
}

function arrayToWeights(values: number[]): PreferenceProfileWeights {
  return {
    hookStrength: clampWeight(values[0] ?? 0),
    clarity: clampWeight(values[1] ?? 0),
    novelty: clampWeight(values[2] ?? 0),
    emotionalResonance: clampWeight(values[3] ?? 0),
    visualImagery: clampWeight(values[4] ?? 0),
    thematicFit: clampWeight(values[5] ?? 0)
  };
}

function normalizeEvaluation(evaluation: OpeningQualityEvaluation | null | undefined) {
  return evaluation && evaluation.source !== "fallback" ? evaluation : null;
}

export function derivePreferenceProfileKey(guestId?: string | null) {
  const normalized = guestId?.trim();
  return normalized ? `guest:${normalized}` : null;
}

export async function loadPreferenceProfileForGuest(guestId?: string | null) {
  const profileKey = derivePreferenceProfileKey(guestId);
  if (!profileKey) {
    return null;
  }

  try {
    return await getPreferenceProfile(profileKey);
  } catch {
    return null;
  }
}

export function computePreferenceAdjustmentScore(
  evaluation: OpeningQualityEvaluation | null | undefined,
  profile: PreferenceProfileSnapshot | null | undefined
) {
  const normalizedEvaluation = normalizeEvaluation(evaluation);
  if (!normalizedEvaluation || !profile) {
    return 0;
  }

  let rawScore = 0;
  for (const dimension of PREFERENCE_DIMENSIONS) {
    const centered = normalizedEvaluation.dimensions[dimension] - 3;
    const weight = profile.weights[dimension];
    const scale = PREFERENCE_DIMENSION_SCALE[dimension];
    rawScore += centered * weight * scale;
  }

  return Math.round(clamp(rawScore, -MAX_ADJUSTMENT_SCORE, MAX_ADJUSTMENT_SCORE));
}

function averagePairwiseDelta(
  selected: OpeningQualityEvaluation,
  competitors: OpeningQualityEvaluation[]
): PreferenceProfileWeights {
  const totals = createZeroWeights();
  if (competitors.length === 0) {
    return totals;
  }

  for (const competitor of competitors) {
    for (const dimension of PREFERENCE_DIMENSIONS) {
      totals[dimension] += selected.dimensions[dimension] - competitor.dimensions[dimension];
    }
  }

  const average: PreferenceProfileWeights = createZeroWeights();
  for (const dimension of PREFERENCE_DIMENSIONS) {
    const diff = totals[dimension] / competitors.length;
    average[dimension] = clamp(diff / 4, -1, 1);
  }

  return average;
}

function buildLearningExplanation(
  selected: OpeningCandidateView,
  delta: PreferenceProfileWeights,
  afterWeights: PreferenceProfileWeights
) {
  const positiveDimensions = PREFERENCE_DIMENSIONS.filter((dimension) => delta[dimension] > 0.08)
    .sort((left, right) => delta[right] - delta[left])
    .slice(0, 3);

  const strengthened = positiveDimensions.length > 0
    ? positiveDimensions
        .map((dimension) => dimensionLabel(dimension))
        .join("、")
    : "整体均衡度";

  const weightHighlights = PREFERENCE_DIMENSIONS.filter((dimension) => Math.abs(afterWeights[dimension]) > 0.08)
    .sort((left, right) => Math.abs(afterWeights[right]) - Math.abs(afterWeights[left]))
    .slice(0, 2)
    .map((dimension) => dimensionLabel(dimension));

  const suffix = weightHighlights.length > 0 ? `，当前偏好开始偏向${weightHighlights.join("、")}` : "";
  return `本次学习主要增强了${strengthened}${suffix}。`;
}

function dimensionLabel(dimension: keyof OpeningQualityDimensions) {
  const labels: Record<keyof OpeningQualityDimensions, string> = {
    hookStrength: "开头钩子",
    clarity: "表达清晰",
    novelty: "新鲜感",
    emotionalResonance: "情绪共鸣",
    visualImagery: "画面感",
    thematicFit: "主题贴合"
  };

  return labels[dimension];
}

function buildComparisonSnapshot(input: {
  profileKey: string;
  generationRequestId: string;
  selectedCandidate: OpeningCandidateView;
  competitors: OpeningCandidateView[];
  delta: PreferenceProfileWeights;
  beforeWeights: PreferenceProfileWeights;
  afterWeights: PreferenceProfileWeights;
}) {
  return {
    profileKey: input.profileKey,
    generationRequestId: input.generationRequestId,
    selectedCandidate: {
      id: input.selectedCandidate.id,
      strategyType: input.selectedCandidate.strategyType,
      openingStrategy: input.selectedCandidate.openingStrategy,
      qualityScore: input.selectedCandidate.qualityScore,
      evaluation: input.selectedCandidate.evaluation
    },
    competitors: input.competitors.map((candidate) => ({
      id: candidate.id,
      strategyType: candidate.strategyType,
      openingStrategy: candidate.openingStrategy,
      qualityScore: candidate.qualityScore,
      evaluation: candidate.evaluation
    })),
    delta: input.delta,
    beforeWeights: input.beforeWeights,
    afterWeights: input.afterWeights
  };
}

export async function learnPreferenceFromCopySelection(input: {
  guestId?: string | null;
  generationRequestId?: string | null;
  selectedCandidateId?: string | null;
}): Promise<PreferenceLearningResult> {
  const profileKey = derivePreferenceProfileKey(input.guestId);
  if (!profileKey) {
    logInfo("preference-learning", "skip learning: missing profile key", {
      guestId: input.guestId ?? null
    });
    return {
      learned: false,
      profileKey: null,
      reason: "缺少可学习的 profileKey。"
    };
  }

  if (!input.generationRequestId || !input.selectedCandidateId) {
    logInfo("preference-learning", "skip learning: missing identifiers", {
      profileKey,
      generationRequestId: input.generationRequestId ?? null,
      selectedCandidateId: input.selectedCandidateId ?? null
    });
    return {
      learned: false,
      profileKey,
      reason: "缺少 generationRequestId 或 selectedCandidateId。"
    };
  }

  try {
    logInfo("preference-learning", "learning started", {
      profileKey,
      generationRequestId: input.generationRequestId,
      selectedCandidateId: input.selectedCandidateId
    });
    const candidates = await listCandidatesByGenerationRequest(input.generationRequestId);
    if (candidates.length < 2) {
      logInfo("preference-learning", "skip learning: not enough candidates", {
        profileKey,
        generationRequestId: input.generationRequestId,
        candidateCount: candidates.length
      });
      return {
        learned: false,
        profileKey,
        reason: "同批候选数量不足，跳过学习。"
      };
    }

    const selectedCandidate = candidates.find((candidate) => candidate.id === input.selectedCandidateId);
    if (!selectedCandidate || !normalizeEvaluation(selectedCandidate.evaluation)) {
      logInfo("preference-learning", "skip learning: missing selected evaluation", {
        profileKey,
        generationRequestId: input.generationRequestId,
        selectedCandidateId: input.selectedCandidateId
      });
      return {
        learned: false,
        profileKey,
        reason: "未找到可学习的选中候选。"
      };
    }

    const validCandidates = candidates.filter((candidate) => normalizeEvaluation(candidate.evaluation));
    if (validCandidates.length !== candidates.length) {
      logInfo("preference-learning", "skip learning: fallback evaluation present", {
        profileKey,
        generationRequestId: input.generationRequestId,
        candidateCount: candidates.length,
        validCount: validCandidates.length
      });
      return {
        learned: false,
        profileKey,
        reason: "存在 fallback 评估，跳过本次学习。"
      };
    }

    const selectedEvaluation = normalizeEvaluation(selectedCandidate.evaluation);
    if (!selectedEvaluation) {
      logInfo("preference-learning", "skip learning: selected evaluation invalid", {
        profileKey,
        generationRequestId: input.generationRequestId,
        selectedCandidateId: input.selectedCandidateId
      });
      return {
        learned: false,
        profileKey,
        reason: "选中候选的评估无效。"
      };
    }

    const competitors = validCandidates.filter((candidate) => candidate.id !== selectedCandidate.id);
    if (competitors.length === 0) {
      logInfo("preference-learning", "skip learning: no competitors", {
        profileKey,
        generationRequestId: input.generationRequestId,
        selectedCandidateId: input.selectedCandidateId
      });
      return {
        learned: false,
        profileKey,
        reason: "没有可对比的未选候选。"
      };
    }

    const competitorEvaluations = competitors
      .map((candidate) => normalizeEvaluation(candidate.evaluation))
      .filter((evaluation): evaluation is OpeningQualityEvaluation => Boolean(evaluation));

    if (competitorEvaluations.length !== competitors.length) {
      logInfo("preference-learning", "skip learning: incomplete competitor evaluations", {
        profileKey,
        generationRequestId: input.generationRequestId,
        competitorCount: competitors.length,
        validCompetitorCount: competitorEvaluations.length
      });
      return {
        learned: false,
        profileKey,
        reason: "对比候选评估不完整。"
      };
    }

    const delta = averagePairwiseDelta(selectedEvaluation, competitorEvaluations);
    const existingProfile = (await getPreferenceProfile(profileKey)) ?? null;
    const weightsBefore = existingProfile?.weights ?? createZeroWeights();
    const beforeArray = weightToArray(weightsBefore).map((value) => value * WEIGHT_DECAY);
    const deltaArray = weightToArray(delta);
    const afterArray = beforeArray.map((value, index) => {
      const blended = (1 - ALPHA) * value + ALPHA * (deltaArray[index] ?? 0);
      return clampWeight(blended);
    });
    const weightsAfter = arrayToWeights(afterArray);
    const learningCount = (existingProfile?.learningCount ?? 0) + 1;

    const explanation = buildLearningExplanation(selectedCandidate, delta, weightsAfter);
    const comparisonJson = JSON.stringify(
      buildComparisonSnapshot({
        profileKey,
        generationRequestId: input.generationRequestId,
        selectedCandidate,
        competitors,
        delta,
        beforeWeights: weightsBefore,
        afterWeights: weightsAfter
      })
    );

    await recordPreferenceLearningEvent({
      profileKey,
      generationRequestId: input.generationRequestId,
      selectedCandidateId: selectedCandidate.id,
      learningCount,
      weights: weightsAfter,
      comparisonJson,
      deltaJson: JSON.stringify(delta),
      selectedEvaluationJson: JSON.stringify(selectedEvaluation),
      explanation
    });

    logInfo("preference-learning", "learning completed", {
      profileKey,
      generationRequestId: input.generationRequestId,
      selectedCandidateId: selectedCandidate.id,
      learningCount,
      explanation,
      weightsAfter
    });

    return {
      learned: true,
      profileKey,
      learningCount,
      weightsBefore,
      weightsAfter,
      delta,
      summary: explanation
    };
  } catch (error) {
    logWarn("preference-learning", "learning failed and downgraded", {
      profileKey,
      generationRequestId: input.generationRequestId,
      selectedCandidateId: input.selectedCandidateId,
      error: summarizeError(error)
    });
    return {
      learned: false,
      profileKey,
      reason: "偏好学习过程失败，已自动降级。"
    };
  }
}
