import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "@/server/llm/types";

function hasRealKey() {
  return Boolean(process.env.MINIMAX_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}

function getApiKey() {
  return process.env.MINIMAX_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
}

function getBaseUrl() {
  return process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimaxi.com/anthropic";
}

function getModelName() {
  return process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.5";
}

function normalizeText(text: string) {
  return text
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/^["“”]|["“”]$/g, "")
    .trim();
}

function stripTerminalPunctuation(value: string) {
  return value.replace(/[。！？!?\.]+$/g, "").trim();
}

function extractSubject(user: string) {
  const rawInput = user
    .split("\n")
    .find((line) => line.startsWith("原始输入："))
    ?.replace("原始输入：", "")
    .trim();

  if (!rawInput) {
    return "这个故事";
  }

  const aboutMatch = rawInput.match(/关于([^，。！？]+)/);
  if (aboutMatch?.[1]) {
    return stripTerminalPunctuation(aboutMatch[1]);
  }

  const storyMatch = rawInput.match(/(?:写一个|写一篇|关于)?([^，。！？]{2,14}?)(?:故事|内容|开头|开场|文案)/);
  if (storyMatch?.[1]) {
    return stripTerminalPunctuation(storyMatch[1]);
  }

  return stripTerminalPunctuation(rawInput.slice(0, 12));
}

function extractStrategy(user: string) {
  const strategyLine = user.split("\n").find((line) => line.startsWith("策略：")) ?? "策略：画面切入型";
  return strategyLine.replace("策略：", "").split("（")[0]?.trim() || "画面切入型";
}

function extractCandidateIndex(user: string) {
  const line = user.split("\n").find((item) => item.startsWith("候选序号："));
  const number = Number(line?.replace("候选序号：", "").trim() || "1");
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function buildMockOpening(user: string) {
  const strategy = extractStrategy(user);
  const subject = extractSubject(user);
  const candidateIndex = extractCandidateIndex(user);
  const subjectWithQuote = subject ? `“${subject}”` : "这一段";

  const variants: Record<string, string[]> = {
    "画面切入型": [
      `海风把甲板吹得发白的时候，${subjectWithQuote}才真正有了第一眼能看见的轮廓。`,
      `夜色压低了海面，${subjectWithQuote}站在船头，像一枚被命运提前放好的钉子。`
    ],
    "情绪切入型": [
      `很多时候，${subjectWithQuote}并不是靠一句话开始的，而是先从一种压得很低的情绪里慢慢浮出来。`,
      `她不是没有感觉，只是有些情绪一旦说出口，就会把人往更深的地方带。`
    ],
    "冲突切入型": [
      `所有人都以为这只是一次普通出航，只有${subjectWithQuote}知道，真正要对付的从来不是风浪。`,
      `事情从一开始就不对劲，只是没人愿意第一个承认。`
    ],
    "提问切入型": [
      `一个看起来永远不会退让的人，为什么偏偏会在最该往前走的时候停下来？`,
      `如果命运已经把门关上了，${subjectWithQuote}又该怎么把第一步迈出去？`
    ],
    "人物状态切入型": [
      `她站在那里，手心发紧，眼神却平静得像什么都没发生过。`,
      `他把所有话都压在了喉咙里，只留下一个看起来异常镇定的背影。`
    ],
    "反差切入型": [
      `最像赢家的人，往往最先被命运盯上。`,
      `越是看起来从容的人，越容易在某个瞬间把自己逼到墙角。`
    ],
    "日常细节切入型": [
      `那只磨得发白的罗盘还放在桌角，像昨晚没说完的话一样，安静得有点发凉。`,
      `门把手上残留着一点盐味，像是提醒她，今天不会是平常的一天。`
    ]
  };

  const pool = variants[strategy] || variants["画面切入型"];
  const text = pool[(candidateIndex - 1) % pool.length];

  return {
    text: normalizeText(text),
    providerName: "MiniMax",
    modelName: getModelName(),
    strategy
  };
}

function buildMockOpenings(input: { user: string; count: number }) {
  return Array.from({ length: input.count }, (_, index) => ({
    ...buildMockOpening(`${input.user}\n候选序号：${index + 1}`)
  }));
}

function extractTextFromAnthropicResponse(response: Awaited<ReturnType<Anthropic["messages"]["create"]>>) {
  if (!("content" in response)) {
    throw new Error("MiniMax 返回了流式响应，但当前实现期望非流式文本。");
  }

  const blocks = response.content as Array<{ type: string; text?: string }>;
  return blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function callAnthropicCompatibleModel(input: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}) {
  const client = new Anthropic({
    apiKey: getApiKey(),
    baseURL: getBaseUrl()
  });

  const response = await client.messages.create({
    model: getModelName(),
    max_tokens: input.maxTokens ?? 700,
    system: input.system,
    temperature: input.temperature ?? 1,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: input.user }]
      }
    ]
  });

  return {
    text: normalizeText(extractTextFromAnthropicResponse(response)),
    providerName: "MiniMax",
    modelName: getModelName()
  };
}

export function createMiniMaxProvider(): LlmProvider {
  if (!hasRealKey() || process.env.MOCK_LLM === "1") {
    return {
      providerName: "MiniMax",
      modelName: getModelName(),
      async generateText(input) {
        const mock = buildMockOpening(input.user);

        return {
          text: mock.text,
          providerName: mock.providerName,
          modelName: mock.modelName
        };
      },
      async generateOpenings(input) {
        return buildMockOpenings({
          user: input.user,
          count: input.count
        }).map((item) => ({
          text: item.text,
          providerName: item.providerName,
          modelName: item.modelName
        }));
      }
    };
  }

  return {
    providerName: "MiniMax",
    modelName: getModelName(),
    async generateText(input) {
      return callAnthropicCompatibleModel(input);
    },
    async generateOpenings(input) {
      const results = await Promise.all(
        Array.from({ length: input.count }, async (_, index) =>
          callAnthropicCompatibleModel({
            ...input,
            user: `${input.user}\n\n请确保这是一条与其他候选有明显差异的第 ${index + 1} 条结果。`
          })
        )
      );

      return results;
    }
  };
}
