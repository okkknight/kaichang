import { prisma } from "@/server/db/prisma";
import { BusinessError } from "@/server/errors";
import type {
  OpeningQualityEvaluation,
  OpeningCandidateView,
  OpeningStrategyType,
  PreferenceProfileSnapshot,
  PreferenceProfileWeights
} from "@/server/opening/types";

export const GENERATION_ACTION = "generate_openings";
export const COPY_ACTION = "copy_opening";

export type GenerationHistoryCandidate = {
  id: string;
  strategyType: string;
  text: string;
  openingStrategy: string;
  styleLabel: string;
  qualityScore: number;
  isSelected: boolean;
};

export type GenerationHistoryEntry = {
  id: string;
  input: string;
  selectedCandidateId: string | null;
  createdAt: Date;
  candidates: GenerationHistoryCandidate[];
};

export type StrategyFeedbackSummary = {
  strategyType: string;
  likeCount: number;
  dislikeCount: number;
};

export type RecentFeedbackEvent = {
  id: string;
  generationRequestId: string;
  candidateId: string;
  type: string;
  reasonTag: string | null;
  createdAt: Date;
  strategyType: OpeningStrategyType;
};

export type RecentCopyEvent = {
  id: string;
  candidateId: string;
  generationRequestId: string | null;
  selectedCandidateId: string | null;
  guestId: string | null;
  createdAt: Date;
  strategyType: OpeningStrategyType;
};

export type RefineOpeningCandidateContext = {
  candidateId: string;
  content: string;
  strategyType: string;
  openingStrategy: string;
  styleLabel: string;
  rawInput: string;
  styleOptions: string[];
  contentType: string;
};

export function todayKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export async function getUsageCountForGuest(guestId: string, dateKey = todayKey()) {
  return prisma.usageRecord.count({
    where: {
      guestId,
      usageDate: dateKey,
      actionType: GENERATION_ACTION
    }
  });
}

export async function createGenerationRequest(data: {
  guestId: string;
  rawInput: string;
  styleOptions: string[];
  detectedIntent: string;
  detectedTone: string[];
  contentType: string;
  candidateCount: number;
  providerName: string;
  modelName: string;
  latencyMs: number;
  status: string;
  errorMessage?: string | null;
}) {
  return prisma.generationRequest.create({
    data: {
      guestId: data.guestId,
      rawInput: data.rawInput,
      styleOptions: JSON.stringify(data.styleOptions),
      detectedIntent: data.detectedIntent,
      detectedTone: JSON.stringify(data.detectedTone),
      contentType: data.contentType,
      candidateCount: data.candidateCount,
      providerName: data.providerName,
      modelName: data.modelName,
      latencyMs: data.latencyMs,
      status: data.status,
      errorMessage: data.errorMessage ?? null
    }
  });
}

export async function updateGenerationRequest(
  id: string,
  data: {
    latencyMs?: number;
    status?: string;
    errorMessage?: string | null;
  }
) {
  return prisma.generationRequest.update({
    where: { id },
    data
  });
}

export async function createOpeningCandidates(
  generationRequestId: string,
  candidates: Array<{
    id?: string;
    rankOrder: number;
    strategyType: string;
    openingStrategy: string;
    styleLabel: string;
    content: string;
    qualityScore: number;
    evaluation?: OpeningQualityEvaluation | null;
    isSelected?: boolean;
  }>
): Promise<OpeningCandidateView[]> {
  return Promise.all(
    candidates.map((candidate) =>
      prisma.openingCandidate.create({
        data: {
          id: candidate.id,
          generationRequestId,
          rankOrder: candidate.rankOrder,
          strategyType: candidate.strategyType,
          openingStrategy: candidate.openingStrategy,
          styleLabel: candidate.styleLabel,
          content: candidate.content,
          qualityScore: candidate.qualityScore,
          evaluationTotalScore: candidate.evaluation?.totalScore ?? null,
          evaluationJson: candidate.evaluation ? JSON.stringify(candidate.evaluation) : null,
          evaluationModelName: candidate.evaluation?.modelName ?? null,
          evaluatedAt: candidate.evaluation ? new Date() : null,
          isSelected: candidate.isSelected ?? false
        }
      }).then((row) => mapOpeningCandidateRow(row))
    )
  );
}

