import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateOpenings } from "@/server/opening/generate-openings";
import { isBusinessError } from "@/server/errors";
import { logError, logInfo, summarizeError, truncateForLog } from "@/server/logger";
import type { GenerateOpeningsResponse } from "@/server/opening/types";

const RequestSchema = z.object({
  rawInput: z.string().min(1),
  styleOptions: z.array(z.string()).default([]),
  candidateCount: z.number().int().min(3).max(5).optional()
});

function getGuestId(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore.get("kaichang_guest_id")?.value ?? crypto.randomUUID();
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const cookieStore = await cookies();
    const guestId = getGuestId(cookieStore);
    const body = await request.json();
    if (body?.warmup === true) {
      logInfo("api/generate-openings", "warmup ping received", {
        traceId,
        guestId,
        warmup: true
      });
      const response = new NextResponse(null, { status: 204 });
      response.cookies.set("kaichang_guest_id", guestId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365
      });
      return response;
    }
    const parsed = RequestSchema.parse(body);
    logInfo("api/generate-openings", "request parsed", {
      traceId,
      guestId,
      candidateCount: parsed.candidateCount ?? 4,
      styleOptions: parsed.styleOptions,
      inputLength: parsed.rawInput.trim().length,
      inputPreview: truncateForLog(parsed.rawInput, 80)
    });
    const result = await generateOpenings({
      rawInput: parsed.rawInput,
      styleOptions: parsed.styleOptions,
      candidateCount: parsed.candidateCount ?? 4,
      guestId,
      traceId
    });

    logInfo("api/generate-openings", "request completed", {
      traceId,
      guestId,
      requestId: result.requestId,
      candidateCount: result.candidates.length,
      usageRemaining: result.usageRemaining,
      providerName: result.providerName,
      modelName: result.modelName
    });

    const response = NextResponse.json({
      requestId: result.requestId,
      candidates: result.candidates,
      analysis: result.analysis,
      usageRemaining: result.usageRemaining,
      providerName: result.providerName,
      modelName: result.modelName,
      llmMode: result.llmMode,
      generationState: result.generationState,
      evaluationState: result.evaluationState
    } satisfies GenerateOpeningsResponse);

    response.cookies.set("kaichang_guest_id", guestId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });

    return response;
  } catch (error) {
    logError("api/generate-openings", "request failed", {
      traceId,
      error: summarizeError(error)
    });
    const message =
      error instanceof z.ZodError
        ? "输入格式不正确。"
        : isBusinessError(error)
          ? error.message
          : "模型暂时不可用，请稍后再试。";
    return NextResponse.json(
      {
        error: message
      },
      { status: error instanceof z.ZodError ? 400 : isBusinessError(error) ? error.statusCode : 502 }
    );
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}
