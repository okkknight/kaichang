import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordCopyEvent } from "@/server/db/generation-repo";

const CopySchema = z.object({
  candidateId: z.string().min(1),
  generationRequestId: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CopySchema.parse(body);
    const guestId = (await cookies()).get("kaichang_guest_id")?.value;

    await recordCopyEvent({
      candidateId: parsed.candidateId,
      guestId
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof z.ZodError ? "复制事件参数不正确。" : error instanceof Error ? error.message : "记录复制失败。";
    return NextResponse.json(
      {
        error: message
      },
      { status: error instanceof z.ZodError ? 400 : 500 }
    );
  }
}
