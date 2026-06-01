import type { OpeningStrategyType } from "@/server/opening/types";

export type FeedbackSignalType = "copy" | "like" | "dislike";

export type FeedbackPreferenceWeights = Record<OpeningStrategyType, number>;

export type FeedbackPreferenceSignal = {
  generationRequestId: string;
  candidateId: string;
  strategyType: OpeningStrategyType;
  type: FeedbackSignalType;
  reasonTag?: string | null;
  createdAt: Date;
};

export type FeedbackPreferenceComputation = {
  weights: FeedbackPreferenceWeights;
  rawCount: number;
  dedupedCount: number;
  duplicateCount: number;
  strategyCounts: Record<OpeningStrategyType, number>;
};

const STRATEGY_TYPES: OpeningStrategyType[] = [
  "scene",
  "emotion",
  "contrast",
  "question",
  "statement"
];

const REASON_MAP: Record<string, Partial<FeedbackPreferenceWeights>> = {
  "没画面感": { scene: 0.1 },
  "太直白": { emotion: -0.1 },
  "太平淡": { contrast: 0.1 },
  "不像人写的": { statement: -0.1 }
};

const MIN_WEIGHT = -0.3;
const MAX_WEIGHT = 0.3;
const TIME_DECAY_LAMBDA = 0.02;
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

function clampWeight(weight: number) {
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weight));
}

function createNeutralWeights(): FeedbackPreferenceWeights {
  return {
    scene: 0,
    emotion: 0,
    contrast: 0,
    question: 0,
    statement: 0
  };
}

function createZeroStrategyCounts(): Record<OpeningStrategyType, number> {
  return {
    scene: 0,
    emotion: 0,
    contrast: 0,
    question: 0,
    statement: 0
  };
}

export function getFeedbackConfidence(signal: FeedbackPreferenceSignal) {
  if (signal.type === "copy") {
    return 1;
  }

  const hasReasonTag = Boolean(signal.reasonTag?.trim());
  if (signal.type === "like") {
    return hasReasonTag ? 0.8 : 0.6;
  }

  return hasReasonTag ? 0.7 : 0.4;
}

export function getFeedbackTimeDecay(createdAt: Date, now = new Date()) {
  const ageHours = Math.max(0, (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000));
  return Math.exp(-TIME_DECAY_LAMBDA * ageHours);
}

export function normalizeFeedbackSignals(signals: FeedbackPreferenceSignal[], now = new Date()) {
  const sorted = [...signals].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const deduped: FeedbackPreferenceSignal[] = [];
  const lastCountedByKey = new Map<string, number>();
  let duplicateCount = 0;

  for (const signal of sorted) {
    const key = [
      signal.generationRequestId,
      signal.candidateId,
      signal.type,
      (signal.reasonTag ?? "").trim()
    ].join("::");
    const createdAtMs = signal.createdAt.getTime();
    const lastCountedAtMs = lastCountedByKey.get(key);

    if (lastCountedAtMs !== undefined && lastCountedAtMs - createdAtMs <= DEDUPE_WINDOW_MS) {
      duplicateCount += 1;
      continue;
    }

    lastCountedByKey.set(key, createdAtMs);
    deduped.push(signal);
  }

  return {
    signals: deduped,
    rawCount: signals.length,
    dedupedCount: deduped.length,
    duplicateCount,
    now
  };
}

function createFallbackDelta(signal: FeedbackPreferenceSignal) {
  const magnitude = signal.type === "copy" ? 0.12 : signal.type === "like" ? 0.05 : -0.05;
  return {
    [signal.strategyType]: magnitude
  } as Partial<FeedbackPreferenceWeights>;
}

function getSignalDelta(signal: FeedbackPreferenceSignal) {
  if (signal.type === "copy") {
    return {
      [signal.strategyType]: 0.12
    } as Partial<FeedbackPreferenceWeights>;
  }

  const reasonTag = signal.reasonTag?.trim();
  if (reasonTag && REASON_MAP[reasonTag]) {
    return REASON_MAP[reasonTag];
  }

  return createFallbackDelta(signal);
}

export function computeFeedbackPreference(signals: FeedbackPreferenceSignal[]) {
  return analyzeFeedbackPreference(signals).weights;
}

export function analyzeFeedbackPreference(signals: FeedbackPreferenceSignal[]): FeedbackPreferenceComputation {
  const normalized = normalizeFeedbackSignals(signals);
  const weights = createNeutralWeights();
  const strategyCounts = createZeroStrategyCounts();

  for (const signal of normalized.signals) {
    const delta = getSignalDelta(signal);
    const confidence = getFeedbackConfidence(signal);
    const decay = getFeedbackTimeDecay(signal.createdAt, normalized.now);
    const scale = confidence * decay;

    for (const strategyType of STRATEGY_TYPES) {
      const change = delta[strategyType];
      if (!change) {
        continue;
      }

      weights[strategyType] = clampWeight(weights[strategyType] + change * scale);
      strategyCounts[strategyType] += 1;
    }
  }

  return {
    weights,
    rawCount: normalized.rawCount,
    dedupedCount: normalized.dedupedCount,
    duplicateCount: normalized.duplicateCount,
    strategyCounts
  };
}
