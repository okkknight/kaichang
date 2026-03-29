import { analyzeInput } from "@/server/opening/analyze-input";
import { BusinessError } from "@/server/errors";
import { logError, logInfo, logWarn, summarizeError, truncateForLog } from "@/server/logger";
import {
  createGenerationRequest,
  createOpeningCandidates,
  createUsageRecord,
  getUsageCountForGuest,
  listRecentGenerationHistory,
  listRecentCopyEventsForGuest,
  listRecentFeedbackEventsForGuest,
  todayKey,
  updateOpeningCandidateEvaluations,
  updateGenerationRequest
} from "@/server/db/generation-repo";
import { getDefaultLlmProvider } from "@/server/llm/provider";
import type {
  GeneratedOpeningCandidate,
  GenerateOpeningsInput,
  EvaluationState,
  GenerationState,
  GenerateOpeningsResponse,
  OpeningBatchRepairSlot,
  OpeningBatchSlot,
  OpeningQualityEvaluation,
  OpeningStrategyPlan,
  OpeningStrategyType
} from "@/server/opening/types";
import {
  buildOpeningBatchPrompt,
  buildOpeningBatchRepairPrompt,
  buildOpeningCompressionPrompt,
  buildMinimalOpeningBatchPrompt,
  buildOpeningPrompt
} from "@/server/opening/prompt-builder";
import { chooseOpeningStrategies } from "@/server/opening/strategy-engine";
import { analyzeSentenceShape, rankCandidates } from "@/server/opening/rank-candidates";
import {
  buildOpeningOutputSignature,
  detectRecentOutputCollisions,
  detectRecentOutputHardBlocks,
  buildRecentOutputCollisionReasons,
  buildRecentOutputHardBlockReasons,
  buildRecentOutputSignatureMemory,
  type RecentOutputSignatureMemory
} from "@/server/opening/output-signatures";
import {
  buildOpeningTopicFrame,
  detectSourceEchoTrace,
  detectTemplateTrace,
  buildRuleBasedOpeningEvaluation
} from "@/server/opening/opening-quality";
import {
  createNeutralEvaluation,
  evaluateOpeningCandidates
} from "@/server/opening/llm-quality-evaluator";
import {
  analyzeFeedbackPreference,
  type FeedbackSignalType,
  type FeedbackPreferenceSignal
} from "@/server/opening/feedback-preference";
import { loadPreferenceProfileForGuest } from "@/server/opening/preference-learning";

const DEFAULT_CANDIDATE_COUNT = 4;
const MIN_INPUT_LENGTH = 20;
const MAX_INPUT_LENGTH = 2000;
const SOFT_OPENING_TARGET_MIN = 100;
const SOFT_OPENING_TARGET_MAX = 200;
const MAX_GENERATION_TOKENS = 1024;
const MAX_COMPRESSION_TOKENS = 256;
const MODEL_CALL_RETRIES = 1;
const RECENT_GENERATION_HISTORY_LIMIT = 15;
const RECENT_SIGNATURE_CANDIDATE_LIMIT = 60;
const PROMPT_ECHO_PATTERNS = [
  "输入：",
  "题目：",
  "原始输入：",
  "输入分析：",
  "候选计划：",
  "需要修复的候选：",
  "输出要求：",
  "修复要求：",
  "请根据以下信息",
  "请根据以下信息一次性生成全部开头候选",
  "请直接给出",
  "请直接写出",
  "不同的中文开头",
  "候选之间",
  "用户想要",
  "让我构思",
  "我来",
  "需要：",
  "策略：",
  "候选序号：",
  "候选清单",
  "分析："
];

const TASK_RESTATEMENT_PATTERNS = [
  /用户(?:想|想要|要|要求)(?:我)?写/u,
  /用户(?:想|想要|要|要求).*(?:开头|故事|文章|内容)/u,
  /我(?:需要|想要|要)从/u,
  /让我从/u,
  /^让我尝试/u,
  /^让我(?:想|写|先|试)/u,
  /^可以尝试/u,
  /^我会选择/u,
  /^草稿[:：]/u,
  /^这次要避免/u,
  /^之前的开头/u,
  /^试试这个[:：]?/u,
  /^试着从/u,
  /^从[^。！？\n]{0,24}入手[:：]/u,
  /可以从.+入手/u,
  /让读者(?:感受到|看到|知道)?/u,
  /场景构思[:：]/u,
  /需要避免的已有开头模式[:：]/u,
  /整体气质/u,
  /这条候选请/u,
  /第一句话要/u,
  /^主题是[:：]/u,
  /风格(?:是|为)["“”「」]*/u,
  /要求[:：]/u,
  /关键要点[:：]/u,
  /写完一个完整开头就停/u,
  /不要(?:分析|总结|解释|标题|序号|前言|结尾)/u,
  /只输出正文/u,
  /问题要短准/u,
  /紧扣主题/u,
  /前面已经写过/u,
  /用户之前已经/u,
  /用户说/u,
  /骨架/u,
  /(?:策略|表达方式|入口方向|入口提示|候选序号|长度要求)[:：]/u,
  /\b(?:detail_focus|motion_focus|sensory_focus|object_focus|atmosphere_focus|body_signal|inner_voice|memory_trigger|quiet_scene|pressure_wave|direct_question|self_question|rhetorical_question|scenario_question|double_question|judgment|observation|paradox|rule_of_thumb|turning_point|appearance_vs_truth|before_after|expectation_gap|small_twist|parallel_split)\b/i
];

const LENGTH_WEAKNESS_MARKERS = ["长度偏短", "长度略短", "句子较少"];

function countPromptEchoHits(text: string) {
  return PROMPT_ECHO_PATTERNS.reduce((total, pattern) => total + (text.includes(pattern) ? 1 : 0), 0);
}

function countTaskRestatementHits(text: string) {
  return TASK_RESTATEMENT_PATTERNS.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

function isPromptEchoLike(text: string, rawInput: string) {
  const normalized = normalizeOpeningText(text);
  if (!normalized) {
    return false;
  }

  const markerHits = countPromptEchoHits(normalized);
  const instructionHits = [
    "风格偏好：",
    "入口方向：",
    "入口提示：",
    "长度要求：",
    "只写正文",
    "不要分析",
    "不要总结",
    "不要复述用户要求",
    "用户需要我写",
    "用户想要"
  ].filter((pattern) => normalized.includes(pattern)).length;
  const taskRestatementHits = countTaskRestatementHits(normalized);
  const bulletLike = (normalized.match(/(?:^|\s)-\s*/g) ?? []).length;
  const rawInputEcho = rawInput && normalized.includes(normalizeOpeningText(rawInput));
  const startsLikeTaskRestatement =
    /^(?:用户|我)(?:想|想要|要|需要|要求)/u.test(normalized) ||
    /^(?:可以从|让我从)/u.test(normalized);

  return (
    markerHits >= 1 ||
    instructionHits >= 2 ||
    taskRestatementHits >= 1 ||
    bulletLike >= 2 ||
    startsLikeTaskRestatement ||
    (rawInputEcho && (instructionHits >= 1 || taskRestatementHits >= 1))
  );
}

function getDailyGuestLimit() {
  const rawLimit = process.env.KAICHANG_DAILY_GUEST_LIMIT?.trim();
  const parsedLimit = rawLimit ? Number(rawLimit) : Number.NaN;

  if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
    return Math.floor(parsedLimit);
  }

  return 30000;
}

const DAILY_GUEST_LIMIT = getDailyGuestLimit();

function clampCandidateCount(value: number) {
  return Math.min(5, Math.max(3, value || DEFAULT_CANDIDATE_COUNT));
}

function getTopicAnchor(analysis: ReturnType<typeof analyzeInput>) {
  const rawAnchor = analysis.rawInput.split(/[，。！？；;]/)[0]?.trim();
  return rawAnchor || analysis.rawInput || "这个题目";
}

function hashText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33 + text.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash);
}

function buildRequestFreshnessSeed(
  generationRequestId: string,
  rawInput: string,
  recentMemory: RecentOutputSignatureMemory | null
) {
  const base = [
    generationRequestId,
    rawInput,
    recentMemory?.rotationSeed ?? 0,
    recentMemory?.recentCount ?? 0
  ].join("|");

  return hashText(base) % 997;
}

