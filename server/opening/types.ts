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

export type ContentType = "novel" | "essay" | "content" | "mixed";

export type InputAnalysisResult = {
  contentType: ContentType;
  tone: string[];
  preferredStyles: string[];
  primaryNeeds: string[];
  audience: string;
  lengthPreference: "short" | "medium" | "long";
  summary: string;
};

export type OpeningStrategyKey =
  | "scene"
  | "emotion"
  | "conflict"
  | "question"
  | "character"
  | "contrast"
  | "detail";

export type OpeningStrategyPlan = {
  key: OpeningStrategyKey;
  label: string;
  reason: string;
  angle: string;
  lengthHint: string;
};

export type OpeningCandidateView = {
  id: string;
  openingStrategy: string;
  styleLabel: string;
  content: string;
  qualityScore: number;
  isCopied: boolean;
  isSelected: boolean;
};

export type GeneratedOpeningCandidate = OpeningCandidateView & {
  generationRequestId: string;
  rankOrder: number;
};

export type GenerateOpeningsInput = {
  rawInput: string;
  styleOptions: string[];
  candidateCount: number;
  guestId: string;
};