export async function createOpeningCandidate(
  generationRequestId: string,
  candidate: {
    id?: string;
    rankOrder: number;
    strategyType: string;
    openingStrategy: string;
    styleLabel: string;
    content: string;
    qualityScore: number;
    evaluation?: OpeningQualityEvaluation | null;
    isSelected?: boolean;
  }
): Promise<OpeningCandidateView> {
  const [created] = await createOpeningCandidates(generationRequestId, [candidate]);
  if (!created) {
    throw new Error("创建候选失败。");
  }

  return created;
}

export async function updateOpeningCandidateEvaluations(
  generationRequestId: string,
  candidates: Array<{
    candidateId: string;
    evaluation: OpeningQualityEvaluation | null;
  }>
) {
  return prisma.$transaction(
    candidates.map((candidate) =>
      prisma.openingCandidate.updateMany({
        where: {
          id: candidate.candidateId,
          generationRequestId
        },
        data: {
          evaluationTotalScore: candidate.evaluation?.totalScore ?? null,
          evaluationJson: candidate.evaluation ? JSON.stringify(candidate.evaluation) : null,
          evaluationModelName: candidate.evaluation?.modelName ?? null,
          evaluatedAt: candidate.evaluation ? new Date() : null
        }
      })
    )
  );
}

export async function listCandidatesByGenerationRequest(generationRequestId: string) {
  const rows = await prisma.openingCandidate.findMany({
    where: { generationRequestId },
    orderBy: { rankOrder: "asc" }
  });

  return rows.map((row) => mapOpeningCandidateRow(row));
}

export async function getPreferenceProfile(profileKey: string): Promise<PreferenceProfileSnapshot | null> {
  const row = await prisma.preferenceProfile.findUnique({
    where: { profileKey }
  });

  return row ? mapPreferenceProfileRow(row) : null;
}

export async function getRefineOpeningCandidateContext(
  candidateId: string
): Promise<RefineOpeningCandidateContext | null> {
  const row = await prisma.openingCandidate.findUnique({
    where: { id: candidateId },
    include: {
      generationRequest: true
    }
  });

  if (!row) {
    return null;
  }

  return {
    candidateId: row.id,
    content: row.content,
    strategyType: row.strategyType,
    openingStrategy: row.openingStrategy,
    styleLabel: row.styleLabel,
    rawInput: row.generationRequest.rawInput,
    styleOptions: parseStringArray(row.generationRequest.styleOptions),
    contentType: row.generationRequest.contentType
  };
}

export async function createUsageRecord(data: {
  guestId: string;
  actionType: string;
  usageDate: string;
  creditsUsed?: number;
  generationRequestId?: string;
}) {
  return prisma.usageRecord.create({
    data: {
      guestId: data.guestId,
      actionType: data.actionType,
      usageDate: data.usageDate,
      creditsUsed: data.creditsUsed ?? 1,
      generationRequestId: data.generationRequestId
    }
  });
}

export async function recordFeedbackEvent(data: {
  generationRequestId: string;
  candidateId: string;
  type: "like" | "dislike";
  reasonTag?: string | null;
}) {
  const candidate = await prisma.openingCandidate.findFirst({
    where: {
      id: data.candidateId,
      generationRequestId: data.generationRequestId
    },
    select: {
      id: true
    }
  });

  if (!candidate) {
    throw new BusinessError("FEEDBACK_CANDIDATE_NOT_FOUND", "这条开头不属于当前记录。", 404);
  }

  return prisma.feedbackEvent.create({
    data: {
      generationRequestId: data.generationRequestId,
      candidateId: data.candidateId,
      type: data.type,
      reasonTag: data.reasonTag?.trim() || null
    }
  });
}