function normalizeOpeningText(text: string) {
  return text
    .replace(/\r?\n+/g, " ")
    .replace(/^[-*]\s*/gm, "")
    .replace(/^\s*\d+[\.\)]\s*/gm, "")
    .replace(/^\s*["“”]/, "")
    .replace(/["“”]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimOpeningToLength(text: string) {
  return normalizeOpeningText(text);
}

function findRepeatedFragment(content: string) {
  const condensed = normalizeOpeningText(content).replace(/[，。！？!?；;、\s]/g, "");
  if (condensed.length < 16) {
    return null;
  }

  for (let size = 6; size <= 16; size += 1) {
    for (let index = 0; index <= condensed.length - size * 2; index += 1) {
      const fragment = condensed.slice(index, index + size);
      const next = condensed.slice(index + size, index + size * 2);
      if (fragment.length >= 6 && fragment === next) {
        return fragment;
      }
    }
  }

  return null;
}

function buildCandidatePlans(strategies: OpeningStrategyPlan[], preferredStyles: string[]) {
  return strategies.map((strategy, index) => ({
    strategyType: strategy.strategyType,
    label: strategy.label,
    reason: strategy.reason,
    openingStrategy: strategy.label,
    styleLabel: preferredStyles[index % Math.max(1, preferredStyles.length)] || strategy.label,
    angle: strategy.angle,
    lengthHint: strategy.lengthHint,
    expressionMode: strategy.expressionMode,
    entryAngle: strategy.entryAngle
  }));
}

type CandidatePlanLike = OpeningBatchSlot & {
  label?: string;
  reason?: string;
};

function buildCandidatePlanSignature(
  plan: CandidatePlanLike,
  content: string
) {
  return buildOpeningOutputSignature({
    strategyType: plan.strategyType,
    openingStrategy: plan.openingStrategy,
    expressionMode: plan.expressionMode,
    content
  });
}

function isValidOpeningContent(content: string, rawInput = "") {
  return getValidationReason(content, rawInput) === null;
}

function shouldCompressOpening(content: string) {
  const normalized = normalizeOpeningText(content);
  return normalized.length > SOFT_OPENING_TARGET_MAX;
}

async function compressOpeningContent(input: {
  provider: ReturnType<typeof getDefaultLlmProvider>;
  rawInput: string;
  styleOptions: string[];
  plan: CandidatePlanLike;
  candidateIndex: number;
  content: string;
  traceId: string;
  requestId: string;
  seenContents: string[];
}) {
  const original = normalizeOpeningText(input.content);
  if (!shouldCompressOpening(original)) {
    return { content: original, compressed: false, reason: "within_soft_limit" };
  }

  const prompt = buildOpeningCompressionPrompt({
    rawInput: input.rawInput,
    originalContent: original,
    strategy: {
      strategyType: input.plan.strategyType,
      label: input.plan.openingStrategy,
      reason: input.plan.angle,
      angle: input.plan.angle,
      lengthHint: input.plan.lengthHint,
      expressionMode: input.plan.expressionMode,
      entryAngle: input.plan.entryAngle
    },
    styleOptions: input.styleOptions,
    candidateIndex: input.candidateIndex
  });

  try {
    const result = await input.provider.generateText({
      system: prompt.system,
      user: prompt.user,
      temperature: input.provider.llmMode === "mock" ? 0.55 : 0.45,
      maxTokens: MAX_COMPRESSION_TOKENS
    });

    const compressed = normalizeOpeningText(result.text);
    const compressedReason = getMinimalOpeningValidationReason(compressed, input.rawInput);
    if (compressedReason) {
      logWarn("generate-openings", "compression rewrite invalid, keeping original", {
        traceId: input.traceId,
        requestId: input.requestId,
        index: input.candidateIndex + 1,
        reason: compressedReason,
        rawPreview: truncateForLog(result.text, 160)
      });
      return { content: original, compressed: false, reason: compressedReason };
    }

    if (compressed.length > SOFT_OPENING_TARGET_MAX) {
      logWarn("generate-openings", "compression rewrite still over target, keeping original", {
        traceId: input.traceId,
        requestId: input.requestId,
        index: input.candidateIndex + 1,
        originalLength: original.length,
        compressedLength: compressed.length
      });
      return {
        content: original,
        compressed: false,
        reason: `压缩后仍偏长(${compressed.length})`
      };
    }

    if (isDuplicateOpening(compressed, input.seenContents)) {
      logWarn("generate-openings", "compression rewrite duplicated previous opening, keeping original", {
        traceId: input.traceId,
        requestId: input.requestId,
        index: input.candidateIndex + 1,
        compressedLength: compressed.length
      });
      return { content: original, compressed: false, reason: "压缩后重复" };
    }

    logInfo("generate-openings", "candidate compression rewrite applied", {
      traceId: input.traceId,
      requestId: input.requestId,
      index: input.candidateIndex + 1,
      originalLength: original.length,
      compressedLength: compressed.length
    });

    return { content: compressed, compressed: true, reason: null };
  } catch (error) {
    logWarn("generate-openings", "compression rewrite failed, keeping original", {
      traceId: input.traceId,
      requestId: input.requestId,
      index: input.candidateIndex + 1,
      error: summarizeError(error)
    });
    return { content: original, compressed: false, reason: summarizeError(error).message };
  }
}

function getValidationReason(content: string, rawInput: string) {
  const text = normalizeOpeningText(content);
  if (!text) return "空白内容";
  const repeatedFragment = findRepeatedFragment(text);
  if (repeatedFragment) return `重复展开：${repeatedFragment}`;
  return null;
}

function validateBatchContents(contents: string[], plans: CandidatePlanLike[], rawInput: string) {
  const invalidItems: OpeningBatchRepairSlot[] = [];
  const validContents: string[] = [];

  contents.forEach((content, index) => {
    const reason = getValidationReason(content, rawInput);
    const normalized = normalizeOpeningText(content);

    if (reason) {
      invalidItems.push({
        strategyType: plans[index]?.strategyType ?? "statement",
        openingStrategy: plans[index]?.openingStrategy ?? `候选${index + 1}`,
        styleLabel: plans[index]?.styleLabel ?? plans[index]?.openingStrategy ?? `候选${index + 1}`,
        angle: plans[index]?.angle ?? "",
        lengthHint: plans[index]?.lengthHint ?? "",
        expressionMode: plans[index]?.expressionMode ?? "observation",
        entryAngle:
          plans[index]?.entryAngle ?? {
            id: "fallback-repair",
            label: "恢复修复",
            description: "对需要修复的候选进行最小补修。",
            mustPreserve: ["题面", "风格"],
            shouldAvoid: ["模板回填", "泛化改写"],
            strategyType: plans[index]?.strategyType ?? "statement",
            expressionMode: plans[index]?.expressionMode ?? "observation",
            lengthHint: plans[index]?.lengthHint ?? "2-4句"
          },
        reason,
        previousOutput: normalized
      });
      return;
    }

    validContents.push(normalized);
  });

  return { invalidItems, validContents };
}

function summarizeSentenceDiversity(contents: string[]) {
  const shapes = contents.map((content) => analyzeSentenceShape(content));
  return {
    shapes,
    uniqueStructureCount: new Set(shapes.map((shape) => shape.structureKey)).size,
    uniqueFormulaCount: new Set(shapes.map((shape) => shape.formulaKey)).size
  };
}

type DiversityRepairTarget = {
  index: number;
  slot: OpeningBatchRepairSlot;
};

function collectDiversityRepairTargets(
  contents: string[],
  candidatePlans: ReturnType<typeof buildCandidatePlans>,
  rawInput: string,
  recentMemory?: RecentOutputSignatureMemory | null
) {
  const summary = summarizeSentenceDiversity(contents);
  const seenNormalized = new Map<string, number>();
  const seenStructure = new Map<string, number>();
  const seenFormula = new Map<string, number>();
  const seenLead = new Map<string, number>();
  const targets: DiversityRepairTarget[] = [];

  contents.forEach((content, index) => {
    const normalized = normalizeOpeningText(content);
    const shape = analyzeSentenceShape(normalized);
    const signature = buildOpeningOutputSignature({
      strategyType: candidatePlans[index]?.strategyType ?? "statement",
      openingStrategy: candidatePlans[index]?.openingStrategy,
      expressionMode: candidatePlans[index]?.expressionMode,
      content: normalized
    });
    const templateTrace = detectTemplateTrace(normalized);
    const sourceEchoTrace = detectSourceEchoTrace(normalized, rawInput);
    const duplicateReasons: string[] = [];

    const normalizedSeenAt = seenNormalized.get(normalized);
    if (normalizedSeenAt !== undefined) {
      duplicateReasons.push(`与候选${normalizedSeenAt + 1}完全重复`);
    }

    const structureSeenAt = seenStructure.get(shape.structureKey);
    if (summary.uniqueStructureCount < 3 && structureSeenAt !== undefined) {
      duplicateReasons.push(`句式结构与候选${structureSeenAt + 1}重复`);
    }

    const formulaSeenAt = seenFormula.get(shape.formulaKey);
    if (summary.uniqueFormulaCount < 3 && formulaSeenAt !== undefined) {
      duplicateReasons.push(`句首公式与候选${formulaSeenAt + 1}重复`);
    }

    if (templateTrace.isTemplateLike) {
      duplicateReasons.push("模板痕迹过强");
    }

    if (sourceEchoTrace.isSourceEchoLike) {
      duplicateReasons.push(`原句回声：${sourceEchoTrace.hits[0]}`);
    }

    const recentCollisionReasons = buildRecentOutputCollisionReasons(signature, recentMemory);
    duplicateReasons.push(...recentCollisionReasons);

    if (duplicateReasons.length > 0) {
      targets.push({
        index,
        slot: {
          ...candidatePlans[index],
          reason: duplicateReasons.join("；"),
          previousOutput: normalized
        }
      });
      return;
    }

    seenNormalized.set(normalized, index);
    seenStructure.set(shape.structureKey, index);
    seenFormula.set(shape.formulaKey, index);
    seenLead.set(shape.leadSignature, index);
  });

  const seenLeadCount = new Set(seenLead.keys()).size;
  return {
    targets,
    summary: {
      ...summary,
      uniqueLeadCount: seenLeadCount
    }
  };
}

function candidateSeed(
  strategyType: OpeningStrategyType,
  openingStrategy: string,
  styleLabel: string,
  content: string,
  qualityScore: number,
  generationRequestId: string,
  rankOrder = 0,
  evaluation: OpeningQualityEvaluation | null = null
): GeneratedOpeningCandidate {
  return {
    id: crypto.randomUUID(),
    generationRequestId,
    rankOrder,
    strategyType,
    openingStrategy,
    styleLabel,
    content,
    qualityScore,
    evaluation,
    isCopied: false,
    isSelected: false
  };
}

type OpeningCandidateResponse = {
  id: string;
  strategyType: OpeningStrategyType;
  openingStrategy: string;
  styleLabel: string;
  content: string;
  qualityScore: number;
  evaluation: OpeningQualityEvaluation | null;
  isCopied: boolean;
  isSelected: boolean;
};

function buildFallbackOpeningText(
  plan: CandidatePlanLike,
  topicAnchor: string,
  analysis: ReturnType<typeof analyzeInput>,
  index: number,
  freshnessSeed = 0,
  recentMemory: RecentOutputSignatureMemory | null = null
) {
  const anchor = topicAnchor || "这个主题";
  const secondaryTone = analysis.preferredStyles[0] || "克制";

  const variants: Record<OpeningStrategyType, Record<string, string[]>> = {
    scene: {
      detail_focus: [
        `桌上那只没收好的杯子还在冒热气，${anchor}就这样安静地摊在眼前，像一张刚被翻开的底牌。`,
        `门口的影子先动了一下，${anchor}的轮廓也跟着在光里微微偏了一点。`
      ],
      motion_focus: [
        `她把手里的东西轻轻放下时，${anchor}已经不再只是一个想法，而是踩在地上的现实。`,
        `他抬眼的那一秒，${anchor}像被人轻轻推了一下，终于从远处走近。`
      ],
      sensory_focus: [
        `灯光有点冷，${anchor}在这种冷里显得格外清楚，连空气都像被切薄了。`,
        `风声刚停，${anchor}就露出了更细的纹路，像终于被人听见。`
      ],
      object_focus: [
        `那扇门、那只表、那杯没喝完的水，都把${anchor}悄悄架了起来，像在等一个人推门而入。`,
        `桌上的那本本子翻到一半，${anchor}正好卡在最容易被忽略的地方。`
      ],
      atmosphere_focus: [
        `房间里静得有点过分，${anchor}就在这种静里慢慢站稳了，像故事刚刚把呼吸调匀。`,
        `空气一紧，${anchor}也跟着变得有了重量，不需要解释就已经先压住了场面。`
      ]
    },
    emotion: {
      body_signal: [
        `胸口先紧了一下，${anchor}才慢慢有了形状，像一种没说出口的感觉正顺着呼吸往下沉。`,
        `手心微微发热的时候，${anchor}已经不是简单的概念，而是会在心里留下回声的东西。`
      ],
      inner_voice: [
        `我知道${anchor}这件事迟早会来，只是每次真的想到它，还是会忍不住停一下。`,
        `说不清为什么，${anchor}一靠近，心里最先安静下来的反而是那些原本很吵的念头。`
      ],
      memory_trigger: [
        `一想到${anchor}，很多已经放过去的细节又会悄悄回来，像原本没关好的抽屉。`,
        `某个瞬间，只要${anchor}被提起，那些以为自己早就忘掉的感受就会重新浮上来。`
      ],
      quiet_scene: [
        `窗外明明没发生什么，${anchor}却还是在这份安静里一点点浮出来，像水面下的暗流。`,
        `桌边的灯没怎么变，${anchor}却突然变得很重，重到让人连沉默都不太敢出声。`
      ],
      pressure_wave: [
        `有些压迫不是一下子砸下来，而是像${anchor}这样，先轻轻碰到你，再慢慢把呼吸带窄。`,
        `那种不太说得出的重量，往往就是${anchor}带来的，来得不响，却很难忽略。`
      ]
    },
    question: {
      direct_question: [
        `你有没有发现，${anchor}每次一出现，事情就会变得比想象里更难解释？`,
        `如果真的站在${anchor}面前，你会先往前一步，还是先退半步？`
      ],
      self_question: [
        `我到底是在等${anchor}出现，还是在等自己终于愿意面对它？`,
        `是不是很多时候，我们不是不想开始，只是还没准备好把${anchor}说出口？`
      ],
      rhetorical_question: [
        `难道${anchor}真的只是表面看到的那样吗？`,
        `为什么${anchor}总能把人原本很笃定的判断一下子打乱？`
      ],
      scenario_question: [
        `要是今天真的轮到${anchor}落到你头上，你会先做哪一步？`,
        `当${anchor}就摆在眼前的时候，真正难的那一秒会是什么样？`
      ],
      double_question: [
        `你会不会也有这种时候：${anchor}明明已经来了，自己却还想再等等？`,
        `明明知道${anchor}不能再拖，为什么还是忍不住往后放？`
      ]
    },
    statement: {
      judgment: [
        `${anchor}一旦真正开始，改变的往往不是表面，而是人看事情的顺序。`,
        `真正麻烦的通常不是${anchor}本身，而是它出现以后，很多原本默认成立的东西都要重新来过。`
      ],
      observation: [
        `很多时候，${anchor}并不会一下子把人推翻，它只是先让一些细小的东西开始变形。`,
        `你越靠近${anchor}，越会发现它不是一个单独的点，而是一连串会跟着变化的东西。`
      ],
      paradox: [
        `最不像问题的${anchor}，往往才是最容易把人卡住的地方。`,
        `有些${anchor}看起来只是轻轻一碰，实际上却会把后面的路全都带偏。`
      ],
      rule_of_thumb: [
        `一旦${anchor}被拖到最后一刻，很多原本还算从容的东西就会开始失去节奏。`,
        `只要${anchor}被推迟，后面就很容易连着失去好几层余地。`
      ],
      turning_point: [
        `${anchor}真正站到面前的时候，故事就已经不是原来的那个故事了。`,
        `从${anchor}那一刻开始，事情往往会往另一个方向慢慢拐过去。`
      ]
    },
    contrast: {
      appearance_vs_truth: [
        `看上去${anchor}只是个普通起点，真正往里走时才会发现，里面的走向早就换了。`,
        `表面那层平静一掀开，${anchor}露出来的就不是原来以为的那一面。`
      ],
      before_after: [
        `刚开始的${anchor}还像一块没被碰过的布，往后走几步，纹理就全变了。`,
        `前一秒还像没事，后一秒${anchor}就把人带进了另一种节奏里。`
      ],
      expectation_gap: [
        `原本以为${anchor}会很平，结果真正靠近才发现它藏着别的东西。`,
        `大家最开始看到的只是${anchor}，没想到真正难的其实还在后面。`
      ],
      small_twist: [
        `${anchor}原来只是一个小口子，可真正进去以后，里面的空气已经完全不一样了。`,
        `看起来只是轻轻一转，${anchor}就把原来的方向悄悄换掉了。`
      ],
      parallel_split: [
        `一边是${anchor}的表面，一边是它暗下去的那部分，两个方向同时存在，却不在同一个节奏里。`,
        `外面看起来很稳，里面却已经偏了，${anchor}就是这样把两种状态放在一起。`
      ]
    }
  };

  const strategyVariants = variants[plan.strategyType] ?? variants.statement;
  const modeOrder = [
    plan.expressionMode,
    ...Object.keys(strategyVariants).filter((mode) => mode !== plan.expressionMode)
  ];
  const candidatePool = modeOrder.flatMap((mode) => strategyVariants[mode] ?? []).filter((item) => item.length > 0);
  const pool = candidatePool.length > 0 ? candidatePool : Object.values(strategyVariants).flat().filter((item) => item.length > 0);
  const startIndex = Math.abs(freshnessSeed + index * 7) % Math.max(1, pool.length);

  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const template = pool[(startIndex + attempt) % pool.length];
    const resolved = normalizeOpeningText(template.replaceAll("${anchor}", anchor).replaceAll("${secondaryTone}", secondaryTone));
    const signature = buildOpeningOutputSignature({
      strategyType: plan.strategyType,
      content: resolved
    });

    if (buildRecentOutputHardBlockReasons(signature, recentMemory).length === 0) {
      return resolved;
    }
  }

  const rescueVariants: Record<OpeningStrategyType, string[]> = {
    scene: [
      `先把注意力落在一个具体动作上，${anchor}就会自己站住。`,
      `先从一个被忽略的角落开始，${anchor}的轮廓会更清楚。`,
      `先让一个小细节出现，${anchor}才不容易散。`,
      `先不急着解释，${anchor}会更像真实发生过的事。`
    ],
    emotion: [
      `先让身体替情绪开口，${anchor}就会更有重量。`,
      `先把那点说不清的感觉放出来，${anchor}才会真的往里走。`,
      `先别急着给答案，${anchor}本身就能撑起气氛。`,
      `先承认心里那点停顿，${anchor}就不只是概念了。`
    ],
    question: [
      `先把问题放到眼前，${anchor}就会跟着变得更具体。`,
      `先不回答，${anchor}本身就足够把人往里推一步。`,
      `先让读者停一下，${anchor}才会真正成立。`,
      `先问清楚卡点在哪，${anchor}就不会只是空泛的疑问。`
    ],
    statement: [
      `先把判断摆出来，${anchor}后面的展开才会更稳。`,
      `先钉住一个看法，${anchor}就不容易散成背景说明。`,
      `先把立场说清，${anchor}就会更像开头而不是分析。`,
      `先落一个明确的判断，${anchor}才有继续往下写的抓手。`
    ],
    contrast: [
      `先把两种状态并排放好，${anchor}的反差感才会更明显。`,
      `先让表面和里面同时出现，${anchor}就不会只剩一句概括。`,
      `先把差别拉开一点，${anchor}才会真正有张力。`,
      `先从对照开始，${anchor}后面的转向会更自然。`
    ]
  };

  const rescuePool = [
    ...(rescueVariants[plan.strategyType] ?? []),
    ...Object.values(rescueVariants).flat()
  ];
  const rescueStartIndex = Math.abs(freshnessSeed + index * 13 + 17) % Math.max(1, rescuePool.length);

  for (let attempt = 0; attempt < rescuePool.length; attempt += 1) {
    const template = rescuePool[(rescueStartIndex + attempt) % rescuePool.length];
    const resolved = normalizeOpeningText(template.replaceAll("${anchor}", anchor).replaceAll("${secondaryTone}", secondaryTone));
    const signature = buildOpeningOutputSignature({
      strategyType: plan.strategyType,
      content: resolved
    });

    if (buildRecentOutputHardBlockReasons(signature, recentMemory).length === 0) {
      return resolved;
    }
  }

  const fallbackTemplate = rescuePool[rescueStartIndex] ?? pool[startIndex] ?? pool[0] ?? `${anchor}先出现了，但还没真正展开。`;
  return normalizeOpeningText(fallbackTemplate.replaceAll("${anchor}", anchor).replaceAll("${secondaryTone}", secondaryTone));
}

function buildReleaseGateFallbackOpening(
  plan: CandidatePlanLike,
  analysis: ReturnType<typeof analyzeInput>,
  candidateIndex: number,
  freshnessSeed = 0,
  recentMemory: RecentOutputSignatureMemory | null = null,
  laneIndex = 0
) {
  const anchor = getTopicAnchor(analysis);
  const variants: Record<OpeningStrategyType, Array<{ lead: string[]; bridge: string[]; close: string[] }>> = {
    scene: [
      {
        lead: ["先被看见的不是道理", "真正先露出来的是一个现场", "别急着判断，先让画面站住"],
        bridge: [
          `${anchor}在一个细节里先落了地`,
          `${anchor}先借一个动作把气氛撑起来`,
          `${anchor}先从空间里的变化慢慢显形`
        ],
        close: ["等这一层站稳，后面的情绪才有地方落。", "场面一成立，故事就会自己往前走。", "这样起笔，后面就不需要靠解释硬推。"] 
      },
      {
        lead: ["门口、桌边、灯下这些边角最先开口", "场面通常不是从大句子开始的", "先把镜头压低一点"],
        bridge: [
          `${anchor}会在被忽略的东西上先露出轮廓`,
          `${anchor}先借一处安静把重量压出来`,
          `${anchor}先从一个停顿里被看见`
        ],
        close: ["读者先看到，才会愿意继续理解。", "等细节站住，后面的推进就会自然很多。", "先有可见之物，后面才不容易散。"]
      }
    ],
    emotion: [
      {
        lead: ["有些开头不是先说，而是先压住", "真正先起变化的往往不是情节", "情绪最怕一上来就说满"],
        bridge: [
          `${anchor}先在呼吸和停顿里露出一点边`,
          `${anchor}会先落在身体最诚实的地方`,
          `${anchor}先把心里的节奏悄悄带慢`
        ],
        close: ["等这点余味留下来，后面再展开才不虚。", "先压住这一层，后面才有真正的回声。", "克制一点，反而更像真实的人在起笔。"] 
      },
      {
        lead: ["不用急着解释感受", "先让心里的那点迟疑冒出来", "情绪真正成立，通常只差一个停顿"],
        bridge: [
          `${anchor}本身就会把气氛慢慢压低`,
          `${anchor}会让原本很吵的念头先安静下来`,
          `${anchor}会先把人推回最私人的那一层`
        ],
        close: ["这时候再往下写，才不会像在概括。", "开头只要先把这一下写准，后面就会跟上。", "先承认这点波动，比直接下结论更有劲。"]
      }
    ],
    question: [
      {
        lead: ["问题不该只是提出来", "真正能抓住人的问题，得先贴着现场", "如果第一句要把人拽住，不一定靠重话"],
        bridge: [
          `但${anchor}会逼着人先回答一个更具体的问题`,
          `而${anchor}最先撬开的，往往是一个躲不开的疑问`,
          `因为${anchor}一旦摆到眼前，问题就不再抽象`
        ],
        close: ["先把这个问号立住，读者自然会往下走。", "答案不用急着给，入口先成立就够了。", "只要问题够贴身，开头就已经有了抓力。"] 
      },
      {
        lead: ["不是所有提问都像标题党", "好的开头提问，应该让人觉得这件事轮到自己了", "问题越具体，入口越稳"],
        bridge: [
          `所以${anchor}更适合被问成眼前这一下`,
          `而${anchor}真正卡人的，恰好是最难绕开的那一步`,
          `因为${anchor}最先改变的，不是答案，而是提问方式`
        ],
        close: ["这时候留一点空白，读者会自己补上下一步。", "问题只要问准，后面就不需要硬拽。", "让人先停住一下，开头就算立住了。"]
      }
    ],
    statement: [
      {
        lead: ["有些主题最好别从铺垫开始", "第一句如果要有力，往往得先立场", "开头最怕把判断藏得太后"],
        bridge: [
          `而${anchor}更适合先被钉成一个明确判断`,
          `因为${anchor}真正改变人的，是它带来的顺序重排`,
          `所以${anchor}不该被写成背景，而该先被说成结论`
        ],
        close: ["判断先立住，后面的展开才有抓手。", "这样起笔，读者会更快知道你要往哪里去。", "态度先出来，开头才不像说明。"] 
      },
      {
        lead: ["不是每个开头都要绕一下", "有时候最稳的方式就是先说清楚", "先把话钉住，比先铺很长一段更有效"],
        bridge: [
          `${anchor}就是那种适合先下判断的主题`,
          `${anchor}一旦被说得够直，后面反而更容易展开`,
          `${anchor}真正难写的，不是内容，而是第一句不敢落地`
        ],
        close: ["先落地，后面的层次才有地方长出来。", "只要判断准，开头就已经有了方向。", "别怕短一点，关键是先站住。"]
      }
    ],
    contrast: [
      {
        lead: ["反差不是为了炫技，而是为了让人先感觉到不对", "真正有记忆点的开头，往往先把两层状态并排放出来", "先让表面和里面错开一点"],
        bridge: [
          `这样${anchor}才会露出它真正拧巴的地方`,
          `这样${anchor}才不会只剩一句概括`,
          `这样${anchor}的张力才会先于解释出现`
        ],
        close: ["一旦这层偏差立住，后面就会自己带出余震。", "读者先察觉到不对，才会愿意往里追。", "反差先成立，故事才不容易平。"] 
      },
      {
        lead: ["不是所有变化都靠大转折", "很多时候，真正有劲的是那一点轻微偏移", "开头先别急着揭底"],
        bridge: [
          `让${anchor}先从表里不一里慢慢露出来`,
          `让${anchor}先在前后落差里站住`,
          `让${anchor}先把读者带进那种说不对劲的感觉里`
        ],
        close: ["等这种偏差被看见，后面的推进就会更顺。", "不需要很响，只要那点错位够真就行。", "这样换簇，比重复原来的骨架更稳。"]
      }
    ]
  };

  const families = variants[plan.strategyType] ?? variants.statement;

  for (let attempt = 0; attempt < families.length * 9; attempt += 1) {
    const family = families[(freshnessSeed + candidateIndex + attempt + laneIndex * 3) % families.length];
    const lead = family.lead[(freshnessSeed + attempt * 3) % family.lead.length];
    const bridge = family.bridge[(freshnessSeed + candidateIndex * 5 + attempt) % family.bridge.length];
    const close = family.close[(freshnessSeed + candidateIndex * 7 + attempt * 2) % family.close.length];
    const text = normalizeOpeningText(`${lead}，${bridge}。${close}`);
    const signature = buildOpeningOutputSignature({
      strategyType: plan.strategyType,
      openingStrategy: plan.openingStrategy,
      expressionMode: plan.expressionMode,
      content: text
    });

    if (isValidOpeningContent(text) && buildRecentOutputHardBlockReasons(signature, recentMemory).length === 0) {
      return text;
    }
  }

  return normalizeOpeningText(`${anchor}不该再回到刚才那种写法里，它需要一个新的入口。`);
}

function buildForcedClusterEscapeOpening(input: {
  plan: CandidatePlanLike;
  analysis: ReturnType<typeof analyzeInput>;
  candidateIndex: number;
  freshnessSeed: number;
  recentMemory: RecentOutputSignatureMemory | null;
  laneIndex?: number;
}) {
  const anchor = getTopicAnchor(input.analysis);
  const laneIndex = input.laneIndex ?? 0;
  const escapeFamilies: Record<OpeningStrategyType, Array<{ lead: string[]; bridge: string[]; close: string[] }>> = {
    scene: [
      {
        lead: ["别从原来的句首进去", "这次先把镜头挪开一点", "先让场面换个落点"],
        bridge: [
          `${anchor}更适合先从边上的动静被看见`,
          `${anchor}先借一个被忽略的动作落地`,
          `${anchor}先从空间里的偏移露出形状`
        ],
        close: ["入口一换，后面的画面才会真正分开。", "先错开旧骨架，场面才不容易回簇。", "先换掉起笔习惯，内容才会新。"] 
      },
      {
        lead: ["不要再回到同一处细节", "这次先把视线落在节奏上", "先让现场自己开口"],
        bridge: [
          `${anchor}会从停顿和推进之间先露出来`,
          `${anchor}不是先靠判断成立，而是先靠气息站住`,
          `${anchor}先从场面的重心变化被带出来`
        ],
        close: ["这样换道以后，内容就不会贴着旧模板走。", "先改轨道，再谈细节，才能真正换簇。", "画面一旦改了入口，后面自然会跟着散开。"]
      }
    ],
    emotion: [
      {
        lead: ["别再把情绪写成同一个起手", "这次先留住那点停顿", "先不急着说满感觉"],
        bridge: [
          `${anchor}更像是慢慢压进心里的东西`,
          `${anchor}先把人的节奏轻轻拖慢`,
          `${anchor}会先落在不愿明说的那一下`
        ],
        close: ["把入口改掉，情绪才不会回到旧槽里。", "先留空，再展开，比重复那一簇更稳。", "换掉骨架以后，余味也会跟着不一样。"] 
      },
      {
        lead: ["让情绪从另一层出来", "先承认那点说不清的东西", "别把心里的波动写成现成句式"],
        bridge: [
          `${anchor}先让人察觉到的是沉默里的变化`,
          `${anchor}先把原本很吵的东西压低了一点`,
          `${anchor}先在身体和记忆之间留下了一道缝`
        ],
        close: ["只要入口不重复，后面的情绪就会更真。", "先错开旧句首，内容才不会像回放。", "情绪改了切面，整条候选也会跟着换气。"] 
      }
    ],
    question: [
      {
        lead: ["别再问成上一次那种样子", "这次问题先贴到现实里", "问号本身也得换一个骨架"],
        bridge: [
          `${anchor}真正卡人的地方，在于它会逼人先选边`,
          `${anchor}更像一道不能绕开的临场追问`,
          `${anchor}会把人直接推到必须回应的那一步`
        ],
        close: ["问题一换位，整条候选就不会回到旧簇。", "先把问法换掉，后面的抓力才算新的。", "不是换个词，而是换整个提问入口。"] 
      },
      {
        lead: ["这次别把问题停在表面", "先把问号压近一点", "让问题从别的角度进来"],
        bridge: [
          `${anchor}要先被问成一件落在眼前的事`,
          `${anchor}会先逼出一个更贴身的疑问`,
          `${anchor}更适合被问成正在发生的选择`
        ],
        close: ["问法一变，旧模板就很难再黏回来。", "先换掉问题结构，再继续写才有意义。", "把问号问准，也是在换簇。"] 
      }
    ],
    statement: [
      {
        lead: ["别再沿着旧判断开场", "这次先把立场换个落法", "先让判断从另一侧站住"],
        bridge: [
          `${anchor}更适合先被说成一种顺序错位`,
          `${anchor}真正改变人的，是它把很多默认值重新洗了一遍`,
          `${anchor}不是单独的点，而是一连串会连动的变化`
        ],
        close: ["只要判断骨架变了，旧簇就回不来。", "先换掉论断的站位，内容才像新的。", "别只换首词，判断本身也要换轨。"] 
      },
      {
        lead: ["别把这句又写成经验口吻", "这次先让观点带一点位移", "判断也需要真正错开旧模板"],
        bridge: [
          `${anchor}最难的地方，在于它会把后面所有安排一起拖偏`,
          `${anchor}真正显出力道时，表面的平静往往还没散`,
          `${anchor}往往先改掉的是人的反应顺序，而不是结论`
        ],
        close: ["观点一旦换了骨架，整条候选也会离开旧家族。", "不是更狠，而是更换一种组织方式。", "先把论断说成别的结构，才算真正换簇。"] 
      }
    ],
    contrast: [
      {
        lead: ["别再用同一种反差起手", "这次先让两层状态从别的位置相撞", "先把错位换一种摆法"],
        bridge: [
          `${anchor}更适合先把表面和暗处轻轻错开`,
          `${anchor}先让前后两层节奏并排出现`,
          `${anchor}先从不协调处自己漏出张力`
        ],
        close: ["反差换了摆法，内容就不会再贴着旧簇。", "先改对照骨架，后面的劲才是新的。", "不是更夸张，而是更换一组并排关系。"] 
      },
      {
        lead: ["别让反差只剩一句熟悉的模板", "这次先把偏差埋进节奏里", "先从另一处不对劲进去"],
        bridge: [
          `${anchor}会先让表面和里面各自朝不同方向滑一点`,
          `${anchor}真正有力的地方，不在揭底，而在并排`,
          `${anchor}先让读者感觉到轻微失衡，再慢慢往里走`
        ],
        close: ["这种换道比修句子更能彻底离开旧家族。", "先让对照关系变掉，旧骨架才不会回来。", "反差一旦换层次，整个候选就分开了。"] 
      }
    ]
  };

  const families = escapeFamilies[input.plan.strategyType] ?? escapeFamilies.statement;
  for (let attempt = 0; attempt < families.length * 9; attempt += 1) {
    const family = families[(input.freshnessSeed + input.candidateIndex + attempt + laneIndex * 5) % families.length];
    const lead = family.lead[(input.freshnessSeed + attempt) % family.lead.length];
    const bridge = family.bridge[(input.freshnessSeed + input.candidateIndex * 3 + attempt) % family.bridge.length];
    const close = family.close[(input.freshnessSeed + input.candidateIndex * 7 + attempt * 2) % family.close.length];
    const candidate = normalizeOpeningText(`${lead}，${bridge}。${close}`);
    const signature = buildCandidatePlanSignature(input.plan, candidate);

    if (isValidOpeningContent(candidate) && buildRecentOutputHardBlockReasons(signature, input.recentMemory).length === 0) {
      return candidate;
    }
  }

  return normalizeOpeningText(`${anchor}刚刚那一批写法已经出现过，这次必须换一个入口。`);
}

function buildGateReplacementContent(input: {
  plan: CandidatePlanLike;
  analysis: ReturnType<typeof analyzeInput>;
  recentMemory: RecentOutputSignatureMemory | null;
  index: number;
  freshnessSeed: number;
  laneIndex?: number;
}) {
  const laneIndex = input.laneIndex ?? 0;
  const laneBuilders = [
    (attempt: number) =>
      buildFallbackOpeningText(
        input.plan,
        getTopicAnchor(input.analysis),
        input.analysis,
        input.index,
        input.freshnessSeed + laneIndex * 173 + attempt * 97,
        input.recentMemory
      ),
    (attempt: number) =>
      buildReleaseGateFallbackOpening(
        input.plan,
        input.analysis,
        input.index,
        input.freshnessSeed + laneIndex * 211 + attempt * 131,
        input.recentMemory,
        laneIndex + attempt
      ),
    (attempt: number) =>
      buildForcedClusterEscapeOpening({
        plan: input.plan,
        analysis: input.analysis,
        candidateIndex: input.index,
        freshnessSeed: input.freshnessSeed + laneIndex * 257 + attempt * 149,
        recentMemory: input.recentMemory,
        laneIndex: laneIndex + attempt
      })
  ];

  for (const builder of laneBuilders) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = builder(attempt);
      const signature = buildCandidatePlanSignature(input.plan, candidate);
      if (detectRecentOutputHardBlocks(signature, input.recentMemory).length === 0) {
        return candidate;
      }
    }
  }

  return buildForcedClusterEscapeOpening({
    plan: input.plan,
    analysis: input.analysis,
    candidateIndex: input.index,
    freshnessSeed: input.freshnessSeed + 997,
    recentMemory: input.recentMemory,
    laneIndex: laneIndex + 3
  });
}

