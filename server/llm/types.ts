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

export type LlmProvider = {
  providerName: string;
  modelName: string;
  llmMode?: "real" | "mock";
  generateText(input: GenerateTextInput): Promise<GeneratedTextResult>;
  generateOpenings(input: GenerateTextInput & { count: number }): Promise<GeneratedTextResult[]>;
};
