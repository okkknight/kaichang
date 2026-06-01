import type { GenerationHistoryEntry } from "@/server/db/generation-repo";
import type { OpeningStrategyType } from "@/server/opening/types";

type OpeningOutputSignature = {
  strategyType: OpeningStrategyType;
  normalizedContent: string;
  structureKey: string;
  formulaKey: string;
  leadSignature: string;
  semanticHead: string;
  themeClusterKey: string;
  planFingerprint: string;
  clusterFamilyKey: string;
  planClusterKey: string;
  semanticLeadKey: string;
  semanticNgrams: string[];
  fingerprint: string;
};

export type RecentOutputSignatureEntry = {
  strategyType: OpeningStrategyType;
  normalizedContent: string;
  structureKey: string;
  formulaKey: string;
  leadSignature: string;
  semanticHead: string;
  themeClusterKey: string;
  planFingerprint: string;
  clusterFamilyKey: string;
  planClusterKey: string;
  semanticLeadKey: string;
  semanticNgrams: string[];
  fingerprint: string;
  preview: string;
};

export type RecentOutputSignatureMemory = {
  entries: RecentOutputSignatureEntry[];
  fingerprints: Set<string>;
  normalizedContents: Set<string>;
  structureKeys: Set<string>;
  formulaKeys: Set<string>;
  leadSignatures: Set<string>;
  semanticHeads: Set<string>;
  themeClusterKeys: Set<string>;
  planFingerprints: Set<string>;
  clusterFamilyKeys: Set<string>;
  planClusterKeys: Set<string>;
  semanticLeadKeys: Set<string>;
  notes: string[];
  rotationSeed: number;
  recentCount: number;
};

export type RecentOutputCollision = {
  score: number;
  reasons: string[];
  matchedEntry: RecentOutputSignatureEntry;
};

export type RecentOutputHardBlock = {
  level: "exact" | "family" | "plan" | "semantic" | "approximate";
  reasons: string[];
  matchedEntry: RecentOutputSignatureEntry;
  matchedClusterKey: string;
};

const CLUSTER_NOISE_PREFIXES = [
  "很多时候",
  "真正",
  "其实",
  "看上去",
  "表面",
  "表面上",
  "原本以为",
  "大家最开始看到的",
  "你会不会也有这种时候",
  "你有没有发现",
  "当",
  "如果",
  "要是",
  "一旦",
  "只要",
  "有些",
  "有时候",
  "明明知道",
  "明明",
  "外面看起来",
  "前一秒",
  "后一秒",
  "房间里",
  "桌边",
  "桌上",
  "门口",
  "窗外"
] as const;

const CLUSTER_NOISE_TOKENS = [
  "这个",
  "一种",
  "一些",
  "已经",
  "开始",
  "真正",
  "其实",
  "很多",
  "时候",
  "看起来",
  "表面",
  "里面",
  "后面",
  "前面",
  "一下",
  "一点",
  "一个",
  "不是",
  "只是",
  "然后",
  "于是",
  "反而",
  "偏偏"
] as const;

