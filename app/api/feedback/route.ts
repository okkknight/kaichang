import { NextResponse } from "next/server";
import { z } from "zod";
import { isBusinessError } from "@/server/errors";
import { recordFeedbackEvent } from "@/server/db/generation-repo";
import { logError, logInfo, summarizeError } from "@/server/logger";

const FeedbackSchema = z.object({
  generationRequestId: z.string().min(1),
  candidateId: z.string().min(1),
  type: z.enum(["like", "dislike"]),
  reasonTag: z.string().trim().optional()
});

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const body = await request.json();
    const parsed = FeedbackSchema.parse(body);
    logInfo("api/feedback", "request received", {
      traceId,
      generationRequestId: parsed.generationRequestId,
      candidateId: parsed.candidateId,
      type: parsed.type,
      reasonTag: parsed.reasonTag ?? null
    });

    await recordFeedbackEvent({
      generationRequestId: parsed.generationRequestId,
      candidateId: parsed.candidateId,
      type: parsed.type,
      reasonTag: parsed.reasonTag
    });

    logInfo("api/feedback", "request completed", {
      traceId,
      generationRequestId: parsed.generationRequestId,
      candidateId: parsed.candidateId,
      type: parsed.type
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api/feedback", "request failed", {
      traceId,
      error: summarizeError(error)
    });
    const message =
      error instanceof z.ZodError
        ? "反馈参数不正确。"
        : isBusinessError(error)
          ? error.message
          : "反馈失败，请稍后再试。";

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
