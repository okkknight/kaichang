import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listRecentGenerationHistory } from "@/server/db/generation-repo";
import { logError, logInfo, summarizeError } from "@/server/logger";

function getGuestId(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore.get("kaichang_guest_id")?.value ?? null;
}

export async function GET() {
  const traceId = crypto.randomUUID();
  const cookieStore = await cookies();
  const guestId = getGuestId(cookieStore);

  if (!guestId) {
    logInfo("api/history", "guest id missing, returning empty list", {
      traceId
    });
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await listRecentGenerationHistory(guestId, 20);

    logInfo("api/history", "request completed", {
      traceId,
      guestId,
      itemCount: items.length
    });

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        input: item.input,
        selectedCandidateId: item.selectedCandidateId,
        createdAt: item.createdAt,
        candidates: item.candidates.map((candidate) => ({
          id: candidate.id,
          strategyType: candidate.strategyType,
          text: candidate.text
        }))
      }))
    });
  } catch (error) {
    logError("api/history", "request failed", {
      traceId,
      guestId,
      error: summarizeError(error)
    });
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}