function normalizeText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s“"']+/, "")
    .replace(/[\s”"']+$/, "");
}

function normalizeShapeText(content: string) {
  return normalizeText(content).replace(/[“”"'.。！？!?，,；;、]/g, "");
}

function stripClusterNoise(content: string) {
  let text = normalizeShapeText(content);

  for (const prefix of CLUSTER_NOISE_PREFIXES) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }

  for (const token of CLUSTER_NOISE_TOKENS) {
    text = text.replaceAll(token, "");
  }

  return text;
}

function buildSemanticHead(content: string) {
  return normalizeShapeText(content).slice(0, 28);
}

function buildSemanticLeadKey(content: string, themeClusterKey?: string) {
  const stripped = stripClusterNoise(content).slice(0, 18);
  const scopedTheme = themeClusterKey ?? buildThemeClusterKey(content);
  return `${scopedTheme}|${stripped || buildSemanticHead(content).slice(0, 18) || "empty"}`;
}

function buildSemanticNgrams(content: string) {
  const text = normalizeShapeText(content).slice(0, 96);
  const grams = new Set<string>();

  for (const size of [2, 3, 4]) {
    for (let index = 0; index <= text.length - size; index += 1) {
      const gram = text.slice(index, index + size);
      if (gram.length < size) continue;
      if (CLUSTER_NOISE_TOKENS.some((token) => gram === token)) continue;
      grams.add(gram);
    }
  }

  return Array.from(grams).slice(0, 48);
}

function buildThemeClusterKey(content: string) {
  const text = stripClusterNoise(content).slice(0, 72);
  if (!text) {
    return "empty";
  }

  const scores = new Map<string, number>();

  for (const size of [2, 3, 4]) {
    for (let index = 0; index <= text.length - size; index += 1) {
      const token = text.slice(index, index + size);
      if (token.length < size) continue;
      if (CLUSTER_NOISE_TOKENS.some((noise) => token.includes(noise))) continue;
      const weight = size === 4 ? 2.2 : size === 3 ? 1.7 : 1;
      scores.set(token, (scores.get(token) ?? 0) + weight);
    }
  }

  const ranked = [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([token]) => token)
    .filter((token, index, list) => {
      if (index === 0) return true;
      return !list.slice(0, index).some((seen) => seen.includes(token) || token.includes(seen));
    })
    .slice(0, 4);

  return ranked.length > 0 ? ranked.join("|") : text.slice(0, 18);
}

function getSentenceStructureKey(content: string) {
  const text = normalizeShapeText(content);

  if (!text) return "empty";
  if (/[？?]/.test(content) || /^(为什么|如果|要是|是不是|难道|怎么|会不会|你有没有|你会不会)/.test(text)) {
    return "question";
  }
  if (/^(表面上|看起来|明明|越是|其实|虽然|可偏偏|偏偏|反而|却|外面看起来)/.test(text)) {
    return "contrast";
  }
  if (/^(镜头|灯光|门口|桌上|窗外|房间|现场|清晨|凌晨|夜里|那一秒|此刻|房间里|桌边|外头)/.test(text)) {
    return "scene";
  }
  if (/^(胸口|心里|心头|呼吸|一想到|提到|想到|说不清|有些压迫|那种|我知道|我总觉得)/.test(text)) {
    return "emotion";
  }
  if (/^(真正|很多时候|其实|有些|一旦|面对|时间|拖延|大多数|最难|最像|最不像)/.test(text)) {
    return "statement";
  }

  return `lead:${text.slice(0, 8)}`;
}

function getSentenceFormulaKey(content: string) {
  const text = normalizeShapeText(content);

  if (!text) return "empty";
  if (/^镜头[^，。！？]{0,8}落到/.test(text) || /^一开始就把/.test(text) || /^先露出来的不是/.test(text)) {
    return "scene:frame";
  }
  if (/^(桌上|门口|窗外|房间里|台灯|桌边|角落里|光线|灯光|空气里|影子|手里)/.test(text)) {
    return "scene:detail";
  }
  if (/^(提到|想到|一想到|胸口|心里|呼吸|说不清|有些压迫|那种|我知道|我总觉得)/.test(text)) {
    return "emotion:inner";
  }
  if (/^(为什么|如果|要是|是不是|难道|怎么|会不会|你有没有|你会不会)/.test(text)) {
    return "question:direct";
  }
  if (/^(真正|很多时候|其实|有些|一旦|面对|时间|拖延|大多数|最难|最像|最不像)/.test(text)) {
    return "statement:lead";
  }
  if (/^(表面上|看起来|明明|越是|其实|虽然|可偏偏|偏偏|反而|却|外面看起来)/.test(text)) {
    return "contrast:lead";
  }

  return `formula:${text.slice(0, 6)}`;
}

export function normalizeOpeningOutput(text: string) {
  return normalizeText(text);
}

export function buildOpeningOutputSignature(input: {
  strategyType: OpeningStrategyType;
  content: string;
  openingStrategy?: string;
  expressionMode?: string;
}): OpeningOutputSignature {
  const normalizedContent = normalizeText(input.content);
  const structureKey = getSentenceStructureKey(normalizedContent);
  const formulaKey = getSentenceFormulaKey(normalizedContent);
  const leadSignature = normalizedContent.slice(0, 12);
  const semanticHead = buildSemanticHead(normalizedContent);
  const themeClusterKey = buildThemeClusterKey(normalizedContent);
  const semanticLeadKey = buildSemanticLeadKey(normalizedContent, themeClusterKey);
  const semanticNgrams = buildSemanticNgrams(normalizedContent);
  const planFingerprint = [
    input.strategyType,
    input.openingStrategy ?? "",
    input.expressionMode ?? "",
    structureKey,
    formulaKey
  ].join("|");
  const clusterFamilyKey = [
    input.strategyType,
    themeClusterKey,
    structureKey,
    formulaKey
  ].join("|");
  const planClusterKey = [themeClusterKey, planFingerprint].join("|");

  return {
    strategyType: input.strategyType,
    normalizedContent,
    structureKey,
    formulaKey,
    leadSignature,
    semanticHead,
    themeClusterKey,
    planFingerprint,
    clusterFamilyKey,
    planClusterKey,
    semanticLeadKey,
    semanticNgrams,
    fingerprint: `${input.strategyType}|${structureKey}|${formulaKey}|${semanticHead.slice(0, 20)}|${themeClusterKey}`
  };
}

function hashText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33 + text.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash);
}