export async function listRecentGenerationHistory(guestId: string, limit = 20): Promise<GenerationHistoryEntry[]> {
  const rows = await prisma.generationRequest.findMany({
    where: { guestId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      candidates: {
        orderBy: { rankOrder: "asc" }
      }
    }
  });

  return rows.map((row) => {
    const selectedCandidate = row.candidates.find((candidate) => candidate.isSelected) ?? null;
    return {
      id: row.id,
      input: row.rawInput,
      selectedCandidateId: selectedCandidate?.id ?? null,
      createdAt: row.createdAt,
      candidates: row.candidates.map((candidate) => ({
        id: candidate.id,
        strategyType: candidate.strategyType,
        text: candidate.content,
        openingStrategy: candidate.openingStrategy,
        styleLabel: candidate.styleLabel,
        qualityScore: candidate.qualityScore,
        isSelected: candidate.isSelected
      }))
    };
  });
}

export async function getStrategyFeedbackAnalytics(): Promise<StrategyFeedbackSummary[]> {
  const events = await prisma.feedbackEvent.findMany({
    select: {
      type: true,
      candidate: {
        select: {
          strategyType: true
        }
      }
    }
  });

  const strategyTypes: OpeningStrategyType[] = ["scene", "emotion", "question", "statement", "contrast"];
  const summaryMap = new Map<string, StrategyFeedbackSummary>(
    strategyTypes.map((strategyType) => [strategyType, { strategyType, likeCount: 0, dislikeCount: 0 }])
  );

  for (const event of events) {
    const strategyType = event.candidate.strategyType;
    const current = summaryMap.get(strategyType) ?? { strategyType, likeCount: 0, dislikeCount: 0 };
    if (event.type === "like") {
      current.likeCount += 1;
    } else if (event.type === "dislike") {
      current.dislikeCount += 1;
    }
    summaryMap.set(strategyType, current);
  }

  return strategyTypes.map((strategyType) => summaryMap.get(strategyType) ?? {
    strategyType,
    likeCount: 0,
    dislikeCount: 0
  });
}

export async function listRecentFeedbackEventsForGuest(
  guestId: string,
  limit = 20
): Promise<RecentFeedbackEvent[]> {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit || 20)));
  const normalizedGuestId = guestId.trim();
  if (!normalizedGuestId) {
    return [];
  }

  const rows = await prisma.feedbackEvent.findMany({
    where: {
      generationRequest: {
        guestId: normalizedGuestId
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: safeLimit,
    select: {
      id: true,
      generationRequestId: true,
      candidateId: true,
      type: true,
      reasonTag: true,
      createdAt: true,
      candidate: {
        select: {
          strategyType: true
        }
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    generationRequestId: row.generationRequestId,
    candidateId: row.candidateId,
    type: row.type,
    reasonTag: row.reasonTag,
    createdAt: row.createdAt,
    strategyType: row.candidate.strategyType as OpeningStrategyType
  }));
}

export async function listRecentCopyEventsForGuest(guestId: string, limit = 20): Promise<RecentCopyEvent[]> {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit || 20)));
  const normalizedGuestId = guestId.trim();
  if (!normalizedGuestId) {
    return [];
  }

  const rows = await prisma.copyEvent.findMany({
    where: {
      guestId: normalizedGuestId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: safeLimit,
    select: {
      id: true,
      candidateId: true,
      generationRequestId: true,
      selectedCandidateId: true,
      guestId: true,
      createdAt: true,
      candidate: {
        select: {
          strategyType: true
        }
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    candidateId: row.candidateId,
    generationRequestId: row.generationRequestId,
    selectedCandidateId: row.selectedCandidateId,
    guestId: row.guestId,
    createdAt: row.createdAt,
    strategyType: row.candidate.strategyType as OpeningStrategyType
  }));
}

export async function recordPreferenceLearningEvent(data: {
  profileKey: string;
  generationRequestId: string;
  selectedCandidateId: string;
  learningCount: number;
  weights: PreferenceProfileWeights;
  comparisonJson: string;
  deltaJson: string;
  selectedEvaluationJson?: string | null;
  explanation: string;
}) {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.preferenceProfile.upsert({
      where: { profileKey: data.profileKey },
      create: {
        profileKey: data.profileKey,
        hookStrengthWeight: data.weights.hookStrength,
        clarityWeight: data.weights.clarity,
        noveltyWeight: data.weights.novelty,
        emotionalResonanceWeight: data.weights.emotionalResonance,
        visualImageryWeight: data.weights.visualImagery,
        thematicFitWeight: data.weights.thematicFit,
        learningCount: data.learningCount
      },
      update: {
        hookStrengthWeight: data.weights.hookStrength,
        clarityWeight: data.weights.clarity,
        noveltyWeight: data.weights.novelty,
        emotionalResonanceWeight: data.weights.emotionalResonance,
        visualImageryWeight: data.weights.visualImagery,
        thematicFitWeight: data.weights.thematicFit,
        learningCount: data.learningCount
      }
    });

    await tx.preferenceLearningEvent.create({
      data: {
        profileKey: data.profileKey,
        generationRequestId: data.generationRequestId,
        selectedCandidateId: data.selectedCandidateId,
        deltaJson: data.deltaJson,
        comparisonJson: data.comparisonJson,
        selectedEvaluationJson: data.selectedEvaluationJson ?? null,
        explanation: data.explanation
      }
    });

    return mapPreferenceProfileRow(profile);
  });
}

