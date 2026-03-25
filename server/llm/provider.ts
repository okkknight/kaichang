import { createMiniMaxProvider } from "@/server/llm/providers/minimax";
import type { LlmProvider } from "@/server/llm/types";

export function getDefaultLlmProvider(): LlmProvider {
  return createMiniMaxProvider();
}
