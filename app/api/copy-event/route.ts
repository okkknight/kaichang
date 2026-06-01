import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordCopyEvent } from "@/server/db/generation-repo";
import { isBusinessError } from "@/server/errors";
import { logError, logInfo, logWarn, summarizeError } from "@/server/logger";
import { learnPreferenceFromCopySelection } from "@/server/opening/preference-learning";

const CopySchema = z.object({
  candidateId: z.string().min(1),
  generationRequestId: z.string().min(1).optional(),
  selectedCandidateId: z.string().min(1).optional()
});

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const body = await request.json();
    const parsed = CopySchema.parse(body);
    const guestId = (await cookies()).get("kaichang_guest_id")?.value;

    logInfo("api/copy-event", "request received", {
      traceId,
      guestId,
      generationRequestId: parsed.generationRequestId ?? null,
      candidateId: parsed.candidateId,
      selectedCandidateId: parsed.selectedCandidateId ?? null
    });

    await recordCopyEvent({
      candidateId: parsed.candidateId,
      generationRequestId: parsed.generationRequestId,
      selectedCandidateId: parsed.selectedCandidateId,
      guestId
    });

    void learnPreferenceFromCopySelection({
      guestId,
      generationRequestId: parsed.generationRequestId ?? null,
      selectedCandidateId: parsed.selectedCandidateId ?? parsed.candidateId
    }).catch((error) => {
      logWarn("api/copy-event", "preference learning skipped", {
        traceId,
        guestId,
        generationRequestId: parsed.generationRequestId ?? null,
        candidateId: parsed.candidateId,
        error: summarizeError(error)
      });
      return null;
    });

    logInfo("api/copy-event", "request completed", {
      traceId,
      guestId,
      generationRequestId: parsed.generationRequestId ?? null,
      candidateId: parsed.candidateId
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api/copy-event", "request failed", {
      traceId,
      error: summarizeError(error)
    });
    const message =
      error instanceof z.ZodError
        ? "复制事件参数不正确。"
        : isBusinessError(error)
          ? error.message
          : "复制失败，请稍后再试。";
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
