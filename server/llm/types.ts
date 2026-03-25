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
};

export type LlmProvider = {
  providerName: string;
  modelName: string;
  generateText(input: GenerateTextInput): Promise<GeneratedTextResult>;
  generateOpenings?(input: GenerateTextInput & { count: number }): Promise<GeneratedTextResult[]>;
};
