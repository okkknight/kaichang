import type { ContentType, InputAnalysisResult } from "@/server/opening/types";

const NOVEL_HINTS = ["小说", "故事", "人物", "角色", "情节", "自白", "独白"];
const ESSAY_HINTS = ["随笔", "散文", "日记", "感想", "记录"];
const ARTICLE_HINTS = ["公众号", "小红书", "推文", "文章", "内容", "文案"];

const STYLE_HINT_RULES: Array<{ keywords: string[]; style: string }> = [
  { keywords: ["抓人", "钩子", "吸引", "吸睛"], style: "抓人" },
  { keywords: ["画面", "场景", "镜头", "细节"], style: "画面" },
  { keywords: ["氛围", "气息", "余味"], style: "氛围" },
  { keywords: ["克制", "不矫情", "平静", "淡淡"], style: "克制" },
  { keywords: ["文学", "意象"], style: "文学感" },
  { keywords: ["小说", "故事"], style: "小说感" },
  { keywords: ["随笔", "日记"], style: "随笔感" },
  { keywords: ["公众号"], style: "公众号感" },
  { keywords: ["小红书"], style: "小红书感" }
];

function normalizeInput(rawInput: string) {
  return rawInput.replace(/\s+/g, " ").trim();
}

function matchKeywords(input: string, keywords: string[]) {
  return keywords.some((keyword) => input.includes(keyword));
}

function deriveContentType(input: string): ContentType {
  if (matchKeywords(input, NOVEL_HINTS)) return "novel";
  if (matchKeywords(input, ESSAY_HINTS)) return "essay";
  if (matchKeywords(input, ARTICLE_HINTS)) return "article";
  return "article";
}

function derivePreferredStyles(input: string) {
  const styles = STYLE_HINT_RULES.filter((rule) => matchKeywords(input, rule.keywords)).map((rule) => rule.style);
  return styles.length > 0 ? Array.from(new Set(styles)) : [];
}

function deriveLengthPreference(input: string): InputAnalysisResult["lengthPreference"] {
  if (matchKeywords(input, ["短一点", "更短", "简短", "一句"])) return "short";
  if (matchKeywords(input, ["长一点", "更长", "铺开", "展开", "细一点"])) return "long";
  return "medium";
}

export function analyzeInput(rawInput: string): InputAnalysisResult {
  const normalizedInput = normalizeInput(rawInput);

  return {
    rawInput: normalizedInput,
    contentType: deriveContentType(normalizedInput),
    preferredStyles: derivePreferredStyles(normalizedInput),
    lengthPreference: deriveLengthPreference(normalizedInput)
  };
}
