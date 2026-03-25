import { prisma } from "@/server/db/prisma";

export const GENERATION_ACTION = "generate_openings";
export const COPY_ACTION = "copy_opening";

export function todayKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export async function getUsageCountForGuest(guestId: string, dateKey = todayKey()) {
  return prisma.usageRecord.count({
    where: {
      guestId,
      usageDate: dateKey,
      actionType: GENERATION_ACTION
    }
  });
}

export async function createGenerationRequest(data: {
  guestId: string;
  rawInput: string;
  styleOptions: string[];
  detectedIntent: string;
  detectedTone: string[];
  contentType: string;
  candidateCount: number;
  providerName: string;
  modelName: string;
  latencyMs: number;
  status: string;
}) {
  return prisma.generationRequest.create({
    data: {
      guestId: data.guestId,
      rawInput: data.rawInput,
      styleOptions: JSON.stringify(data.styleOptions),
      detectedIntent: data.detectedIntent,
      detectedTone: JSON.stringify(data.detectedTone),
      contentType: data.contentType,
      candidateCount: data.candidateCount,
      providerName: data.providerName,
      modelName: data.modelName,
      latencyMs: data.latencyMs,
      status: data.status
    }
  });
}

export async function updateGenerationRequest(
  id: string,
  data: {
    latencyMs?: number;
    status?: string;
  }
) {
  return prisma.generationRequest.update({
    where: { id },
    data
  });
}

export async function createOpeningCandidates(
  generationRequestId: string,
  candidates: Array<{
    rankOrder: number;
    openingStrategy: string;
    styleLabel: string;
    content: string;
    qualityScore: number;
    isSelected?: boolean;
  }>
) {
  return Promise.all(
    candidates.map((candidate) =>
      prisma.openingCandidate.create({
        data: {
          generationRequestId,
          rankOrder: candidate.rankOrder,
          openingStrategy: candidate.openingStrategy,
          styleLabel: candidate.styleLabel,
          content: candidate.content,
          qualityScore: candidate.qualityScore,
          isSelected: candidate.isSelected ?? false
        }
      })
    )
  );
}

export async function listCandidatesByGenerationRequest(generationRequestId: string) {
  return prisma.openingCandidate.findMany({
    where: { generationRequestId },
    orderBy: { rankOrder: "asc" }
  });
}

export async function createUsageRecord(data: {
  guestId: string;
  actionType: string;
  usageDate: string;
  creditsUsed?: number;
  generationRequestId?: string;
}) {
  return prisma.usageRecord.create({
    data: {
      guestId: data.guestId,
      actionType: data.actionType,
      usageDate: data.usageDate,
      creditsUsed: data.creditsUsed ?? 1,
      generationRequestId: data.generationRequestId
    }
  });
}

export async function recordCopyEvent(data: {
  candidateId: string;
  guestId?: string;
}) {
  await prisma.$transaction([
    prisma.copyEvent.create({
      data: {
        candidateId: data.candidateId,
        guestId: data.guestId
      }
    }),
    prisma.openingCandidate.update({
      where: { id: data.candidateId },
      data: {
        isCopied: true,
        copiedAt: new Date()
      }
    })
  ]);
}
