export const STYLE_OPTIONS = [
  { label: "抓人" },
  { label: "氛围" },
  { label: "克制" },
  { label: "文学感" },
  { label: "小说感" },
  { label: "随笔感" },
  { label: "公众号感" },
  { label: "小红书感" }
] as const;

export type StyleLabel = (typeof STYLE_OPTIONS)[number]["label"];

export type ContentType = "novel" | "essay" | "article";
export type LlmMode = "real" | "mock" | "fallback";
export type GenerationState = "real" | "recovered" | "fallback" | "mock";
export type EvaluationState = "real" | "fallback" | "pending" | "mock";

export type OpeningStrategyType = "scene" | "emotion" | "question" | "statement" | "contrast";

export type OpeningExpressionMode =
  | "detail_focus"
  | "motion_focus"
  | "sensory_focus"
  | "object_focus"
  | "atmosphere_focus"
  | "body_signal"
  | "inner_voice"
  | "memory_trigger"
  | "quiet_scene"
  | "pressure_wave"
  | "direct_question"
  | "self_question"
  | "rhetorical_question"
  | "scenario_question"
  | "double_question"
  | "judgment"
  | "observation"
  | "paradox"
  | "rule_of_thumb"
  | "turning_point"
  | "appearance_vs_truth"
  | "before_after"
  | "expectation_gap"
  | "small_twist"
  | "parallel_split";

export type OpeningQualityDimensions = {
  hookStrength: number;
  clarity: number;
  novelty: number;
  emotionalResonance: number;
  visualImagery: number;
  thematicFit: number;
};

export type OpeningQualityEvaluation = {
  totalScore: number;
  dimensions: OpeningQualityDimensions;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  source?: "llm" | "fallback" | "rule";
  modelName?: string;
};

export type NarrationMode = "first_person" | "third_person" | "mixed" | "unknown";
export type SpecificityLevel = "high" | "medium" | "low";

export type OpeningInputBrief = {
  rawInput: string;
  contentType: ContentType;
  preferredStyles: string[];
  lengthPreference: "short" | "medium" | "long";
};

export type EntryAngleBrief = {
  id: string;
  label: string;
  description: string;
  mustPreserve: string[];
  shouldAvoid: string[];
  strategyType: OpeningStrategyType;
  expressionMode: OpeningExpressionMode;
  lengthHint: string;
};

export type PreferenceProfileWeights = OpeningQualityDimensions;

export type PreferenceProfileSnapshot = {
  profileKey: string;
  weights: PreferenceProfileWeights;
  learningCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PreferenceLearningResult = {
  learned: boolean;
  profileKey: string | null;
  reason?: string;
  learningCount?: number;
  weightsBefore?: PreferenceProfileWeights;
  weightsAfter?: PreferenceProfileWeights;
  delta?: PreferenceProfileWeights;
  summary?: string;
};

export type InputAnalysisResult = {
  rawInput: string;
  contentType: ContentType;
  preferredStyles: string[];
  lengthPreference: "short" | "medium" | "long";
};

export type OpeningStrategyPlan = {
  strategyType: OpeningStrategyType;
  label: string;
  reason: string;
  angle: string;
  lengthHint: string;
  expressionMode: OpeningExpressionMode;
  entryAngle: EntryAngleBrief;
};

export type OpeningBatchSlot = {
  strategyType: OpeningStrategyType;
  openingStrategy: string;
  styleLabel: string;
  angle: string;
  lengthHint: string;
  expressionMode: OpeningExpressionMode;
  entryAngle: EntryAngleBrief;
};

export type OpeningBatchRepairSlot = OpeningBatchSlot & {
  reason: string;
  previousOutput: string;
};

export type OpeningCandidateView = {
  id: string;
  strategyType: OpeningStrategyType;
  openingStrategy: string;
  styleLabel: string;
  content: string;
  structureKey?: string;
  formulaKey?: string;
  leadSignature?: string;
  signatureFingerprint?: string;
  qualityScore: number;
  evaluation: OpeningQualityEvaluation | null;
  isCopied: boolean;
  isSelected: boolean;
};

export type GeneratedOpeningCandidate = OpeningCandidateView & {
  generationRequestId: string;
  rankOrder: number;
};

export type GenerateOpeningsResponse = {
  requestId: string;
  analysis: InputAnalysisResult;
  candidates: OpeningCandidateView[];
  usageRemaining: number;
  providerName: string;
  modelName: string;
  llmMode: LlmMode;
  generationState: GenerationState;
  evaluationState: EvaluationState;
};

export type GenerateOpeningsInput = {
  rawInput: string;
  styleOptions: string[];
  candidateCount: number;
  guestId: string;
  traceId?: string;
};