function buildFallbackCandidates(
  generationRequestId: string,
  rawInput: string,
  analysis: ReturnType<typeof analyzeInput>,
  candidatePlans: ReturnType<typeof buildCandidatePlans>,
  freshnessSeed = 0,
  recentMemory: RecentOutputSignatureMemory | null = null
) {
  return candidatePlans.map((plan, index) =>
    candidateSeed(
      plan.strategyType,
      plan.openingStrategy,
      plan.styleLabel,
      buildGateReplacementContent({
        plan,
        analysis,
        recentMemory,
        index,
        freshnessSeed: freshnessSeed + index * 53
      }),
      58,
      generationRequestId,
      index + 1
    )
  );
}

function collectRecentReleaseGateTargets(
  contents: string[],
  candidatePlans: ReturnType<typeof buildCandidatePlans>,
  rawInput: string,
  recentMemory: RecentOutputSignatureMemory | null
) {
  const targets = contents.flatMap((content, index) => {
    const normalized = normalizeOpeningText(content);
    const validationReason = getValidationReason(normalized, rawInput);
    if (validationReason) {
      return [
        {
          index,
          reason: validationReason
        }
      ];
    }

    const plan = candidatePlans[index];
    const signature = buildCandidatePlanSignature(plan, normalized);
    const hardReasons = buildRecentOutputHardBlockReasons(signature, recentMemory);
    if (hardReasons.length === 0) {
      return [];
    }

    return [
      {
        index,
        reason: hardReasons.join("；")
      }
    ];
  });

  return { targets };
}

