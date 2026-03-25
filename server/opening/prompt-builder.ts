import type { InputAnalysisResult, OpeningStrategyPlan } from "@/server/opening/types";

type BuildOpeningPromptInput = {
  rawInput: string;
  analysis: InputAnalysisResult;
  strategy: OpeningStrategyPlan;
  styleOptions: string[];
  candidateIndex: number;
};

export function buildOpeningPrompt({
  rawInput,
  analysis,
  strategy,
  styleOptions,
  candidateIndex
}: BuildOpeningPromptInput) {
  const styleList = styleOptions.length > 0 ? styleOptions.join("、") : analysis.preferredStyles.join("、");

  const system = [
    "你是《开场》产品的中文开头生成引擎。",
    "你的任务不是写整篇文章，而是只生成一个适合继续往下写的第一段或第一句开场。",
    "要求：",
    "1. 必须自然中文。",
    "2. 不要翻译腔，不要套话，不要空泛鸡汤。",
    "3. 不能解释自己的思路，不能输出标题、列表、标签、前言。",
    "4. 输出必须像真正的开头，不像中段总结。",
    "5. 候选之间需要明显不同。",
    "6. 优先保留画面、情绪、冲突或人物气质中的一个核心。",
    "7. 如果要求克制，就压住表达；如果要求抓人，就把开头钩子放前面。",
    "8. 只输出正文，不要加引号，不要加项目符号。"
  ].join("\n");

  const user = [
    "请根据以下信息生成一个开场候选：",
    `原始输入：${rawInput}`,
    `输入分析：${JSON.stringify(analysis)}`,
    `策略：${strategy.label}（${strategy.reason}）`,
    `策略角度：${strategy.angle}`,
    `风格偏好：${styleList || "自动判断"}`,
    `候选序号：${candidateIndex + 1}`,
    "",
    "输出要求：",
    `- 重点体现 ${strategy.label} 的入口方式。`,
    `- 生成长度建议：${strategy.lengthHint}`,
    "- 如果输入偏小说，要更像叙事开场。",
    "- 如果输入偏公众号或小红书，要更直接、更容易继续读下去。",
    "- 如果输入偏随笔，要保留克制和真实感。",
    "- 不要把用户原话生硬复述出来。"
  ].join("\n");

  return { system, user };
}
