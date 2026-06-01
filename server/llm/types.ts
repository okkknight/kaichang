export type GenerateTextInput = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
};

export type GeneratedTextResult = {
  text: string;
  providerName: string;
  modelName: string;
  llmMode?: "real" | "mock" | "fallback";
  recoveryState?: "strict" | "recovered" | "fallback" | "mock";
};

export type StructuredRefinementResult = {
  refinedText: string;
  providerName: string;
  modelName: string;
  llmMode?: "real" | "mock";
  recoveryState?: "strict" | "mock";
};

export type LlmProvider = {
  providerName: string;
  modelName: string;
  llmMode?: "real" | "mock";
  generateText(input: GenerateTextInput): Promise<GeneratedTextResult>;
  generateOpenings(input: GenerateTextInput & { count: number }): Promise<GeneratedTextResult[]>;
  generateRefinement(input: GenerateTextInput): Promise<StructuredRefinementResult>;
};
