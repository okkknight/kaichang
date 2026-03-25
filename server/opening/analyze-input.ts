import type { InputAnalysisResult } from "@/server/opening/types";

const NOVEL_HINTS = ["小说", "故事", "人物", "角色", "情节", "女主", "男主", "船长", "世界观"];
const ESSAY_HINTS = ["随笔", "日记", "感想", "记录", "回忆", "散文", "沉默", "时间"];
const CONTENT_HINTS = ["公众号", "小红书", "文案", "推文", "标题", "爆款", "种草", "转发"];

const TONE_RULES: Array<{ keywords: string[]; tone: string }> = [
  { keywords: ["伤感", "失落", "沉默", "难过", "孤独", "低落"], tone: "伤感" },
  { keywords: ["克制", "压着", "平静", "不矫情", "淡淡"], tone: "克制" },
  { keywords: ["宿命", "命运", "注定", "预感", "终会"], tone: "宿命" },
  { keywords: ["热烈", "强烈", "激烈", "爆发", "燃"], tone: "强烈" },
  { keywords: ["冷静", "冷", "理性", "清醒"], tone: "冷静" },
  { keywords: ["画面", "氛围", "场景", "镜头", "海", "雨", "夜"], tone: "画面感" }
];

const NEED_RULES: Array<{ keywords: string[]; need: string }> = [
  { keywords: ["抓人", "吸引", "钩子", "带感", "吸睛"], need: "钩子" },
  { keywords: ["画面", "场景", "氛围", "镜头"], need: "画面" },
  { keywords: ["冲突", "对立", "矛盾", "反差"], need: "冲突" },
  { keywords: ["人物", "角色", "女主", "男主", "主角"], need: "人物" },
  { keywords: ["情绪", "情感", "伤感", "温柔"], need: "情绪" },
  { keywords: ["问题", "疑问", "提问"], need: "问题" }
];

function matchKeywords(input: string, keywords: string[]) {
  return keywords.some((keyword) => input.includes(keyword));
}

function deriveContentType(input: string): InputAnalysisResult["contentType"] {
  if (matchKeywords(input, NOVEL_HINTS)) {
    return "novel";
  }

  if (matchKeywords(input, CONTENT_HINTS)) {
    return "content";
  }

  if (matchKeywords(input, ESSAY_HINTS)) {
    return "essay";
  }

  return "mixed";
}

function deriveTones(input: string) {
  const tones = TONE_RULES.filter((rule) => matchKeywords(input, rule.keywords)).map((rule) => rule.tone);
  return tones.length > 0 ? tones : ["中性"];
}

function deriveNeeds(input: string) {
  const needs = NEED_RULES.filter((rule) => matchKeywords(input, rule.keywords)).map((rule) => rule.need);
  return needs.length > 0 ? needs : ["钩子", "情绪"];
}

function derivePreferredStyles(input: string) {
  const styles: string[] = [];

  if (matchKeywords(input, ["小说", "故事", "人物", "情节"])) styles.push("小说感");
  if (matchKeywords(input, ["随笔", "日记", "感想", "沉默"])) styles.push("随笔感");
  if (matchKeywords(input, ["公众号", "文案", "推文", "内容"])) styles.push("公众号感");
  if (matchKeywords(input, ["小红书", "种草", "生活方式"])) styles.push("小红书感");
  if (matchKeywords(input, ["文学", "诗", "意象", "散文"])) styles.push("文学感");
  if (matchKeywords(input, ["抓人", "钩子", "吸引"])) styles.push("抓人");
  if (matchKeywords(input, ["克制", "不矫情", "平静"])) styles.push("克制");
  if (matchKeywords(input, ["氛围", "画面", "镜头", "场景"])) styles.push("氛围");

  return styles.length > 0 ? Array.from(new Set(styles)) : ["抓人", "氛围"];
}

function deriveAudience(contentType: InputAnalysisResult["contentType"]) {
  switch (contentType) {
    case "novel":
      return "fiction_reader";
    case "essay":
      return "personal_expression";
    case "content":
      return "content_audience";
    default:
      return "general";
  }
}

function deriveLengthPreference(input: string): InputAnalysisResult["lengthPreference"] {
  if (matchKeywords(input, ["短一点", "更短", "简短", "一句", "短"])) return "short";
  if (matchKeywords(input, ["长一点", "更长", "展开", "铺陈", "细一点"])) return "long";
  return "medium";
}

export function analyzeInput(rawInput: string): InputAnalysisResult {
  const normalizedInput = rawInput.trim();
  const contentType = deriveContentType(normalizedInput);
  const tone = deriveTones(normalizedInput);
  const primaryNeeds = deriveNeeds(normalizedInput);
  const preferredStyles = derivePreferredStyles(normalizedInput);
  const lengthPreference = deriveLengthPreference(normalizedInput);

  return {
    contentType,
    tone,
    preferredStyles,
    primaryNeeds,
    audience: deriveAudience(contentType),
    lengthPreference,
    summary: `识别为${contentType === "novel" ? "小说" : contentType === "essay" ? "随笔" : contentType === "content" ? "内容文案" : "混合"}倾向，重点是${primaryNeeds.join("、")}。`
  };
}
