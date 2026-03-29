import { NextResponse } from "next/server";
import { getStrategyFeedbackAnalytics } from "@/server/db/generation-repo";

export async function GET() {
  const items = await getStrategyFeedbackAnalytics();
  return NextResponse.json({ items });
}
