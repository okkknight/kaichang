import type { LlmProvider } from "@/server/llm/types";
import { logInfo, logWarn, summarizeError } from "@/server/logger";
import type {
  InputAnalysisResult,
  OpeningQualityDimensions,
  OpeningQualityEvaluation,
  OpeningStrategyType
} from "@/server/opening/types";

export const QUALITY_WEIGHTS = {
  hookStrength: 0.24,
  clarity: 0.12,
  novelty: 0.18,
  emotionalResonance: 0.12,
  visualImagery: 0.14,
  thematicFit: 0.2
} as const;

type OpeningCandidateEvaluationInput = {
  index: number;
  rawInput: string;
  contentType: InputAnalysisResult["contentType"];
  styleOptions: string[];
  strategyType: OpeningStrategyType;
  openingStrategy: string;
  styleLabel: string;
  content: string;
};

type RawEvaluationItem = {
  index?: number;
  totalScore?: number;
  dimensions?: Partial<OpeningQualityDimensions>;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
};

type RawEvaluationPayload = {
  evaluations?: RawEvaluationItem[];
};

function normalizeText(text: string) {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/^```[\s\S]*?```$/g, "")
    .trim();
}

function clampDimension(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 3;
  }

  return Math.min(5, Math.max(1, Math.round(number)));
}

function clampTotalScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 60;
  }

  return Math.min(100, Math.max(0, Math.round(number)));
}

function normalizeList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 4);

  return items.length > 0 ? items : fallback;
}

export function createNeutralEvaluation(modelName?: string): OpeningQualityEvaluation {
  return {
    totalScore: 60,
    dimensions: {
      hookStrength: 3,
      clarity: 3,
      novelty: 3,
      emotionalResonance: 3,
      visualImagery: 3,
      thematicFit: 3
    },
    summary: "评估暂时不可用，先按中性结果处理。",
    strengths: ["结构完整", "可以继续保留"],
    weaknesses: ["需要后续再校准表达层次"],
    source: "fallback",
    modelName
  };
}

export function computeOpeningFinalScore(evaluation: OpeningQualityEvaluation) {
  const dimensions = evaluation.dimensions;
  const weighted =
    dimensions.thematicFit * QUALITY_WEIGHTS.thematicFit +
    dimensions.hookStrength * QUALITY_WEIGHTS.hookStrength +
    dimensions.novelty * QUALITY_WEIGHTS.novelty +
    dimensions.clarity * QUALITY_WEIGHTS.clarity +
    dimensions.visualImagery * QUALITY_WEIGHTS.visualImagery +
    dimensions.emotionalResonance * QUALITY_WEIGHTS.emotionalResonance;

  return Math.round(weighted * 20);
}

function extractJsonPayload(text: string) {
  const normalized = normalizeText(text);
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("评估模型返回内容不是有效 JSON。");
  }

  return JSON.parse(normalized.slice(start, end + 1)) as RawEvaluationPayload;
}

function buildPromptInputs(candidates: OpeningCandidateEvaluationInput[]) {
  return candidates.map((candidate) => ({
    index: candidate.index,
    strategyType: candidate.strategyType,
    openingStrategy: candidate.openingStrategy,
    styleLabel: candidate.styleLabel,
    content: candidate.content
  }));
}

function buildSystemPrompt() {
  return [
    "你是《开场》的中文开头评审官。",
    "你的任务只有评估，不要改写，不要补写，不要给替代版本。",
    "你必须严格输出 JSON，不要输出 Markdown、代码块、解释、推理过程或额外文字。",
    "输出格式必须是：{\"evaluations\":[{\"index\":1,\"totalScore\":88,\"dimensions\":{\"hookStrength\":5,\"clarity\":4,\"novelty\":4,\"emotionalResonance\":4,\"visualImagery\":4,\"thematicFit\":5},\"summary\":\"...\",\"strengths\":[\"...\"],\"weaknesses\":[\"...\"]}]}。",
    "dimensions 每项只能是 1 到 5 的整数。",
    "totalScore 只能是 0 到 100 的整数。",
    "summary 用简短中文说明为什么这个开头好。",
    "strengths 和 weaknesses 各给 2 到 4 条简短中文短语。",
    "只评估开头本身，不要改写，不要比较成文，不要输出多余字段。"
  ].join("\n");
}

