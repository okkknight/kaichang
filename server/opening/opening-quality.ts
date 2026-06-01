import type {
  InputAnalysisResult,
  OpeningQualityDimensions,
  OpeningQualityEvaluation,
  OpeningStrategyType
} from "@/server/opening/types";

const REQUEST_LEADS = [
  "我想",
  "请帮我",
  "帮我",
  "请写",
  "写一个",
  "写一篇",
  "写一段",
  "生成",
  "做一个",
  "想写",
  "我要写"
];

const GENERIC_REQUEST_WORDS = [
  "小说开头",
  "文章开头",
  "随笔开头",
  "开头",
  "开场",
  "故事",
  "文章",
  "随笔",
  "文案",
  "内容"
];

const OPENING_SUMMARY_MARKERS = [
  "总的来说",
  "综上",
  "综上所述",
  "总结",
  "概括",
  "不难发现",
  "本文",
  "这篇",
  "这一段",
  "要知道",
  "我们可以看到"
];

const MID_PARAGRAPH_MARKERS = [
  "随后",
  "接着",
  "接下来",
  "与此同时",
  "于是",
  "因此",
  "后来",
  "回到",
  "事实上",
  "归根到底",
  "总之"
];

const META_TASK_MARKERS = [
  "用户要求",
  "用户之前",
  "用户说",
  "试试这个",
  "试着从",
  "让我尝试",
  "场景构思",
  "问题要短准",
  "整体气质",
  "第一句话要",
  "主题是：",
  "骨架",
  "写作要求",
  "只输出正文",
  "保持自然起笔",
  "从肩膀入手"
];

const IMAGERY_FAMILIES = [
  {
    name: "sea",
    triggers: ["海", "船", "航海", "甲板", "潮汐", "港口", "海风", "浪", "帆"],
    forbidden: ["海风", "航海", "甲板", "潮汐", "港口", "船舷", "帆影", "浪声"]
  },
  {
    name: "rain",
    triggers: ["雨", "雨夜", "伞", "水汽", "雨声", "雨点"],
    forbidden: ["雨夜", "雨声", "雨点", "水汽", "雨幕", "伞面"]
  },
  {
    name: "night",
    triggers: ["夜", "深夜", "凌晨", "黑夜", "夜色", "灯火"],
    forbidden: ["夜色", "凌晨", "灯火", "霓虹", "黑夜"]
  },
  {
    name: "sky",
    triggers: ["天空", "星", "月", "星光", "月光", "银河"],
    forbidden: ["星光", "月光", "银河", "天幕"]
  }
] as const;

const STRATEGY_GUIDES: Record<
  OpeningStrategyType,
  {
    instruction: string;
    antiPattern: string;
  }
> = {
  scene: {
    instruction: "从具体场景、动作、空间或细节开场，让读者先看见画面。",
    antiPattern: "不要写成环境介绍或中段铺陈。",
  },
  emotion: {
    instruction: "从情绪、心理状态、压迫感或克制感开场，让读者先感受到气氛。",
    antiPattern: "不要把情绪写成抽象总结。",
  },
  question: {
    instruction: "用一个紧扣主题的问题开场，让读者自然想继续往下读。",
    antiPattern: "不要写成空泛提问或标题党追问。",
  },
  statement: {
    instruction: "用一个有判断力的陈述开场，直接建立立场、冲突或主题。",
    antiPattern: "不要写成说明书或概括段。",
  },
  contrast: {
    instruction: "用反差、对照或不一致制造入口，但反差必须服务主题。",
    antiPattern: "不要为了猎奇硬造反转。",
  }
};

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function stripRequestLead(text: string) {
  let result = normalizeText(text);

  for (const lead of REQUEST_LEADS) {
    result = result.replace(new RegExp(`^${lead}`), "");
  }

  result = result.replace(/^请+/g, "").replace(/^帮我+/g, "").trim();

  return result;
}