function encodeNoteField(value: string) {
  return value.replaceAll("|", "¦");
}

export function buildRecentOutputSignatureMemory(
  history: GenerationHistoryEntry[],
  options?: { noteLimit?: number; candidateLimit?: number }
): RecentOutputSignatureMemory {
  const noteLimit = options?.noteLimit ?? 8;
  const candidateLimit = options?.candidateLimit ?? 20;

  const notes: string[] = [];
  const entries: RecentOutputSignatureEntry[] = [];

  const recentCandidates = history
    .flatMap((entry) =>
      entry.candidates.map((candidate) => ({
        generationRequestId: entry.id,
        strategyType: candidate.strategyType as OpeningStrategyType,
        text: candidate.text,
        openingStrategy: candidate.openingStrategy,
        styleLabel: candidate.styleLabel
      }))
    )
    .slice(0, candidateLimit);

  for (const candidate of recentCandidates) {
    const signature = buildOpeningOutputSignature({
      strategyType: candidate.strategyType,
      content: candidate.text,
      openingStrategy: candidate.openingStrategy
    });

    entries.push({
      ...signature,
      preview: signature.normalizedContent.slice(0, 24)
    });

    if (notes.length < noteLimit) {
      const preview = signature.normalizedContent.slice(0, 42);
      notes.push(
        [
          signature.strategyType,
          signature.structureKey,
          signature.formulaKey,
          signature.semanticHead.slice(0, 16),
          signature.themeClusterKey.slice(0, 24),
          encodeNoteField(signature.clusterFamilyKey),
          encodeNoteField(signature.planClusterKey),
          preview
        ].join(" | ")
      );
    }
  }

  return buildRecentOutputSignatureMemoryFromEntries(entries, {
    notes,
    recentCount: recentCandidates.length
  });
}

export function buildRecentOutputSignatureMemoryFromEntries(
  entries: RecentOutputSignatureEntry[],
  options?: { notes?: string[]; recentCount?: number }
) {
  const fingerprints = new Set(entries.map((entry) => entry.fingerprint));
  const normalizedContents = new Set(entries.map((entry) => entry.normalizedContent));
  const structureKeys = new Set(entries.map((entry) => entry.structureKey));
  const formulaKeys = new Set(entries.map((entry) => entry.formulaKey));
  const leadSignatures = new Set(entries.map((entry) => entry.leadSignature));
  const semanticHeads = new Set(entries.map((entry) => entry.semanticHead));
  const themeClusterKeys = new Set(entries.map((entry) => entry.themeClusterKey));
  const planFingerprints = new Set(entries.map((entry) => entry.planFingerprint));
  const clusterFamilyKeys = new Set(entries.map((entry) => entry.clusterFamilyKey));
  const planClusterKeys = new Set(entries.map((entry) => entry.planClusterKey));
  const semanticLeadKeys = new Set(entries.map((entry) => entry.semanticLeadKey));

  const rotationSeed = hashText(
    [
      ...fingerprints,
      ...normalizedContents,
      ...structureKeys,
      ...formulaKeys,
      ...leadSignatures,
      ...semanticHeads,
      ...themeClusterKeys,
      ...planFingerprints,
      ...clusterFamilyKeys,
      ...planClusterKeys,
      ...semanticLeadKeys
    ].join("|")
  ) % 997;

  return {
    entries,
    fingerprints,
    normalizedContents,
    structureKeys,
    formulaKeys,
    leadSignatures,
    semanticHeads,
    themeClusterKeys,
    planFingerprints,
    clusterFamilyKeys,
    planClusterKeys,
    semanticLeadKeys,
    notes: options?.notes ?? [],
    rotationSeed,
    recentCount: options?.recentCount ?? entries.length
  };
}

function computePrefixSimilarity(left: string, right: string) {
  const maxLength = Math.min(left.length, right.length);
  if (maxLength === 0) {
    return 0;
  }

  let matched = 0;
  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    matched += 1;
  }

  return matched / maxLength;
}