function buildUserPrompt(input: {
  rawInput: string;
  contentType: InputAnalysisResult["contentType"];
  styleOptions: string[];
  candidates: OpeningCandidateEvaluationInput[];
}) {
  return JSON.stringify(
    {
      task: "opening_quality_evaluation",
      rawInput: input.rawInput,
      contentType: input.contentType,
      styleOptions: input.styleOptions,
      candidates: buildPromptInputs(input.candidates)
    },
    null,
    2
  );
}

function normalizeEvaluationItem(
  item: RawEvaluationItem,
  candidate: OpeningCandidateEvaluationInput,
  modelName: string,
  fallbackIndex: number
): OpeningQualityEvaluation {
  const dimensions: OpeningQualityDimensions = {
    hookStrength: clampDimension(item.dimensions?.hookStrength),
    clarity: clampDimension(item.dimensions?.clarity),
    novelty: clampDimension(item.dimensions?.novelty),
    emotionalResonance: clampDimension(item.dimensions?.emotionalResonance),
    visualImagery: clampDimension(item.dimensions?.visualImagery),
    thematicFit: clampDimension(item.dimensions?.thematicFit)
  };

  return {
    totalScore: clampTotalScore(item.totalScore ?? 60),
    dimensions,
    summary:
      typeof item.summary === "string" && item.summary.trim().length > 0
        ? item.summary.trim().slice(0, 160)
        : `第 ${fallbackIndex} 条开头的整体表现较均衡，可以继续保留。`,
    strengths: normalizeList(item.strengths, ["结构完整", "表达清楚"]),
    weaknesses: normalizeList(item.weaknesses, ["还可以再拉开一点差异"]),
    source: "llm",
    modelName
  };
}

function buildFallbackEvaluations(
  candidates: OpeningCandidateEvaluationInput[],
  modelName: string
): OpeningQualityEvaluation[] {
  return candidates.map((candidate) => ({
    ...createNeutralEvaluation(modelName),
    summary: `暂时无法完成 LLM 评估，先按中性分处理「${candidate.strategyType}」候选。`,
    modelName
  }));
}

export async function evaluateOpeningCandidates(input: {
  provider: LlmProvider;
  rawInput: string;
  contentType: InputAnalysisResult["contentType"];
  styleOptions: string[];
  candidates: OpeningCandidateEvaluationInput[];
}): Promise<OpeningQualityEvaluation[]> {
  if (input.candidates.length === 0) {
    return [];
  }

  logInfo("opening-quality", "evaluation started", {
    candidateCount: input.candidates.length,
    contentType: input.contentType,
    styleOptions: input.styleOptions,
    providerName: input.provider.providerName,
    modelName: input.provider.modelName
  });

  const system = buildSystemPrompt();
  const user = buildUserPrompt({
    rawInput: input.rawInput,
    contentType: input.contentType,
    styleOptions: input.styleOptions,
    candidates: input.candidates
  });

  try {
    const response = await input.provider.generateText({
      system,
      user,
      temperature: 0.2,
      maxTokens: Math.min(1600, 320 + input.candidates.length * 220)
    });

    const parsed = extractJsonPayload(response.text);
    const items = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];
    const evaluations = input.candidates.map((candidate, index) => {
      const item = items.find((entry) => Number(entry.index) === index + 1) ?? items[index];
      if (!item) {
        return {
          ...createNeutralEvaluation(response.modelName),
          summary: `第 ${index + 1} 条候选缺少评估结果，先按中性分处理。`,
          modelName: response.modelName
        };
      }

      return normalizeEvaluationItem(item, candidate, response.modelName, index + 1);
    });

    logInfo("opening-quality", "evaluation completed", {
      candidateCount: evaluations.length,
      sourceCounts: evaluations.reduce<Record<string, number>>((acc, evaluation) => {
        const key = evaluation.source ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      scores: evaluations.map((evaluation) => evaluation.totalScore)
    });

    return evaluations;
  } catch (error) {
    logWarn("opening-quality", "evaluation fallback", {
      candidateCount: input.candidates.length,
      error: summarizeError(error)
    });
    return buildFallbackEvaluations(input.candidates, input.provider.modelName);
  }
}