async function loadFeedbackWeightsForGuest(traceId: string, guestId: string) {
  try {
    const [feedbackEvents, copyEvents] = await Promise.all([
      listRecentFeedbackEventsForGuest(guestId, 20),
      listRecentCopyEventsForGuest(guestId, 20)
    ]);
    const signals: FeedbackPreferenceSignal[] = [
      ...feedbackEvents.map((event) => ({
        generationRequestId: event.generationRequestId,
        candidateId: event.candidateId,
        strategyType: event.strategyType,
        type: (event.type === "like" || event.type === "dislike" ? event.type : "dislike") as FeedbackSignalType,
        reasonTag: event.reasonTag,
        createdAt: event.createdAt
      })),
      ...copyEvents.map((event) => ({
        generationRequestId: event.generationRequestId ?? event.candidateId,
        candidateId: event.candidateId,
        strategyType: event.strategyType,
        type: "copy" as const,
        reasonTag: null,
        createdAt: event.createdAt
      }))
    ];
    const feedbackComputation = analyzeFeedbackPreference(signals);
    logInfo("generate-openings", "feedback preference loaded", {
      traceId,
      guestId,
      rawFeedbackCount: feedbackEvents.length,
      rawCopyCount: copyEvents.length,
      rawSignalCount: signals.length,
      dedupedSignalCount: feedbackComputation.dedupedCount,
      duplicateCount: feedbackComputation.duplicateCount,
      feedbackWeights: feedbackComputation.weights,
      strategyCounts: feedbackComputation.strategyCounts
    });
    return feedbackComputation.weights;
  } catch (error) {
    logWarn("generate-openings", "failed to load feedback preference, using neutral weights", {
      traceId,
      guestId,
      error: summarizeError(error)
    });
    return analyzeFeedbackPreference([]).weights;
  }
}

