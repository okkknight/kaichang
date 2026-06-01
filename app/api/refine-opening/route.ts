import { NextResponse } from "next/server";
import { z } from "zod";
import { BusinessError, isBusinessError } from "@/server/errors";
import { getRefineOpeningCandidateContext } from "@/server/db/generation-repo";
import { getDefaultLlmProvider } from "@/server/llm/provider";
import { logError, logInfo, summarizeError, truncateForLog } from "@/server/logger";

const REFINE_MAP = {
  more_hook: "让开头更有抓力，在第一句话就吸引人",
  more_subtle: "让情绪更克制，不要直接表达情绪",
  more_visual: "增强画面感，让读者能看到具体场景",
  more_literary: "语言更有文学性，但不要晦涩"
} as const;

const RefineSchema = z.object({
  candidateId: z.string().min(1),
  instruction: z.enum(["more_hook", "more_subtle", "more_visual", "more_literary"])
});

function normalizeText(text: string) {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/^["“”]|["“”]$/g, "")
    .trim();
}

function buildSystemPrompt() {
  return [
    "你是《开场》的中文开头改写器。",
    "你的任务只有改写开头，不要解释，不要分析，不要列点，不要输出标题或编号。",
    "你必须调用名为 emit_refined_opening 的工具来返回结果，不要直接输出正文。",
    "工具输入必须且只能包含 refinedText 字段，且 refinedText 只能是可直接展示的中文开头正文。",
    "不要输出 JSON 以外的额外文字，不要输出 Markdown，不要输出 thinking，不要输出分析过程。",
    "保留原始主题，不要跑题。",
    "保留开头属性，不要写成整段正文。",
    "如果要求更克制，就收紧情绪表达；如果要求更抓人，就提高第一句钩子；如果要求更画面，就增加具体场景；如果要求更文学，就提升语言质感但不要晦涩。"
  ].join("\n");
}

function buildUserPrompt(input: {
  instructionLabel: string;
  rawInput: string;
  contentType: string;
  styleOptions: string[];
  strategyType: string;
  openingStrategy: string;
  styleLabel: string;
  content: string;
}) {
  return [
    `改写目标：${input.instructionLabel}`,
    `原始输入：${input.rawInput}`,
    `内容类型：${input.contentType}`,
    `风格标签：${input.styleOptions.join("、") || "无"}`,
    `策略类型：${input.strategyType}`,
    `策略名称：${input.openingStrategy}`,
    `风格说明：${input.styleLabel}`,
    `原文：${input.content}`,
    "要求：",
    "1. 只返回改写后的开头正文。",
    "2. 不要解释，不要总结，不要加注释。",
    "3. 长度尽量和原文接近。",
    "4. 不要改变核心主题。"
  ].join("\n");
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const body = await request.json();
    const parsed = RefineSchema.parse(body);
    logInfo("api/refine-opening", "request received", {
      traceId,
      candidateId: parsed.candidateId,
      instruction: parsed.instruction
    });
    const context = await getRefineOpeningCandidateContext(parsed.candidateId);

    if (!context) {
      throw new BusinessError("REFINE_CANDIDATE_NOT_FOUND", "这条开头不存在或已被删除。", 404);
    }

    const provider = getDefaultLlmProvider();
    const instructionLabel = REFINE_MAP[parsed.instruction];
    const response = await provider.generateRefinement({
      system: buildSystemPrompt(),
      user: buildUserPrompt({
        instructionLabel,
        rawInput: context.rawInput,
        contentType: context.contentType,
        styleOptions: context.styleOptions,
        strategyType: context.strategyType,
        openingStrategy: context.openingStrategy,
        styleLabel: context.styleLabel,
        content: context.content
      }),
      temperature: 0.75,
      // MiniMax still spends a large part of the output budget on reasoning metadata
      // before emitting the forced tool call, so refine needs more headroom than 320.
      maxTokens: 900
    });

    const refinedText = normalizeText(response.refinedText);
    if (!refinedText) {
      throw new BusinessError("REFINE_STRUCTURED_OUTPUT_INVALID", "模型没有按结构化格式返回改写结果。", 502);
    }

    logInfo("api/refine-opening", "request completed", {
      traceId,
      candidateId: parsed.candidateId,
      instruction: parsed.instruction,
      modelName: response.modelName,
      llmMode: response.llmMode,
      refinedLength: refinedText.length,
      refinedPreview: truncateForLog(refinedText, 120)
    });

    return NextResponse.json({
      candidateId: parsed.candidateId,
      instruction: parsed.instruction,
      instructionLabel,
      refinedText,
      modelName: response.modelName,
      llmMode: response.llmMode
    });
  } catch (error) {
    logError("api/refine-opening", "request failed", {
      traceId,
      error: summarizeError(error)
    });
    const message =
      error instanceof z.ZodError
        ? "微调参数不正确。"
        : isBusinessError(error)
          ? error.message
          : "微调失败，请稍后再试。";
    return NextResponse.json(
      {
        error: message
      },
      {
        status: error instanceof z.ZodError ? 400 : isBusinessError(error) ? error.statusCode : 500
      }
    );
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}