function stripGenericEndings(text: string) {
  let result = normalizeText(text);

  for (const suffix of GENERIC_REQUEST_WORDS) {
    result = result.replace(new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9]{2,36}?)的?${suffix}$`), "$1");
  }

  result = result
    .replace(/的?小说开头$/, "")
    .replace(/的?文章开头$/, "")
    .replace(/的?随笔开头$/, "")
    .replace(/的?故事$/, "")
    .replace(/的?文章$/, "")
    .replace(/的?随笔$/, "")
    .replace(/的?文案$/, "")
    .replace(/的?内容$/, "")
    .trim();

  return result;
}

function extractThemeAnchor(rawInput: string) {
  const normalized = normalizeText(rawInput);
  const aboutMatch = normalized.match(/关于([^，。！？]+)/);
  if (aboutMatch?.[1]) {
    return stripGenericEndings(aboutMatch[1]);
  }

  const leadFree = stripRequestLead(normalized);
  const firstClause = leadFree.split(/[，。！？；;]/)[0]?.trim() || leadFree;
  const cleaned = stripGenericEndings(firstClause);

  return cleaned || normalized.slice(0, 18);
}

function hasAny(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(term));
}

function buildForbiddenImagery(rawInput: string) {
  const source = normalizeText(rawInput);

  return IMAGERY_FAMILIES.flatMap((family) =>
    hasAny(source, family.triggers) ? [] : family.forbidden
  );
}

function splitAnchorTokens(anchor: string) {
  return anchor
    .split(/[、，,\/\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function countSentenceBreaks(text: string) {
  return text.split(/[。！？!?]/).map((part) => part.trim()).filter(Boolean).length;
}

function getPreferredSentenceRange(
  strategyType: OpeningStrategyType,
  analysis: InputAnalysisResult
): { min: number; max: number } {
  const preferLongForm =
    analysis.lengthPreference === "long" ||
    analysis.contentType === "novel" ||
    (analysis.contentType === "essay" && strategyType !== "question");

  switch (strategyType) {
    case "scene":
      return preferLongForm ? { min: 4, max: 6 } : { min: 3, max: 5 };
    case "emotion":
      return preferLongForm ? { min: 4, max: 5 } : { min: 3, max: 4 };
    case "question":
      return preferLongForm ? { min: 2, max: 4 } : { min: 1, max: 3 };
    case "statement":
      return preferLongForm ? { min: 3, max: 5 } : { min: 2, max: 4 };
    case "contrast":
      return preferLongForm ? { min: 4, max: 6 } : { min: 3, max: 5 };
    default:
      return { min: 2, max: 5 };
  }
}

export function buildOpeningTopicFrame(rawInput: string, analysis?: InputAnalysisResult) {
  const topicAnchor = normalizeText(extractThemeAnchor(rawInput));
  const anchorTokens = Array.from(new Set([
    ...splitAnchorTokens(topicAnchor),
    ...rawInput
      .split(/[，。！？!?；;、\s]+/)
      .map((part) => stripGenericEndings(stripRequestLead(part)))
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
      .slice(0, 12)
  ]));
  const forbiddenImagery = buildForbiddenImagery(rawInput);

  return {
    themeAnchor: topicAnchor,
    anchorTokens,
    forbiddenImagery,
    contentType: analysis?.contentType,
    coreIntent: normalizeText(rawInput),
    lengthPreference: analysis?.lengthPreference ?? "medium"
  };
}

function extractSourceEchoPhrases(rawInput: string) {
  const normalized = stripRequestLead(rawInput);
  const phrases = new Set<string>();

  const segments = normalized
    .split(/[。！？!?；;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6);

  for (const segment of segments) {
    phrases.add(segment);
  }

  const aboutMatch = normalized.match(/关于([^，。！？]+)/);
  if (aboutMatch?.[1] && aboutMatch[1].trim().length >= 6) {
    phrases.add(aboutMatch[1].trim());
  }

  const leadClause = normalized.split(/[，,]/)[0]?.trim();
  if (leadClause && leadClause.length >= 8) {
    phrases.add(leadClause);
  }

  return Array.from(phrases).slice(0, 6);
}

export function detectSourceEchoTrace(content: string, rawInput: string) {
  const text = normalizeText(content);
  const sourcePhrases = extractSourceEchoPhrases(rawInput);
  const hits = sourcePhrases.filter((phrase) => phrase.length >= 6 && text.includes(phrase));

  return {
    isSourceEchoLike: hits.length > 0,
    hits
  };
}

export function getStrategyGuide(strategyType: OpeningStrategyType) {
  return STRATEGY_GUIDES[strategyType];
}

const TEMPLATE_PHRASES = [
  "的内容",
  "xxx",
  "XXX",
  "某某",
  "变量",
  "模板",
  "填空",
  "{",
  "}",
  "<",
  ">"
];

const TEMPLATE_FRAME_PATTERNS = [
  /^真正难的从来不是[^，。！？]{2,18}，而是/,
  /^越是看起来[^，。！？]{2,18}，越容易/,
  /^当[^，。！？]{2,18}第一次真正被看见时/,
  /^很多时候，[^，。！？]{2,18}不是先/,
  /^关于[^，。！？]{2,18}，最容易被忽略的/,
  /^表面上像一件普通的[^，。！？]{2,18}，实际/,
  /^如果[^，。！？]{2,18}真的/,
  /^为什么明明是[^，。！？]{2,18}，却/
];

export function detectTemplateTrace(content: string) {
  const text = normalizeText(content);
  const phraseHits = TEMPLATE_PHRASES.filter((phrase) => text.includes(phrase));
  const frameHits = TEMPLATE_FRAME_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);

  return {
    isTemplateLike: phraseHits.length > 0 || frameHits.length > 0,
    phraseHits,
    frameHits
  };
}

export function scoreOpeningQuality(
  content: string,
  context: {
    rawInput: string;
    analysis: InputAnalysisResult;
    strategyType: OpeningStrategyType;
  }
) {
  const text = normalizeText(content);
  const frame = buildOpeningTopicFrame(context.rawInput, context.analysis);
  const templateTrace = detectTemplateTrace(text);
  const sourceEchoTrace = detectSourceEchoTrace(text, context.rawInput);
  const issues: string[] = [];
  let scoreDelta = 0;

  const topicMatches =
    frame.anchorTokens.filter((token) => text.includes(token)).length +
    frame.anchorTokens.filter((token) => token.length >= 2 && text.includes(token)).length;
  const intentHits = normalizeText(context.rawInput)
    .split(/[，。！？!?；;、\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 8)
    .filter((part) => text.includes(part)).length;

  if (topicMatches > 0 || intentHits > 0) {
    scoreDelta += Math.min(24, 10 + topicMatches * 3 + intentHits * 2);
  } else {
    scoreDelta -= 28;
    issues.push("主题贴合度不足");
  }

  const forbiddenHits = frame.forbiddenImagery.filter((term) => text.includes(term));
  if (forbiddenHits.length > 0) {
    scoreDelta -= Math.min(16, forbiddenHits.length * 6);
    issues.push(`无关意象：${forbiddenHits.slice(0, 3).join("、")}`);
  }

  const rawSpecificTokens = frame.anchorTokens.filter((token) => token.length >= 3 && text.includes(token));
  if (rawSpecificTokens.length > 0) {
    scoreDelta += Math.min(12, rawSpecificTokens.length * 3);
  }

  const summaryHits = OPENING_SUMMARY_MARKERS.filter((marker) => text.includes(marker));
  if (summaryHits.length > 0) {
    scoreDelta -= Math.min(20, summaryHits.length * 8);
    issues.push("像总结而不是开头");
  }

  const metaTaskHits = META_TASK_MARKERS.filter((marker) => text.includes(marker));
  if (metaTaskHits.length > 0) {
    scoreDelta -= Math.min(30, metaTaskHits.length * 10);
    issues.push(`任务说明腔：${metaTaskHits.slice(0, 2).join("、")}`);
  }

  const midParagraphHits = MID_PARAGRAPH_MARKERS.filter((marker) => text.includes(marker));
  if (midParagraphHits.length > 0) {
    scoreDelta -= Math.min(14, midParagraphHits.length * 5);
    issues.push("像中段承接而不是开头");
  }

  const sentenceCount = countSentenceBreaks(text);
  const preferredRange = getPreferredSentenceRange(context.strategyType, context.analysis);
  if (sentenceCount < preferredRange.min) {
    scoreDelta -= 4;
    issues.push(`长度偏短（${sentenceCount} 句）`);
  } else if (sentenceCount > preferredRange.max) {
    scoreDelta -= 4;
    issues.push(`句子偏多（${sentenceCount} 句）`);
  } else {
    scoreDelta += 6;
  }

  if (templateTrace.isTemplateLike) {
    scoreDelta -= 22;
    issues.push("模板化表达");
  }

  if (sourceEchoTrace.isSourceEchoLike) {
    scoreDelta -= 26;
    issues.push(`原句回声：${sourceEchoTrace.hits.slice(0, 2).join("、")}`);
  }

  const abstractionHits = ["某种", "一种", "这个故事", "这个主题", "主题锚点", "叙事起点", "写作分析"].filter((marker) =>
    text.includes(marker)
  );
  if (abstractionHits.length > 0) {
    scoreDelta -= Math.min(20, abstractionHits.length * 7);
    issues.push(`抽象化表达：${abstractionHits.slice(0, 3).join("、")}`);
  }

  if (text.length < 24) {
    scoreDelta -= 3;
    issues.push("长度略短");
  }

  if (/^\s*(?:在这个|随着|首先|其次|最后|总的来说|本文|这篇|我们可以|可以说)/.test(text)) {
    scoreDelta -= 14;
    issues.push("开头像总结段");
  }

  if (context.strategyType === "question" && !/[？?]/.test(text)) {
    scoreDelta -= 6;
    issues.push("提问策略缺少问句");
  }

  if (context.strategyType === "scene" && !/[海风雨夜灯火窗门街巷车]/.test(text)) {
    scoreDelta -= 4;
  }

  return {
    scoreDelta,
    issues,
    themeAnchor: frame.themeAnchor,
    forbiddenImagery: frame.forbiddenImagery,
    templateTrace,
    sourceEchoTrace,
    topicMatches,
    intentHits
  };
}

function clampDimension(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function buildRuleDimensions(input: {
  text: string;
  strategyType: OpeningStrategyType;
  scoreDelta: number;
  issues: string[];
  templateTrace: ReturnType<typeof detectTemplateTrace>;
  sourceEchoTrace: ReturnType<typeof detectSourceEchoTrace>;
  themeAnchor: string;
  forbiddenImagery: string[];
}) {
  const text = input.text;
  const hasQuestion = /[？?]/.test(text);
  const hasImagery = /[海雨风灯车门窗手眼夜街船影]/.test(text);
  const emotionalSignals = /心|沉默|难过|克制|安静|空|热|冷|压迫|呼吸/.test(text);
  const themeMatches = input.themeAnchor
    .split(/[、，,\/\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .filter((part) => text.includes(part)).length;
  const penalty = input.issues.length + input.forbiddenImagery.filter((term) => text.includes(term)).length;

  const hookStrength =
    3 +
    (hasQuestion ? 1 : 0) +
    (input.strategyType === "contrast" ? 1 : 0) +
    (input.strategyType === "statement" ? 1 : 0) -
    (input.templateTrace.isTemplateLike ? 1 : 0) -
    (input.sourceEchoTrace.isSourceEchoLike ? 1 : 0);

  const clarity =
    3 +
    (input.scoreDelta > 0 ? 1 : 0) -
    (input.templateTrace.isTemplateLike ? 1 : 0) -
    (penalty > 1 ? 1 : 0);

  const novelty =
    3 +
    (input.sourceEchoTrace.isSourceEchoLike ? -2 : 1) +
    (input.templateTrace.isTemplateLike ? -2 : 0) +
    (input.scoreDelta > 6 ? 1 : 0);

  const emotionalResonance =
    3 +
    (emotionalSignals ? 1 : 0) +
    (input.strategyType === "emotion" ? 1 : 0) -
    (input.templateTrace.isTemplateLike ? 1 : 0);

  const visualImagery =
    3 +
    (hasImagery ? 1 : 0) +
    (input.strategyType === "scene" ? 1 : 0) -
    (input.forbiddenImagery.some((term) => text.includes(term)) ? 1 : 0);

  const thematicFit =
    3 +
    (themeMatches > 0 ? 1 : 0) +
    (input.scoreDelta > 4 ? 1 : 0) -
    (input.sourceEchoTrace.isSourceEchoLike ? 1 : 0);

  return {
    hookStrength: clampDimension(hookStrength),
    clarity: clampDimension(clarity),
    novelty: clampDimension(novelty),
    emotionalResonance: clampDimension(emotionalResonance),
    visualImagery: clampDimension(visualImagery),
    thematicFit: clampDimension(thematicFit)
  } satisfies OpeningQualityDimensions;
}

export function buildRuleBasedOpeningEvaluation(
  content: string,
  context: {
    rawInput: string;
    analysis: InputAnalysisResult;
    strategyType: OpeningStrategyType;
    modelName?: string;
  }
): OpeningQualityEvaluation {
  const quality = scoreOpeningQuality(content, {
    rawInput: context.rawInput,
    analysis: context.analysis,
    strategyType: context.strategyType
  });

  const dimensions = buildRuleDimensions({
    text: normalizeText(content),
    strategyType: context.strategyType,
    scoreDelta: quality.scoreDelta,
    issues: quality.issues,
    templateTrace: quality.templateTrace,
    sourceEchoTrace: quality.sourceEchoTrace,
    themeAnchor: quality.themeAnchor,
    forbiddenImagery: quality.forbiddenImagery
  });

  const totalScore = Math.max(0, Math.min(100, Math.round(60 + quality.scoreDelta)));
  const strengths = [
    quality.themeAnchor ? `贴合${quality.themeAnchor.slice(0, 8)}` : "主题贴合",
    dimensions.hookStrength >= 4 ? "开头有抓力" : "表达自然"
  ].slice(0, 2);
  const weaknesses = quality.issues.slice(0, 2);

  return {
    totalScore,
    dimensions,
    summary: quality.issues.length > 0 ? `规则评估：${quality.issues.join("，")}` : "规则评估：整体较稳，适合继续保留。",
    strengths,
    weaknesses: weaknesses.length > 0 ? weaknesses : ["可继续等待后台 LLM 评估补强"],
    source: "rule",
    modelName: context.modelName
  };
}

export function describeStrategyGuide(strategyType: OpeningStrategyType) {
  const guide = getStrategyGuide(strategyType);
  return [
    `策略类型：${strategyType}`,
    `写法要求：${guide.instruction}`,
    `不要：${guide.antiPattern}`
  ].join("\n");
}