async function loadRecentOutputSignatureMemoryForGuest(traceId: string, guestId: string) {
  try {
    const history = await listRecentGenerationHistory(guestId, RECENT_GENERATION_HISTORY_LIMIT);
    const memory = buildRecentOutputSignatureMemory(history, {
      candidateLimit: RECENT_SIGNATURE_CANDIDATE_LIMIT,
      noteLimit: 12
    });

    logInfo("generate-openings", "recent output signature memory loaded", {
      traceId,
      guestId,
      requestCount: history.length,
      candidateCount: memory.recentCount,
      rotationSeed: memory.rotationSeed,
      notes: memory.notes
    });

    return memory;
  } catch (error) {
    logWarn("generate-openings", "failed to load recent output signature memory", {
      traceId,
      guestId,
      error: summarizeError(error)
    });
    return buildRecentOutputSignatureMemory([], {
      candidateLimit: RECENT_SIGNATURE_CANDIDATE_LIMIT,
      noteLimit: 0
    });
  }
}

function enforceRecentOutputHardConstraint(input: {
  traceId: string;
  generationRequestId: string;
  analysis: ReturnType<typeof analyzeInput>;
  rawInput: string;
  candidatePlans: ReturnType<typeof buildCandidatePlans>;
  candidateContents: string[];
  recentMemory: RecentOutputSignatureMemory | null;
  freshnessSeed: number;
}) {
  let workingContents = input.candidateContents.map((content) => normalizeOpeningText(content));
  let replacementCount = 0;
  let gatePasses = 0;

  for (let pass = 0; pass < 6; pass += 1) {
    const report = collectDiversityRepairTargets(workingContents, input.candidatePlans, input.rawInput, input.recentMemory);
    if (report.targets.length === 0) {
      break;
    }

    logInfo("generate-openings", "hard recent-output uniqueness repair queued", {
      traceId: input.traceId,
      requestId: input.generationRequestId,
      pass,
      repairCount: report.targets.length,
      reasons: report.targets.map((item) => item.slot.reason)
    });

    for (const target of report.targets) {
      const plan = input.candidatePlans[target.index];
      const attemptSeed = input.freshnessSeed + (pass + 1) * 127 + target.index * 19 + gatePasses * 31;
      const hardReplacement = normalizeOpeningText(
        buildGateReplacementContent({
          plan,
          analysis: input.analysis,
          recentMemory: input.recentMemory,
          index: target.index,
          freshnessSeed: attemptSeed,
          laneIndex: pass
        })
      );

      workingContents[target.index] = hardReplacement;
      replacementCount += 1;
    }

    gatePasses += 1;
  }

  const finalReport = collectDiversityRepairTargets(workingContents, input.candidatePlans, input.rawInput, input.recentMemory);
  if (finalReport.targets.length > 0) {
    for (const target of finalReport.targets) {
      const plan = input.candidatePlans[target.index];
      workingContents[target.index] = normalizeOpeningText(
        buildGateReplacementContent({
          plan,
          analysis: input.analysis,
          recentMemory: input.recentMemory,
          index: target.index,
          freshnessSeed: input.freshnessSeed + 1703 + target.index * 41,
          laneIndex: 7
        })
      );
      replacementCount += 1;
    }
  }

  const releaseReport = collectRecentReleaseGateTargets(
    workingContents,
    input.candidatePlans,
    input.rawInput,
    input.recentMemory
  );
  if (releaseReport.targets.length > 0) {
    logWarn("generate-openings", "release gate still sees historical collisions after hard replacement", {
      traceId: input.traceId,
      requestId: input.generationRequestId,
      collisionCount: releaseReport.targets.length,
      reasons: releaseReport.targets.map((item) => item.reason)
    });
  }

  return {
    candidateContents: workingContents,
    replacementCount,
    remainingCollisions: releaseReport.targets.length
  };
}

function scheduleBackgroundEvaluationRefresh(input: {
  traceId: string;
  generationRequestId: string;
  provider: ReturnType<typeof getDefaultLlmProvider>;
  generationState: GenerationState;
  rawInput: string;
  analysis: ReturnType<typeof analyzeInput>;
  candidateRows: GeneratedOpeningCandidate[];
  styleOptions: string[];
}) {
  if (input.provider.llmMode === "mock" || input.generationState === "fallback") {
    return;
  }

  void (async () => {
    try {
      const evaluations = await evaluateOpeningCandidates({
        provider: input.provider,
        rawInput: input.rawInput,
        contentType: input.analysis.contentType,
        styleOptions: input.styleOptions,
        candidates: input.candidateRows.map((candidate, index) => ({
          index: index + 1,
          rawInput: input.rawInput,
          contentType: input.analysis.contentType,
          styleOptions: input.styleOptions,
          strategyType: candidate.strategyType,
          openingStrategy: candidate.openingStrategy,
          styleLabel: candidate.styleLabel,
          content: candidate.content
        }))
      });

      if (evaluations.length === 0 || evaluations.every((evaluation) => evaluation.source === "fallback")) {
        logInfo("generate-openings", "background evaluation skipped: fallback only", {
          traceId: input.traceId,
          requestId: input.generationRequestId
        });
        return;
      }

      await updateOpeningCandidateEvaluations(
        input.generationRequestId,
        evaluations.map((evaluation, index) => ({
          candidateId: input.candidateRows[index]?.id ?? "",
          evaluation
        }))
      );

      logInfo("generate-openings", "background evaluation refreshed", {
        traceId: input.traceId,
        requestId: input.generationRequestId,
        candidateCount: evaluations.length,
        scores: evaluations.map((evaluation) => evaluation.totalScore)
      });
    } catch (error) {
      logWarn("generate-openings", "background evaluation failed", {
        traceId: input.traceId,
        requestId: input.generationRequestId,
        error: summarizeError(error)
      });
    }
  })();
}

async function reinforceSentenceDiversity(
  ranked: GeneratedOpeningCandidate[],
  candidatePlans: ReturnType<typeof buildCandidatePlans>,
  analysis: ReturnType<typeof analyzeInput>,
  rawInput: string,
  generationRequestId: string,
  provider: ReturnType<typeof getDefaultLlmProvider>,
  traceId: string,
  recentMemory: RecentOutputSignatureMemory | null,
  freshnessSeed: number
) {
  const topicFrame = buildOpeningTopicFrame(rawInput, analysis);
  let workingCandidates = ranked.map((candidate) => ({ ...candidate }));
  let usedRepair = false;
  let usedFallback = false;

  for (let pass = 0; pass < 2; pass += 1) {
    const report = collectDiversityRepairTargets(
      workingCandidates.map((candidate) => candidate.content),
      candidatePlans,
      rawInput,
      recentMemory
    );

    if (report.targets.length === 0 && report.summary.uniqueStructureCount >= 3 && report.summary.uniqueFormulaCount >= 3) {
      break;
    }

    if (report.targets.length === 0) {
      break;
    }

    usedRepair = true;
    logInfo("generate-openings", "sentence diversity repair queued", {
      traceId,
      requestId: generationRequestId,
      pass,
      repairCount: report.targets.length,
      reasons: report.targets.map((item) => item.slot.reason)
    });

    try {
      const repairPrompt = buildOpeningBatchRepairPrompt({
        rawInput,
        analysis,
        repairSlots: report.targets.map((item) => item.slot),
        recentOutputNotes: recentMemory?.notes ?? [],
        freshnessSeed
      });
      const repairResults = await generateBatchWithRetry(
        provider,
        {
          system: repairPrompt.system,
          user: repairPrompt.user,
          temperature: 0.72,
          maxTokens: MAX_GENERATION_TOKENS,
          count: report.targets.length
        },
        "候选多样性修复"
      );

      const repairContents = repairResults.map((result) => normalizeOpeningText(result.text));
      const repairValidation = validateBatchContents(
        repairContents,
        report.targets.map((item) => item.slot),
        rawInput
      );

      logInfo("generate-openings", "sentence diversity repair finished", {
        traceId,
        requestId: generationRequestId,
        pass,
        validCount: repairValidation.validContents.length,
        invalidCount: repairValidation.invalidItems.length,
        lengths: repairContents.map((content) => content.length)
      });

      report.targets.forEach((target, repairIndex) => {
        const nextContent = repairContents[repairIndex] || "";
        const reason = getValidationReason(nextContent, rawInput);
        if (reason) {
          return;
        }

        const current = normalizeOpeningText(nextContent);
        const currentDuplicate = workingCandidates.some(
          (candidate, candidateIndex) => candidateIndex !== target.index && normalizeOpeningText(candidate.content) === current
        );

        if (currentDuplicate) {
          return;
        }

        workingCandidates[target.index] = {
          ...workingCandidates[target.index],
          content: current
        };
      });

      const afterRepair = collectDiversityRepairTargets(
        workingCandidates.map((candidate) => candidate.content),
        candidatePlans,
        rawInput,
        recentMemory
      );

      if (afterRepair.targets.length === 0 && afterRepair.summary.uniqueStructureCount >= 3 && afterRepair.summary.uniqueFormulaCount >= 3) {
        break;
      }

      if (pass === 0 && afterRepair.targets.length > 0) {
        afterRepair.targets.forEach((target) => {
          const plan = candidatePlans[target.index];
          const fallbackContent = normalizeOpeningText(
            buildFallbackOpeningText(
              {
                strategyType: plan.strategyType,
                openingStrategy: workingCandidates[target.index].openingStrategy,
                styleLabel: workingCandidates[target.index].styleLabel,
                angle: plan.angle,
                lengthHint: plan.lengthHint,
                expressionMode: plan.expressionMode,
                entryAngle: plan.entryAngle
              },
              topicFrame.themeAnchor,
              analysis,
              target.index,
              freshnessSeed,
              recentMemory
            )
          );
          workingCandidates[target.index] = {
            ...workingCandidates[target.index],
            content: fallbackContent
          };
          usedFallback = true;
        });

        const postFallback = collectDiversityRepairTargets(
          workingCandidates.map((candidate) => candidate.content),
          candidatePlans,
          rawInput,
          recentMemory
        );

        if (postFallback.targets.length === 0) {
          break;
        }
      }
    } catch (error) {
      logWarn("generate-openings", "sentence diversity repair failed", {
        traceId,
        requestId: generationRequestId,
        pass,
        error: summarizeError(error)
      });
    }
  }

  const finalReport = collectDiversityRepairTargets(
    workingCandidates.map((candidate) => candidate.content),
    candidatePlans,
    rawInput,
    recentMemory
  );
  if (finalReport.targets.length > 0) {
    usedFallback = true;
    finalReport.targets.forEach((target) => {
      const plan = candidatePlans[target.index];
      workingCandidates[target.index] = {
        ...workingCandidates[target.index],
        content: normalizeOpeningText(
          buildFallbackOpeningText(
            {
              strategyType: plan.strategyType,
              openingStrategy: workingCandidates[target.index].openingStrategy,
              styleLabel: workingCandidates[target.index].styleLabel,
              angle: plan.angle,
              lengthHint: plan.lengthHint,
              expressionMode: plan.expressionMode,
              entryAngle: plan.entryAngle
            },
            topicFrame.themeAnchor,
            analysis,
            target.index,
            freshnessSeed,
            recentMemory
          )
        )
      };
    });
  }

  return {
    candidates: workingCandidates,
    usedRepair,
    usedFallback
  };
}