export async function recordCopyEvent(data: {
  candidateId: string;
  generationRequestId?: string | null;
  selectedCandidateId?: string | null;
  guestId?: string;
}) {
  try {
    await prisma.$transaction(async (tx) => {
      const selectedCandidateId = data.selectedCandidateId ?? data.candidateId;

      if (data.generationRequestId) {
        await tx.openingCandidate.updateMany({
          where: {
            generationRequestId: data.generationRequestId,
            NOT: { id: selectedCandidateId }
          },
          data: {
            isSelected: false
          }
        });
      }

      await tx.copyEvent.create({
        data: {
          candidateId: data.candidateId,
          generationRequestId: data.generationRequestId ?? null,
          selectedCandidateId,
          guestId: data.guestId
        }
      });

      await tx.openingCandidate.update({
        where: { id: data.candidateId },
        data: {
          isCopied: true,
          isSelected: true,
          copiedAt: new Date()
        }
      });
    });
  } catch (error) {
    if (isPrismaCopyCandidateError(error)) {
      throw new BusinessError("COPY_CANDIDATE_NOT_FOUND", "这条开头不存在或已经失效。", 404);
    }

    throw error;
  }
}

function isPrismaCopyCandidateError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["P2003", "P2025"].includes((error as { code?: string }).code ?? "")
  );
}

function mapOpeningCandidateRow<T extends {
  evaluationJson?: string | null;
  evaluationTotalScore?: number | null;
  evaluationModelName?: string | null;
  evaluatedAt?: Date | null;
  qualityScore: number;
  strategyType: string;
  openingStrategy: string;
  styleLabel: string;
  isCopied: boolean;
  isSelected: boolean;
  id: string;
  generationRequestId: string;
  rankOrder: number;
  content: string;
  createdAt: Date;
  copiedAt?: Date | null;
}>(row: T) {
  const evaluation = parseOpeningEvaluation(row.evaluationJson, row.evaluationModelName ?? undefined);
  return {
    ...row,
    strategyType: row.strategyType as OpeningStrategyType,
    evaluation,
    qualityScore: row.qualityScore
  } as OpeningCandidateView;
}

function parseOpeningEvaluation(value?: string | null, modelName?: string) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as OpeningQualityEvaluation;
    return {
      ...parsed,
      modelName: parsed.modelName ?? modelName ?? undefined
    };
  } catch {
    return null;
  }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapPreferenceProfileRow<T extends {
  profileKey: string;
  hookStrengthWeight: number;
  clarityWeight: number;
  noveltyWeight: number;
  emotionalResonanceWeight: number;
  visualImageryWeight: number;
  thematicFitWeight: number;
  learningCount: number;
  createdAt: Date;
  updatedAt: Date;
}>(row: T): PreferenceProfileSnapshot {
  return {
    profileKey: row.profileKey,
    weights: {
      hookStrength: row.hookStrengthWeight,
      clarity: row.clarityWeight,
      novelty: row.noveltyWeight,
      emotionalResonance: row.emotionalResonanceWeight,
      visualImagery: row.visualImageryWeight,
      thematicFit: row.thematicFitWeight
    },
    learningCount: row.learningCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
