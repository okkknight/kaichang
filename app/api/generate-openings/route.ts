import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateOpenings } from "@/server/opening/generate-openings";

const RequestSchema = z.object({
  rawInput: z.string().min(1),
  styleOptions: z.array(z.string()).default([]),
  candidateCount: z.number().int().min(3).max(5).optional()
});

function getGuestId(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return cookieStore.get("kaichang_guest_id")?.value ?? crypto.randomUUID();
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const guestId = getGuestId(cookieStore);
    const body = await request.json();
    const parsed = RequestSchema.parse(body);
    const result = await generateOpenings({
      rawInput: parsed.rawInput,
      styleOptions: parsed.styleOptions,
      candidateCount: parsed.candidateCount ?? 4,
      guestId
    });

    const response = NextResponse.json({
      requestId: result.requestId,
      candidates: result.candidates,
      analysis: result.analysis,
      usageRemaining: result.usageRemaining
    });

    response.cookies.set("kaichang_guest_id", guestId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });

    return response;
  } catch (error) {
    const message = error instanceof z.ZodError ? "输入格式不正确。" : error instanceof Error ? error.message : "生成失败。";
    return NextResponse.json(
      {
        error: message
      },
      {
        status: error instanceof z.ZodError ? 400 : 500
      }
    );
  }
}