async function generateBatchWithRetry(
  provider: ReturnType<typeof getDefaultLlmProvider>,
  input: Parameters<ReturnType<typeof getDefaultLlmProvider>["generateOpenings"]>[0],
  label: string
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MODEL_CALL_RETRIES; attempt += 1) {
    try {
      return await provider.generateOpenings(input);
    } catch (error) {
      lastError = error;
      if (attempt < MODEL_CALL_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        continue;
      }

      break;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `${label}失败：${sanitizeFailureMessage(lastError.message)}`
      : `${label}失败：模型暂时不可用，请稍后再试。`
  );
}

function getMinimalOpeningValidationReason(content: string, rawInput: string) {
  const text = normalizeOpeningText(content);
  if (!text) return "空白内容";
  if (isPromptEchoLike(text, rawInput)) return "提示词回显";
  const repeatedFragment = findRepeatedFragment(text);
  if (repeatedFragment) return `重复展开：${repeatedFragment}`;
  return null;
}

function normalizeProviderOpening(text: string, rawInput: string) {
  const trimmed = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/^\s*(?:候选|开头|结果|正文)\s*\d*\s*[:：-]\s*/i, "")
    .replace(/^\s*(?:输入|题目|原始输入|风格偏好|候选数量)\s*[:：]\s*/i, "")
    .replace(/^\s*请直接给出.+$/imu, "")
    .replace(/^\s*content\s*[:：]\s*/i, "");

  const firstJsonContent = trimmed.match(/"content"\s*:\s*"([^"]+)"/);
  if (firstJsonContent?.[1]) {
    return normalizeOpeningText(firstJsonContent[1]);
  }

  const blocks = trimmed
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const bestBlock =
    blocks.find((item) => !isPromptEchoLike(item, rawInput)) ||
    blocks[blocks.length - 1] ||
    trimmed;

  return normalizeOpeningText(
    bestBlock
      .replace(/^让我尝试一个新的角度[:：]\s*/u, "")
      .replace(/^草稿[:：]\s*/u, "")
      .replace(/^这次要避免之前的开头方式[。！？!?]?\s*/u, "")
      .replace(/^之前的开头可能用了[^。！？\n]{0,40}[。！？]\s*/u, "")
      .replace(/^可以尝试从[^。！？\n]{0,40}[。！？]\s*/u, "")
  );
}

function isDuplicateOpening(content: string, seenContents: string[]) {
  const normalized = normalizeOpeningText(content);
  return seenContents.some((item) => normalized === normalizeOpeningText(item));
}

async function generateCandidateWithRetry(input: {
  provider: ReturnType<typeof getDefaultLlmProvider>;
  rawInput: string;
  analysis: ReturnType<typeof analyzeInput>;
  styleOptions: string[];
  plan: ReturnType<typeof buildCandidatePlans>[number];
  candidateIndex: number;
  seenContents: string[];
  traceId: string;
  requestId: string;
}) {
  let lastReason = "模型暂时不可用";
  let lastRawOutput = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const prompt = buildOpeningPrompt({
        rawInput: input.rawInput,
        strategy: {
          strategyType: input.plan.strategyType,
          label: input.plan.openingStrategy,
          reason: input.plan.angle,
          angle: input.plan.angle,
          lengthHint: input.plan.lengthHint,
          expressionMode: input.plan.expressionMode,
          entryAngle: input.plan.entryAngle
        },
        styleOptions: input.styleOptions,
        candidateIndex: input.candidateIndex,
        attempt,
        avoidOpenings: input.seenContents
      });

      const result = await input.provider.generateText({
        system: prompt.system,
        user: prompt.user,
        temperature: input.provider.llmMode === "mock" ? 0.8 + attempt * 0.05 : 0.9 + attempt * 0.05,
        maxTokens: input.provider.llmMode === "mock" ? 420 : MAX_GENERATION_TOKENS
      });

      lastRawOutput = result.text;
      const content = normalizeProviderOpening(result.text, input.rawInput);
      const validationReason = getMinimalOpeningValidationReason(content, input.rawInput);

      if (validationReason) {
        lastReason = validationReason;
        logWarn("generate-openings", "candidate normalized but still invalid", {
          traceId: input.traceId,
          requestId: input.requestId,
          index: input.candidateIndex + 1,
          attempt: attempt + 1,
          reason: validationReason,
          rawPreview: truncateForLog(result.text, 160)
        });
        continue;
      }

      const ruleEvaluation = buildRuleBasedOpeningEvaluation(content, {
        rawInput: input.rawInput,
        analysis: input.analysis,
        strategyType: input.plan.strategyType,
        modelName: input.provider.modelName
      });
      const hardRuleMarkers = ["任务说明腔", "模板化表达", "原句回声", "开头像总结段"];
      const nonLengthWeaknesses = ruleEvaluation.weaknesses.filter(
        (item) => !LENGTH_WEAKNESS_MARKERS.some((marker) => item.includes(marker))
      );
      const hasHardRuleFailure =
        (nonLengthWeaknesses.length > 0 && ruleEvaluation.totalScore < 45) ||
        nonLengthWeaknesses.some((item) => hardRuleMarkers.some((marker) => item.includes(marker)));

      if (hasHardRuleFailure) {
        lastReason = `规则评估未通过（${ruleEvaluation.weaknesses.join(" / ") || "质量不足"}）`;
        logWarn("generate-openings", "candidate rejected by rule gate", {
          traceId: input.traceId,
          requestId: input.requestId,
          index: input.candidateIndex + 1,
          attempt: attempt + 1,
          totalScore: ruleEvaluation.totalScore,
          weaknesses: ruleEvaluation.weaknesses,
          rawPreview: truncateForLog(result.text, 160)
        });
        continue;
      }

      const maybeCompressed = await compressOpeningContent({
        provider: input.provider,
        rawInput: input.rawInput,
        styleOptions: input.styleOptions,
        plan: input.plan,
        candidateIndex: input.candidateIndex,
        content,
        traceId: input.traceId,
        requestId: input.requestId,
        seenContents: input.seenContents
      });

      const finalContent = maybeCompressed.content;

      if (isDuplicateOpening(finalContent, input.seenContents)) {
        lastReason = "与前文重复";
        logWarn("generate-openings", "candidate duplicated previous opening", {
          traceId: input.traceId,
          requestId: input.requestId,
          index: input.candidateIndex + 1,
          attempt: attempt + 1,
          rawPreview: truncateForLog(result.text, 160)
        });
        continue;
      }

      return finalContent;
    } catch (error) {
      lastReason = sanitizeFailureMessage(error instanceof Error ? error.message : "模型暂时不可用");
      logWarn("generate-openings", "candidate generation attempt failed", {
        traceId: input.traceId,
        requestId: input.requestId,
        index: input.candidateIndex + 1,
        attempt: attempt + 1,
        error: summarizeError(error)
      });
    }
  }

  throw new BusinessError(
    "OPENING_GENERATION_FAILED",
    `生成失败：第 ${input.candidateIndex + 1} 条候选不可恢复（${lastReason}）。`,
    502
  );
}

async function generateOpeningsSimplified(input: GenerateOpeningsInput): Promise<GenerateOpeningsResponse> {
  const normalizedInput = input.rawInput.trim();
  const traceId = input.traceId ?? crypto.randomUUID();
  const usageDate = todayKey();
  const currentUsage = await getUsageCountForGuest(input.guestId, usageDate);

  logInfo("generate-openings", "request received", {
    traceId,
    guestId: input.guestId,
    usageDate,
    currentUsage,
    usageLimit: DAILY_GUEST_LIMIT,
    candidateCount: input.candidateCount,
    inputLength: normalizedInput.length,
    inputPreview: truncateForLog(normalizedInput, 120),
    styleOptions: input.styleOptions
  });

  if (normalizedInput.length < MIN_INPUT_LENGTH) {
    throw new Error("内容至少需要 20 个字。");
  }
  if (normalizedInput.length > MAX_INPUT_LENGTH) {
    throw new Error("内容最多 2000 个字。");
  }
  if (currentUsage >= DAILY_GUEST_LIMIT) {
    logWarn("generate-openings", "daily limit reached", {
      traceId,
      guestId: input.guestId,
      usageDate,
      currentUsage,
      usageLimit: DAILY_GUEST_LIMIT
    });
    throw new BusinessError(
      "DAILY_LIMIT_EXCEEDED",
      "开发阶段额度已用完，请调整 KAICHANG_DAILY_GUEST_LIMIT 后再试。",
      429
    );
  }

  const analysis = analyzeInput(normalizedInput);
  const provider = getDefaultLlmProvider();
  const candidateCount = clampCandidateCount(input.candidateCount);
  const strategies = chooseOpeningStrategies(analysis, input.styleOptions, candidateCount);
  const candidatePlans = buildCandidatePlans(strategies, analysis.preferredStyles);
  const generationStartedAt = Date.now();
  const generationRequestId = crypto.randomUUID();
  let generationRequest = { id: generationRequestId };

  try {
    generationRequest = await createGenerationRequest({
      guestId: input.guestId,
      rawInput: normalizedInput,
      styleOptions: input.styleOptions,
      detectedIntent: normalizedInput,
      detectedTone: analysis.preferredStyles,
      contentType: analysis.contentType,
      candidateCount,
      providerName: provider.providerName,
      modelName: provider.modelName,
      latencyMs: 0,
      status: "running",
      errorMessage: null
    });
  } catch (error) {
    logWarn("generate-openings", "failed to create generation request, using in-memory id", {
      traceId,
      guestId: input.guestId,
      error: summarizeError(error)
    });
  }

  const prompt = buildMinimalOpeningBatchPrompt({
    rawInput: normalizedInput,
    styleOptions: input.styleOptions,
    candidateCount
  });

  logInfo("generate-openings", "opening prompt built", {
    traceId,
    requestId: generationRequest.id,
    candidateCount,
    providerName: provider.providerName,
    modelName: provider.modelName
  });

  try {
    const generatedCandidates = await provider.generateOpenings({
      system: prompt.system,
      user: prompt.user,
      temperature: provider.llmMode === "mock" ? 0.84 : 0.92,
      maxTokens: MAX_GENERATION_TOKENS,
      count: candidateCount
    });

    const normalizedContents: string[] = [];
    const candidateRows = generatedCandidates.map((result, index) => {
      const content = normalizeProviderOpening(result.text, normalizedInput);
      const validationReason = getMinimalOpeningValidationReason(content, normalizedInput);

      if (validationReason) {
        throw new BusinessError(
          "OPENING_GENERATION_FAILED",
          `生成失败：第 ${index + 1} 条候选不可用（${validationReason}）。`,
          502
        );
      }

      if (isDuplicateOpening(content, normalizedContents)) {
        throw new BusinessError(
          "OPENING_GENERATION_FAILED",
          `生成失败：第 ${index + 1} 条候选与前文重复。`,
          502
        );
      }

      normalizedContents.push(content);

      const plan = candidatePlans[index];
      const candidate = candidateSeed(
        plan?.strategyType ?? "statement",
        plan?.openingStrategy ?? `候选${index + 1}`,
        plan?.styleLabel ?? plan?.openingStrategy ?? `候选${index + 1}`,
        content,
        0,
        generationRequest.id,
        index + 1,
        null
      );

      logInfo("generate-openings", "candidate generated", {
        traceId,
        requestId: generationRequest.id,
        index: index + 1,
        strategyType: candidate.strategyType,
        openingStrategy: candidate.openingStrategy,
        length: candidate.content.length
      });

      return candidate;
    });

    await createUsageRecord({
      guestId: input.guestId,
      actionType: "generate_openings",
      usageDate,
      creditsUsed: 1,
      generationRequestId: generationRequest.id
    }).catch((error) => {
      logWarn("generate-openings", "failed to record usage", {
        traceId,
        requestId: generationRequest.id,
        error: summarizeError(error)
      });
    });

    await updateGenerationRequest(generationRequest.id, {
      latencyMs: Date.now() - generationStartedAt,
      status: "completed",
      errorMessage: null
    }).catch((error) => {
      logWarn("generate-openings", "failed to update completed request", {
        traceId,
        requestId: generationRequest.id,
        error: summarizeError(error)
      });
    });

    const candidatePayload = candidateRows.map((candidate) => ({
      id: candidate.id,
      rankOrder: candidate.rankOrder,
      openingStrategy: candidate.openingStrategy,
      strategyType: candidate.strategyType,
      styleLabel: candidate.styleLabel,
      content: candidate.content,
      qualityScore: candidate.qualityScore,
      evaluation: candidate.evaluation,
      isCopied: candidate.isCopied,
      isSelected: candidate.isSelected
    }));

    let responseCandidates: OpeningCandidateResponse[] = candidatePayload.map(
      ({ id, strategyType, openingStrategy, styleLabel, content, qualityScore, evaluation, isCopied, isSelected }) => ({
        id,
        strategyType,
        openingStrategy,
        styleLabel,
        content,
        qualityScore,
        evaluation,
        isCopied,
        isSelected
      })
    );

    try {
      const persistedCandidates = await createOpeningCandidates(generationRequest.id, candidatePayload);
      responseCandidates = persistedCandidates.map((candidate) => ({
        id: candidate.id,
        strategyType: candidate.strategyType,
        openingStrategy: candidate.openingStrategy,
        styleLabel: candidate.styleLabel,
        content: candidate.content,
        qualityScore: candidate.qualityScore,
        evaluation: candidate.evaluation ?? null,
        isCopied: candidate.isCopied,
        isSelected: candidate.isSelected
      }));
      logInfo("generate-openings", "candidates persisted", {
        traceId,
        requestId: generationRequest.id,
        candidateCount: responseCandidates.length
      });
    } catch (error) {
      logWarn("generate-openings", "failed to persist candidates, returning in-memory candidates", {
        traceId,
        requestId: generationRequest.id,
        error: summarizeError(error)
      });
    }

    return {
      requestId: generationRequest.id,
      analysis,
      candidates: responseCandidates,
      usageRemaining: Math.max(0, DAILY_GUEST_LIMIT - currentUsage - 1),
      providerName: provider.providerName,
      modelName: provider.modelName,
      llmMode: provider.llmMode === "mock" ? "mock" : "real",
      generationState: provider.llmMode === "mock" ? "mock" : "real",
      evaluationState: provider.llmMode === "mock" ? "mock" : "pending"
    };
  } catch (error) {
    const message =
      error instanceof BusinessError
        ? error.message
        : error instanceof Error
          ? error.message
          : "生成失败，请稍后再试。";

    await updateGenerationRequest(generationRequest.id, {
      status: "failed",
      errorMessage: message
    }).catch(() => {
      // Best-effort update so failed requests do not remain in running.
    });

    logError("generate-openings", "simplified generation failed", {
      traceId,
      requestId: generationRequest.id,
      error: summarizeError(error)
    });

    if (error instanceof BusinessError) {
      throw error;
    }

    throw new BusinessError("OPENING_GENERATION_FAILED", "生成失败，请稍后再试。", 502);
  }
}