function computeJaccardSimilarity(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;

  for (const item of leftSet) {
    if (rightSet.has(item)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function computeLongestSharedSpan(left: string, right: string) {
  const a = normalizeShapeText(left).slice(0, 120);
  const b = normalizeShapeText(right).slice(0, 120);
  let longest = 0;

  for (let index = 0; index < a.length; index += 1) {
    for (let other = 0; other < b.length; other += 1) {
      let span = 0;
      while (a[index + span] && a[index + span] === b[other + span]) {
        span += 1;
      }
      if (span > longest) {
        longest = span;
      }
    }
  }

  return longest;
}

export function detectRecentOutputCollisions(
  signature: OpeningOutputSignature,
  memory: RecentOutputSignatureMemory | null | undefined
) {
  if (!memory || memory.entries.length === 0) {
    return [] as RecentOutputCollision[];
  }

  const collisions: RecentOutputCollision[] = [];

  for (const entry of memory.entries) {
    const reasons: string[] = [];
    let score = 0;

    if (entry.normalizedContent === signature.normalizedContent) {
      collisions.push({
        score: 1,
        reasons: ["最近输出正文重复"],
        matchedEntry: entry
      });
      continue;
    }

    if (entry.fingerprint === signature.fingerprint) {
      score = Math.max(score, 0.98);
      reasons.push(`最近签名重复：${signature.fingerprint}`);
    }

    if (entry.semanticHead === signature.semanticHead) {
      score = Math.max(score, 0.94);
      reasons.push("句首语义签名重复");
    }

    if (entry.themeClusterKey === signature.themeClusterKey) {
      score = Math.max(score, 0.9);
      reasons.push(`主题簇重复：${signature.themeClusterKey}`);
    }

    if (entry.planFingerprint === signature.planFingerprint && entry.themeClusterKey === signature.themeClusterKey) {
      score = Math.max(score, 0.93);
      reasons.push("同一策略骨架回到了最近簇");
    }

    const prefixSimilarity = computePrefixSimilarity(entry.semanticHead, signature.semanticHead);
    if (prefixSimilarity >= 0.8) {
      score = Math.max(score, 0.88);
      reasons.push(`句首前缀过近：${Math.round(prefixSimilarity * 100)}%`);
    }

    const ngramSimilarity = computeJaccardSimilarity(entry.semanticNgrams, signature.semanticNgrams);
    if (ngramSimilarity >= 0.78) {
      score = Math.max(score, 0.9);
      reasons.push(`正文近似语义重复：${Math.round(ngramSimilarity * 100)}%`);
    } else if (
      ngramSimilarity >= 0.68 &&
      entry.structureKey === signature.structureKey &&
      entry.formulaKey === signature.formulaKey
    ) {
      score = Math.max(score, 0.84);
      reasons.push(`结构和正文相似度过高：${Math.round(ngramSimilarity * 100)}%`);
    }

    const longestSharedSpan = computeLongestSharedSpan(entry.normalizedContent, signature.normalizedContent);
    if (longestSharedSpan >= 20) {
      score = Math.max(score, 0.91);
      reasons.push(`正文共享长片段：${longestSharedSpan}字`);
    } else if (
      longestSharedSpan >= 16 &&
      entry.strategyType === signature.strategyType &&
      prefixSimilarity >= 0.35
    ) {
      score = Math.max(score, 0.85);
      reasons.push(`同策略共享片段过长：${longestSharedSpan}字`);
    }

    if (
      entry.structureKey === signature.structureKey &&
      entry.formulaKey === signature.formulaKey &&
      prefixSimilarity >= 0.65
    ) {
      score = Math.max(score, 0.86);
      reasons.push(`结构公式重复：${signature.structureKey} / ${signature.formulaKey}`);
    }

    if (score >= 0.82) {
      collisions.push({
        score,
        reasons: Array.from(new Set(reasons)),
        matchedEntry: entry
      });
    }
  }

  return collisions.sort((left, right) => right.score - left.score);
}

export function detectRecentOutputHardBlocks(
  signature: OpeningOutputSignature,
  memory: RecentOutputSignatureMemory | null | undefined
) {
  if (!memory || memory.entries.length === 0) {
    return [] as RecentOutputHardBlock[];
  }

  const blocks: RecentOutputHardBlock[] = [];

  if (memory.normalizedContents.has(signature.normalizedContent)) {
    const matchedEntry =
      memory.entries.find((entry) => entry.normalizedContent === signature.normalizedContent) ??
      memory.entries[0];

    if (matchedEntry) {
      blocks.push({
        level: "exact",
        reasons: ["最近输出正文重复"],
        matchedEntry,
        matchedClusterKey: signature.normalizedContent
      });
    }
  }

  if (memory.fingerprints.has(signature.fingerprint)) {
    const matchedEntry =
      memory.entries.find((entry) => entry.fingerprint === signature.fingerprint) ?? memory.entries[0];

    if (matchedEntry) {
      blocks.push({
        level: "exact",
        reasons: [`最近签名重复：${signature.fingerprint}`],
        matchedEntry,
        matchedClusterKey: signature.fingerprint
      });
    }
  }

  if (memory.clusterFamilyKeys.has(signature.clusterFamilyKey)) {
    const matchedEntry =
      memory.entries.find((entry) => entry.clusterFamilyKey === signature.clusterFamilyKey) ?? memory.entries[0];

    if (matchedEntry) {
      blocks.push({
        level: "family",
        reasons: [`最近候选簇已禁用：${signature.clusterFamilyKey}`],
        matchedEntry,
        matchedClusterKey: signature.clusterFamilyKey
      });
    }
  }

  if (memory.planClusterKeys.has(signature.planClusterKey)) {
    const matchedEntry =
      memory.entries.find((entry) => entry.planClusterKey === signature.planClusterKey) ?? memory.entries[0];

    if (matchedEntry) {
      blocks.push({
        level: "plan",
        reasons: ["最近策略骨架已进入黑名单"],
        matchedEntry,
        matchedClusterKey: signature.planClusterKey
      });
    }
  }

  if (memory.semanticLeadKeys.has(signature.semanticLeadKey)) {
    const matchedEntry =
      memory.entries.find((entry) => entry.semanticLeadKey === signature.semanticLeadKey) ?? memory.entries[0];

    if (matchedEntry) {
      blocks.push({
        level: "semantic",
        reasons: ["最近句首语义入口重复"],
        matchedEntry,
        matchedClusterKey: signature.semanticLeadKey
      });
    }
  }

  for (const entry of memory.entries) {
    const reasons: string[] = [];
    const prefixSimilarity = computePrefixSimilarity(entry.semanticHead, signature.semanticHead);
    const ngramSimilarity = computeJaccardSimilarity(entry.semanticNgrams, signature.semanticNgrams);
    const longestSharedSpan = computeLongestSharedSpan(entry.normalizedContent, signature.normalizedContent);

    if (
      entry.themeClusterKey === signature.themeClusterKey &&
      entry.strategyType === signature.strategyType &&
      prefixSimilarity >= 0.48 &&
      ngramSimilarity >= 0.46
    ) {
      reasons.push("同主题同策略候选仍然贴着最近旧簇");
    }

    if (entry.themeClusterKey === signature.themeClusterKey && longestSharedSpan >= 14) {
      reasons.push(`同主题共享长片段：${longestSharedSpan}字`);
    } else if (longestSharedSpan >= 18) {
      reasons.push(`正文共享长片段：${longestSharedSpan}字`);
    }

    if (entry.themeClusterKey === signature.themeClusterKey && prefixSimilarity >= 0.58 && ngramSimilarity >= 0.5) {
      reasons.push(`同主题语义展开过近：${Math.round(ngramSimilarity * 100)}%`);
    }

    if (reasons.length > 0) {
      blocks.push({
        level: "approximate",
        reasons,
        matchedEntry: entry,
        matchedClusterKey: entry.clusterFamilyKey
      });
    }
  }

  const priority: Record<RecentOutputHardBlock["level"], number> = {
    exact: 5,
    family: 4,
    plan: 3,
    semantic: 2,
    approximate: 1
  };

  return blocks
    .sort((left, right) => {
      const priorityDiff = priority[right.level] - priority[left.level];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return left.matchedClusterKey.localeCompare(right.matchedClusterKey);
    })
    .filter((block, index, list) => {
      return list.findIndex(
        (candidate) =>
          candidate.level === block.level &&
          candidate.matchedClusterKey === block.matchedClusterKey &&
          candidate.matchedEntry.preview === block.matchedEntry.preview
      ) === index;
    });
}

export function buildRecentOutputHardBlockReasons(
  signature: OpeningOutputSignature,
  memory: RecentOutputSignatureMemory | null | undefined
) {
  return detectRecentOutputHardBlocks(signature, memory)
    .slice(0, 3)
    .flatMap((block) => block.reasons);
}

export function buildRecentOutputCollisionReasons(
  signature: OpeningOutputSignature,
  memory: RecentOutputSignatureMemory | null | undefined
) {
  const hardReasons = buildRecentOutputHardBlockReasons(signature, memory);
  if (hardReasons.length > 0) {
    return hardReasons;
  }

  return detectRecentOutputCollisions(signature, memory)
    .slice(0, 2)
    .flatMap((collision) => collision.reasons);
}
