import { analyzeInput } from "@/server/opening/analyze-input";
import {
  createGenerationRequest,
  createOpeningCandidates,
  createUsageRecord,
  getUsageCountForGuest,
  todayKey,
  updateGenerationRequest
} from "@/server/db/generation-repo";
import { getDefaultLlmProvider } from "@/server/llm/provider";
import type { GeneratedOpeningCandidate, GenerateOpeningsInput } from "@/server/opening/types";
import { buildOpeningPrompt } from "@/server/opening/prompt-builder";
import { chooseOpeningStrategies } from "@/server/opening/strategy-engine";
import { rankCandidates } from "@/server/opening/rank-candidates";

const DEFAULT_CANDIDATE_COUNT = 4;
const MIN_INPUT_LENGTH = 20;
const MAX_INPUT_LENGTH = 2000;
const DAILY_GUEST_LIMIT = 3;

function clampCandidateCount(value: number) {
  return Math.min(5, Math.max(3, value || DEFAULT_CANDIDATE_COUNT));
}

function normalizeOpeningText(text: string) {
  return text
    .replace(/^[-*]\s*/gm, "")
    .replace(/^\s*["“”]/, "")
    .replace(/["“”]\s*$/, "")
    .trim();
}

function candidateSeed(
  openingStrategy: string,
  styleLabel: string,
  content: string,
  qualityScore: number,
  generationRequestId: string
): GeneratedOpeningCandidate {
  return {
    id: crypto.randomUUID(),
    generationRequestId,
    rankOrder: 0,
    openingStrategy,
    styleLabel,
    content,
    qualityScore,
    isCopied: false,
    isSelected: false
  };
}

export async function generateOpenings(input: GenerateOpeningsInput) {
  const normalizedInput = input.rawInput.trim();
  if (normalizedInput.length < MIN_INPUT_LENGTH) {
    throw new Error("内容至少需要 20 个字。");
  }
  if (normalizedInput.length > MAX_INPUT_LENGTH) {
    throw new Error("内容最多 2000 个字。");
  }

  const usageDate = todayKey();
  const currentUsage = await getUsageCountForGuest(input.guestId, usageDate);
  if (currentUsage >= DAILY_GUEST_LIMIT) {
    throw new Error("今天的免费次数已经用完了，明天再来试试。");
  }

  const analysis = analyzeInput(normalizedInput);
  const provider = getDefaultLlmProvider();
  const candidateCount = clampCandidateCount(input.candidateCount);
  const strategies = chooseOpeningStrategies(analysis, input.styleOptions, candidateCount);

  const generationStartedAt = Date.now();
  const generationRequest = await createGenerationRequest({
    guestId: input.guestId,
    rawInput: normalizedInput,
    styleOptions: input.styleOptions,
    detectedIntent: analysis.summary,
    detectedTone: analysis.tone,
    contentType: analysis.contentType,
    candidateCount,
    providerName: provider.providerName,
    modelName: provider.modelName,
    latencyMs: 0,
    status: "running"
  });

  const generatedCandidates: GeneratedOpeningCandidate[] = [];

  for (const [index, strategy] of strategies.entries()) {
    const { system, user } = buildOpeningPrompt({
      rawInput: normalizedInput,
      analysis,
      strategy,
      styleOptions: input.styleOptions,
      candidateIndex: index
    });

    const result = await provider.generateText({
      system,
      user,
      temperature: 1,
      maxTokens: 500
    });

    generatedCandidates.push(
      candidateSeed(
        strategy.label,
        input.styleOptions[index % Math.max(1, input.styleOptions.length)] || analysis.preferredStyles[index % analysis.preferredStyles.length] || strategy.label,
        normalizeOpeningText(result.text),
        50,
        generationRequest.id
      )
    );
  }

  const ranked = rankCandidates(generatedCandidates, analysis, strategies);

  await createUsageRecord({
    guestId: input.guestId,
    actionType: "generate_openings",
    usageDate,
    creditsUsed: 1,
    generationRequestId: generationRequest.id
  });

  const finishedAt = Date.now();
  await updateGenerationRequest(generationRequest.id, {
    latencyMs: finishedAt - generationStartedAt,
    status: "completed"
  });

  const persistedCandidates = await createOpeningCandidates(
    generationRequest.id,
    ranked.map((candidate) => ({
      rankOrder: candidate.rankOrder,
      openingStrategy: candidate.openingStrategy,
      styleLabel: candidate.styleLabel,
      content: candidate.content,
      qualityScore: candidate.qualityScore,
      isSelected: candidate.isSelected
    }))
  );

  return {
    requestId: generationRequest.id,
    analysis,
    candidates: persistedCandidates.map((candidate) => ({
      id: candidate.id,
      openingStrategy: candidate.openingStrategy,
      styleLabel: candidate.styleLabel,
      content: candidate.content,
      qualityScore: candidate.qualityScore,
      isCopied: candidate.isCopied,
      isSelected: candidate.isSelected
    })),
    usageRemaining: Math.max(0, DAILY_GUEST_LIMIT - currentUsage - 1),
    providerName: provider.providerName,
    modelName: provider.modelName
  };
}