export async function generateOpenings(input: GenerateOpeningsInput): Promise<GenerateOpeningsResponse> {
  return generateOpeningsSimplified(input);
  const normalizedInput = input.rawInput.trim();
  const traceId = input.traceId ?? crypto.randomUUID();
  if (normalizedInput.length < MIN_INPUT_LENGTH) {
    throw new Error("内容至少需要 20 个字。");
  }
  if (normalizedInput.length > MAX_INPUT_LENGTH) {
    throw new Error("内容最多 2000 个字。");
  }

  const usageDate = todayKey();
  const currentUsage = await getUsageCountForGuest(input.guestId, usageDate);
  logInfo("generate-openings", "request received", {
    traceId,
    guestId: input.guestId,
    usageDate,
    currentUsage,
    usageLimit: DAILY_GUEST_LIMIT,
    candidateCount: input.candidateCount,
    inputLength: normalizedInput.length,
    inputPreview: truncateForLog(normalizedInput, 120),
    styleOptions: input.styleOptions
  });
  if (currentUsage >= DAILY_GUEST_LIMIT) {
    logWarn("generate-openings", "daily limit reached", {
      traceId,
      guestId: input.guestId,
      usageDate,
      currentUsage,
      usageLimit: DAILY_GUEST_LIMIT
    });
    throw new BusinessError(
      "DAILY_LIMIT_EXCEEDED",
      "开发阶段额度已用完，请调整 KAICHANG_DAILY_GUEST_LIMIT 后再试。",
      429
    );
  }

  const analysis = analyzeInput(normalizedInput);
  logInfo("generate-openings", "input analyzed", {
    traceId,
    guestId: input.guestId,
    contentType: analysis.contentType,
    preferredStyles: analysis.preferredStyles,
    lengthPreference: analysis.lengthPreference,
    rawInput: truncateForLog(analysis.rawInput, 120)
  });
  const provider = getDefaultLlmProvider();
  const candidateCount = clampCandidateCount(input.candidateCount);
  const strategies = chooseOpeningStrategies(analysis, input.styleOptions, candidateCount);
  const candidatePlans = buildCandidatePlans(strategies, analysis.preferredStyles);
  const recentOutputMemory = await loadRecentOutputSignatureMemoryForGuest(traceId, input.guestId);
  logInfo("generate-openings", "strategy plan prepared", {
    traceId,
    guestId: input.guestId,
    candidateCount,
    strategies: candidatePlans.map((plan) => ({
      strategyType: plan.strategyType,
      openingStrategy: plan.openingStrategy,
      expressionMode: plan.expressionMode,
      styleLabel: plan.styleLabel
    }))
  });

  const generationStartedAt = Date.now();
  const generationRequestId = crypto.randomUUID();
  let generationRequest = { id: generationRequestId };
  const requestFreshnessSeed = buildRequestFreshnessSeed(generationRequestId, normalizedInput, recentOutputMemory);

  try {
    generationRequest = await createGenerationRequest({
      guestId: input.guestId,
      rawInput: normalizedInput,
      styleOptions: input.styleOptions,
      detectedIntent: analysis.rawInput,
      detectedTone: analysis.preferredStyles,
      contentType: analysis.contentType,
      candidateCount,
      providerName: provider.providerName,
      modelName: provider.modelName,
      latencyMs: 0,
      status: "running",
      errorMessage: null
    });
  } catch (error) {
    logWarn("generate-openings", "failed to create generation request, using in-memory id", {
      traceId,
      guestId: input.guestId,
      error: summarizeError(error)
    });
  }

  let usageRecorded = false;
  let requestCompleted = false;
  let generationState: GenerationState = provider.llmMode === "mock" ? "mock" : "real";

  try {
    let finalContents: string[];

    try {
      const initialPrompt = buildOpeningBatchPrompt({
        rawInput: normalizedInput,
        analysis,
        strategies,
        recentOutputNotes: recentOutputMemory.notes,
        freshnessSeed: requestFreshnessSeed
      });
      logInfo("generate-openings", "opening batch prompt built", {
        traceId,
        requestId: generationRequest.id,
        candidateCount: candidatePlans.length,
        providerName: provider.providerName,
        modelName: provider.modelName
      });

      const initialResults = await generateBatchWithRetry(provider, {
        system: initialPrompt.system,
        user: initialPrompt.user,
        temperature: 0.7,
        maxTokens: MAX_GENERATION_TOKENS,
        count: candidatePlans.length
      }, "候选生成");
      logInfo("generate-openings", "initial batch completed", {
        traceId,
        requestId: generationRequest.id,
        candidateCount: initialResults.length,
        lengths: initialResults.map((result) => result.text.length)
      });
      if (initialResults[0]?.recoveryState === "recovered") {
        generationState = "recovered";
      }

      const initialContents = initialResults.map((result) => result.text);
      const initialValidation = validateBatchContents(initialContents, candidatePlans, normalizedInput);
      logInfo("generate-openings", "initial validation finished", {
        traceId,
        requestId: generationRequest.id,
        validCount: initialValidation.validContents.length,
        invalidCount: initialValidation.invalidItems.length,
        invalidReasons: initialValidation.invalidItems.map((item) => item.reason)
      });

      finalContents = initialValidation.validContents.slice();

      if (initialValidation.invalidItems.length > 0) {
        const repairPrompt = buildOpeningBatchRepairPrompt({
          rawInput: normalizedInput,
          analysis,
          repairSlots: initialValidation.invalidItems,
          recentOutputNotes: recentOutputMemory.notes,
          freshnessSeed: requestFreshnessSeed
        });

        const repairResults = await generateBatchWithRetry(provider, {
          system: repairPrompt.system,
          user: repairPrompt.user,
          temperature: 0.7,
          maxTokens: MAX_GENERATION_TOKENS,
          count: initialValidation.invalidItems.length
        }, "候选修复");
        logInfo("generate-openings", "repair batch completed", {
          traceId,
          requestId: generationRequest.id,
          candidateCount: repairResults.length,
          lengths: repairResults.map((result) => result.text.length)
        });

        const repairContents = repairResults.map((result) => result.text);
        const repairValidation = validateBatchContents(repairContents, initialValidation.invalidItems, normalizedInput);
        logInfo("generate-openings", "repair validation finished", {
          traceId,
          requestId: generationRequest.id,
          validCount: repairValidation.validContents.length,
          invalidCount: repairValidation.invalidItems.length,
          invalidReasons: repairValidation.invalidItems.map((item) => item.reason)
        });

        if (repairValidation.invalidItems.length > 0) {
          logWarn("generate-openings", "repair batch still invalid, switching to fallback", {
            traceId,
            requestId: generationRequest.id,
            invalidCount: repairValidation.invalidItems.length
          });
          generationState = "fallback";
      finalContents = buildFallbackCandidates(
        generationRequest.id,
        normalizedInput,
        analysis,
        candidatePlans,
        requestFreshnessSeed,
        recentOutputMemory
      ).map(
          (candidate) => candidate.content
        );
        } else {
          const mergedContents: string[] = [];

          initialContents.forEach((content, index) => {
            const reason = getValidationReason(content, normalizedInput);
            if (reason) {
              mergedContents[index] = normalizeOpeningText(repairContents[index] ?? repairContents[0] ?? content);
              return;
            }

            mergedContents[index] = normalizeOpeningText(content);
          });

          finalContents = mergedContents;
          generationState = generationState === "mock" ? "mock" : "recovered";
        }
      }
    } catch (error) {
      logWarn("generate-openings", "batch generation failed, switching to fallback", {
        traceId,
        requestId: generationRequest.id,
        error: summarizeError(error)
      });
      generationState = "fallback";
      finalContents = buildFallbackCandidates(
        generationRequest.id,
        normalizedInput,
        analysis,
        candidatePlans,
        requestFreshnessSeed,
        recentOutputMemory
      ).map(
          (candidate) => candidate.content
        );
    }

    logInfo("generate-openings", "final contents prepared", {
      traceId,
      requestId: generationRequest.id,
      lengths: finalContents.map((content) => content.length)
    });

    const generatedCandidates: GeneratedOpeningCandidate[] = finalContents.map((content, index) => {
      const plan = candidatePlans[index];

      return candidateSeed(
        plan?.strategyType ?? "statement",
        plan?.openingStrategy ?? `候选${index + 1}`,
        plan?.styleLabel ?? plan?.openingStrategy ?? `候选${index + 1}`,
        normalizeOpeningText(content),
        0,
        generationRequest.id,
        index + 1
      );
    });
    logInfo("generate-openings", "candidate seeds created", {
      traceId,
      requestId: generationRequest.id,
      candidateCount: generatedCandidates.length,
      strategies: generatedCandidates.map((candidate) => ({
        strategyType: candidate.strategyType,
        openingStrategy: candidate.openingStrategy,
        rankOrder: candidate.rankOrder
      }))
    });

    const diversifiedCandidatesResult = await reinforceSentenceDiversity(
      generatedCandidates,
      candidatePlans,
      analysis,
      normalizedInput,
      generationRequest.id,
      provider,
      traceId,
      recentOutputMemory,
      requestFreshnessSeed
    );
    const hardConstraintResult = enforceRecentOutputHardConstraint({
      traceId,
      generationRequestId: generationRequest.id,
      analysis,
      rawInput: normalizedInput,
      candidatePlans,
      candidateContents: diversifiedCandidatesResult.candidates.map((candidate) => candidate.content),
      recentMemory: recentOutputMemory,
      freshnessSeed: requestFreshnessSeed
    });
    const diversifiedCandidates = hardConstraintResult.candidateContents.map((content, index) => ({
      ...diversifiedCandidatesResult.candidates[index],
      content
    }));
    if (diversifiedCandidatesResult.usedFallback && generationState !== "mock") {
      generationState = generationState === "fallback" ? "fallback" : "recovered";
    }
    if (hardConstraintResult.replacementCount > 0) {
      logInfo("generate-openings", "recent-output hard constraint applied", {
        traceId,
        requestId: generationRequest.id,
        replacementCount: hardConstraintResult.replacementCount,
        remainingCollisions: hardConstraintResult.remainingCollisions
      });
    }
    if (hardConstraintResult.remainingCollisions > 0) {
      throw new Error("跨请求去重门禁未通过，切换到更强兜底生成。");
    }

    const ruleBasedEvaluations = diversifiedCandidates.map((candidate) =>
      buildRuleBasedOpeningEvaluation(candidate.content, {
        rawInput: normalizedInput,
        analysis,
        strategyType: candidate.strategyType,
        modelName: provider.modelName
      })
    );
    logInfo("generate-openings", "rule-based evaluation prepared", {
      traceId,
      requestId: generationRequest.id,
      scores: ruleBasedEvaluations.map((evaluation) => evaluation.totalScore),
      source: "rule"
    });

    const candidatesWithEvaluation = diversifiedCandidates.map((candidate, index) => ({
      ...candidate,
      evaluation: ruleBasedEvaluations[index] ?? createNeutralEvaluation(provider.modelName)
    }));

      const feedbackWeights = await loadFeedbackWeightsForGuest(traceId, input.guestId);
      const preferenceProfile = await loadPreferenceProfileForGuest(input.guestId);
      const ranked = rankCandidates(
        candidatesWithEvaluation,
        analysis,
      strategies,
      preferenceProfile,
      feedbackWeights
    );
    logInfo("generate-openings", "ranking completed", {
      traceId,
      requestId: generationRequest.id,
      order: ranked.map((candidate) => ({
        id: candidate.id,
        strategyType: candidate.strategyType,
        finalScore: candidate.qualityScore
      }))
    });

    await createUsageRecord({
      guestId: input.guestId,
      actionType: "generate_openings",
      usageDate,
      creditsUsed: 1,
      generationRequestId: generationRequest.id
    }).catch((error) => {
      logWarn("generate-openings", "failed to record usage", {
        traceId,
        requestId: generationRequest.id,
        error: summarizeError(error)
      });
    });
    usageRecorded = true;

    const finishedAt = Date.now();
    await updateGenerationRequest(generationRequest.id, {
      latencyMs: finishedAt - generationStartedAt,
      status: "completed",
      errorMessage: null
    }).catch((error) => {
      logWarn("generate-openings", "failed to update completed request", {
        traceId,
        requestId: generationRequest.id,
        error: summarizeError(error)
      });
    });
    requestCompleted = true;

    const candidatePayload = ranked.map((candidate) => ({
      id: candidate.id,
      rankOrder: candidate.rankOrder,
      openingStrategy: candidate.openingStrategy,
      strategyType: candidate.strategyType,
      styleLabel: candidate.styleLabel,
      content: candidate.content,
      qualityScore: candidate.qualityScore,
      evaluation: candidate.evaluation,
      isCopied: candidate.isCopied,
      isSelected: candidate.isSelected
    }));

    let responseCandidates: OpeningCandidateResponse[] = candidatePayload.map(({ id, strategyType, openingStrategy, styleLabel, content, qualityScore, evaluation, isCopied, isSelected }) => ({
      id,
      strategyType,
      openingStrategy,
      styleLabel,
      content,
      qualityScore,
      evaluation,
      isCopied,
      isSelected
    }));
    try {
      const persistedCandidates = await createOpeningCandidates(generationRequest.id, candidatePayload);
      responseCandidates = persistedCandidates.map((candidate) => ({
        id: candidate.id,
        strategyType: candidate.strategyType,
        openingStrategy: candidate.openingStrategy,
        styleLabel: candidate.styleLabel,
        content: candidate.content,
        qualityScore: candidate.qualityScore,
        evaluation: candidate.evaluation ?? null,
        isCopied: candidate.isCopied,
        isSelected: candidate.isSelected
      }));
      logInfo("generate-openings", "candidates persisted", {
        traceId,
        requestId: generationRequest.id,
        candidateCount: responseCandidates.length
      });
    } catch (error) {
      logWarn("generate-openings", "failed to persist candidates, returning in-memory candidates", {
        traceId,
        requestId: generationRequest.id,
        error: summarizeError(error)
      });
    }

    logInfo("generate-openings", "request finished", {
      traceId,
      requestId: generationRequest.id,
      candidateCount: responseCandidates.length,
      usageRemaining: Math.max(0, DAILY_GUEST_LIMIT - currentUsage - 1)
    });

    logInfo("generate-openings", "background evaluation scheduled", {
      traceId,
      requestId: generationRequest.id,
      generationState
    });
    scheduleBackgroundEvaluationRefresh({
      traceId,
      generationRequestId: generationRequest.id,
      provider,
      generationState,
      rawInput: normalizedInput,
      analysis,
      candidateRows: ranked,
      styleOptions: input.styleOptions
    });

    return {
      requestId: generationRequest.id,
      analysis,
      candidates: responseCandidates,
      usageRemaining: Math.max(0, DAILY_GUEST_LIMIT - currentUsage - 1),
      providerName: provider.providerName,
      modelName: provider.modelName,
      llmMode: provider.llmMode === "mock" ? "mock" : generationState === "fallback" ? "fallback" : "real",
      generationState,
      evaluationState: provider.llmMode === "mock" ? "mock" : "pending"
    };
  } catch (error) {
    logError("generate-openings", "falling back after error", {
      traceId,
      requestId: generationRequest.id,
      error: summarizeError(error)
    });

    try {
      const fallbackCandidates = buildFallbackCandidates(
        generationRequest.id,
        normalizedInput,
        analysis,
        candidatePlans,
        requestFreshnessSeed,
        recentOutputMemory
      );
      const fallbackHardConstraint = enforceRecentOutputHardConstraint({
        traceId,
        generationRequestId: generationRequest.id,
        analysis,
        rawInput: normalizedInput,
        candidatePlans,
        candidateContents: fallbackCandidates.map((candidate) => candidate.content),
        recentMemory: recentOutputMemory,
        freshnessSeed: requestFreshnessSeed + 211
      });
      const gatedFallbackCandidates = fallbackHardConstraint.candidateContents.map((content, index) => ({
        ...fallbackCandidates[index],
        content
      }));
      if (fallbackHardConstraint.remainingCollisions > 0) {
        throw new Error("fallback release gate still collides with recent history");
      }

      const fallbackCandidatesWithEvaluation = gatedFallbackCandidates.map(
        (candidate) => ({
          ...candidate,
          evaluation: createNeutralEvaluation(provider.modelName)
        })
      );
      logInfo("generate-openings", "fallback candidates prepared", {
        traceId,
        requestId: generationRequest.id,
        candidateCount: fallbackCandidatesWithEvaluation.length
      });
      generationState = "fallback";
      const feedbackWeights = await loadFeedbackWeightsForGuest(traceId, input.guestId);
      const preferenceProfile = await loadPreferenceProfileForGuest(input.guestId).catch(() => null);
      const rankedFallback = rankCandidates(
        fallbackCandidatesWithEvaluation,
        analysis,
        strategies,
        preferenceProfile,
        feedbackWeights
      );

      if (!usageRecorded) {
        await createUsageRecord({
          guestId: input.guestId,
          actionType: "generate_openings",
          usageDate,
          creditsUsed: 1,
          generationRequestId: generationRequest.id
        }).catch((usageError) => {
          logWarn("generate-openings", "failed to record fallback usage", {
            traceId,
            requestId: generationRequest.id,
            error: summarizeError(usageError)
          });
        });
      }

      if (!requestCompleted) {
        await updateGenerationRequest(generationRequest.id, {
          latencyMs: Date.now() - generationStartedAt,
          status: "completed",
          errorMessage: null
        }).catch((requestError) => {
          logWarn("generate-openings", "failed to mark fallback request completed", {
            traceId,
            requestId: generationRequest.id,
            error: summarizeError(requestError)
          });
        });
      }

      const fallbackPayload = rankedFallback.map((candidate) => ({
        id: candidate.id,
        rankOrder: candidate.rankOrder,
        openingStrategy: candidate.openingStrategy,
        strategyType: candidate.strategyType,
        styleLabel: candidate.styleLabel,
        content: candidate.content,
        qualityScore: candidate.qualityScore,
        evaluation: candidate.evaluation,
        isCopied: candidate.isCopied,
        isSelected: candidate.isSelected
      }));

      let responseCandidates: OpeningCandidateResponse[] = fallbackPayload.map(
        ({ id, strategyType, openingStrategy, styleLabel, content, qualityScore, evaluation, isCopied, isSelected }) => ({
          id,
          strategyType,
          openingStrategy,
          styleLabel,
          content,
          qualityScore,
          evaluation,
          isCopied,
          isSelected
        })
      );
      try {
        const persistedCandidates = await createOpeningCandidates(generationRequest.id, fallbackPayload);
        responseCandidates = persistedCandidates.map((candidate) => ({
          id: candidate.id,
          strategyType: candidate.strategyType,
          openingStrategy: candidate.openingStrategy,
          styleLabel: candidate.styleLabel,
          content: candidate.content,
          qualityScore: candidate.qualityScore,
          evaluation: candidate.evaluation ?? null,
          isCopied: candidate.isCopied,
          isSelected: candidate.isSelected
        }));
        logInfo("generate-openings", "fallback candidates persisted", {
          traceId,
          requestId: generationRequest.id,
          candidateCount: responseCandidates.length
        });
      } catch (persistError) {
        logWarn("generate-openings", "failed to persist fallback candidates, returning in-memory candidates", {
          traceId,
          requestId: generationRequest.id,
          error: summarizeError(persistError)
        });
      }

      logInfo("generate-openings", "fallback request finished", {
        traceId,
        requestId: generationRequest.id,
        candidateCount: responseCandidates.length,
        usageRemaining: Math.max(0, DAILY_GUEST_LIMIT - currentUsage - 1)
      });

      return {
        requestId: generationRequest.id,
        analysis,
        candidates: responseCandidates,
        usageRemaining: Math.max(0, DAILY_GUEST_LIMIT - currentUsage - 1),
        providerName: provider.providerName,
        modelName: provider.modelName,
        llmMode: provider.llmMode === "mock" ? "mock" : "fallback",
        generationState: "fallback",
        evaluationState: "fallback"
      };
    } catch (fallbackError) {
      const fallbackErrorSummary = summarizeError(fallbackError);
      const failureMessage = sanitizeFailureMessage(
        fallbackErrorSummary.message || "模型暂时不可用，请稍后再试。"
      );

      await updateGenerationRequest(generationRequest.id, {
        status: "failed",
        errorMessage: failureMessage
      }).catch(() => {
        // Best-effort update so failed requests do not remain in running.
      });

      logError("generate-openings", "terminal failure", {
        traceId,
        requestId: generationRequest.id,
        failureMessage,
        error: summarizeError(fallbackError)
      });

      throw new Error("模型暂时不可用，请稍后再试。");
    }
  }
}

function sanitizeFailureMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "模型暂时不可用，请稍后再试。";
}
