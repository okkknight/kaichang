import type {
  InputAnalysisResult,
  OpeningBatchRepairSlot,
  OpeningBatchSlot,
  OpeningStrategyPlan
} from "@/server/opening/types";

type BuildOpeningPromptInput = {
  rawInput: string;
  strategy: OpeningStrategyPlan;
  styleOptions: string[];
  candidateIndex: number;
  attempt?: number;
  avoidOpenings?: string[];
};

type BuildMinimalOpeningBatchPromptInput = {
  rawInput: string;
  styleOptions: string[];
  candidateCount: number;
};

type BuildOpeningSingleCandidatePromptInput = {
  rawInput: string;
  styleOptions: string[];
  strategy: OpeningStrategyPlan;
  candidateIndex: number;
};

function buildLengthGuidance(lengthHint?: string) {
  return [
    "- 长度优先控制在 100-200 字，理想 120-180 字。",
    "- 写完一个完整开头就停，不要为了补背景继续展开。",
    "- 如果某个入口天然偏短或偏长，也要尽量收束在自然范围内，不要为了凑字数硬撑。",
    lengthHint ? `- 当前入口的长度倾向：${lengthHint}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function toLegacyStrategyLabel(strategyType: OpeningStrategyPlan["strategyType"]) {
  switch (strategyType) {
    case "scene":
      return "画面切入型";
    case "emotion":
      return "情绪切入型";
    case "question":
      return "提问切入型";
    case "statement":
      return "观点切入型";
    case "contrast":
      return "反差切入型";
    default:
      return "观点切入型";
  }
}

function describeSentenceShape(_strategyType: OpeningStrategyPlan["strategyType"], _expressionMode: OpeningStrategyPlan["expressionMode"]) {
  return "保持自然起笔，不要套固定句式。";
}

function buildOpeningAngleInstruction(strategy: OpeningStrategyPlan) {
  return strategy.entryAngle.description.replace(/[。！!？?]+$/u, "");
}

function extractOpeningCoreInput(rawInput: string) {
  const normalized = rawInput.trim().replace(/\s+/g, " ");
  const parts = normalized.split(/要求[:：]/u);
  const core = (parts[0] || normalized).trim();
  return core.replace(/[，,。！？!?；;、\s]+$/u, "").trim();
}

export function buildOpeningPrompt({
  rawInput,
  strategy,
  styleOptions,
  candidateIndex: _candidateIndex,
  attempt: _attempt = 0,
  avoidOpenings: _avoidOpenings = []
}: BuildOpeningPromptInput) {
  const styleList = styleOptions.length > 0 ? styleOptions.join("、") : "";

  const system = [
    "你是《开场》的中文第一段写作者。",
    `本次只写一条开头正文，切入口：${buildOpeningAngleInstruction(strategy)}。`,
    styleList ? `整体气质尽量偏向：${styleList}。` : "",
    "只输出正文，不要标题、列表、代码块、解释或总结。",
    "长度尽量控制在 100-200 字，写完一个完整开头就停。"
  ]
    .filter(Boolean)
    .join("\n");

  const user = rawInput.trim();

  return { system, user };
}

export function buildMinimalOpeningBatchPrompt({
  rawInput,
  styleOptions,
  candidateCount
}: BuildMinimalOpeningBatchPromptInput) {
  const styleList = styleOptions.length > 0 ? styleOptions.join("、") : "自动判断";

  const system = [
    "你是《开场》的中文第一段写作者。",
    `请调用名为 emit_opening_candidates 的工具，候选数量必须正好是 ${candidateCount} 条。`,
    "不要直接输出正文文本、标题、列表、代码块、解释、前言、总结或任何额外文字。",
    '工具参数格式必须是：{"candidates":[{"content":"第一条"},{"content":"第二条"}]}',
    "每个 content 只能是可直接展示的正文字符串，不要编号，不要换行，不要把输入说明写进正文。",
    `整体气质尽量偏向：${styleList}。`,
    "如果原始输入里已经带有题材、人物、情绪或风格要求，就直接遵守，不要再复述这些要求。",
    "每条开头都要自然、完整、中文优先。",
    "长度优先控制在 100-200 字，理想 120-180 字。"
  ].join("\n");

  const user = rawInput.trim();

  return { system, user };
}

export function buildOpeningBatchPrompt({
  rawInput,
  analysis,
  strategies,
  recentOutputNotes = [],
  freshnessSeed = 0
}: {
  rawInput: string;
  analysis: InputAnalysisResult;
  strategies: OpeningStrategyPlan[];
  recentOutputNotes?: string[];
  freshnessSeed?: number;
}) {
  const system = [
    "你是《开场》的中文开头生成器。",
    "只输出中文正文，不要输出解释、分析、思考过程、Markdown、代码块或多余文字。",
    "不要编号，不要标题，不要前言，不要使用英文。",
    "原始输入里如果有“要求 / 风格 / 长度 / 不要...”之类说明，只把它们当约束，不要复述到正文里。",
    `一次给出 ${strategies.length} 段不同的开头，段落之间空行分隔。`,
    "每段都要像真正的第一段开头，直接可展示。"
  ].join("\n");

  const user = [
    `题目核心：${extractOpeningCoreInput(rawInput)}`,
    "请直接写出不同的中文开头，候选之间用空行分隔。",
    "每条尽量控制在 100-200 字，理想 120-180 字，写完一个完整开头就停。",
    recentOutputNotes.length > 0 ? `避免和下面这些写法太像：${recentOutputNotes.slice(0, 2).join(" / ")}` : "",
    "不要复述任务，不要重复题目里的要求，不要出现填空式表达。"
  ].join("\n");

  return {
    system,
    user,
    slots: strategies.map((strategy, index) => ({
      strategyType: strategy.strategyType,
      openingStrategy: strategy.label,
      styleLabel: analysis.preferredStyles[index % Math.max(1, analysis.preferredStyles.length)] || strategy.label,
      angle: strategy.angle,
      lengthHint: strategy.lengthHint,
      expressionMode: strategy.expressionMode,
      entryAngle: strategy.entryAngle
    }))
  };
}

export function buildOpeningSingleCandidatePrompt({
  rawInput,
  styleOptions,
  strategy,
  candidateIndex
}: BuildOpeningSingleCandidatePromptInput) {
  const styleList = styleOptions.length > 0 ? styleOptions.join("、") : "自动判断";

  const system = [
    "你是《开场》的中文第一段写作者。",
    `请调用名为 emit_opening_candidates 的工具，候选数量必须正好是 1 条。`,
    `本次候选序号：第 ${candidateIndex + 1} 条。`,
    `本次切入口：${buildOpeningAngleInstruction(strategy)}。`,
    `整体气质尽量偏向：${styleList}。`,
    "不要直接输出正文文本、标题、列表、代码块、解释、前言、总结或任何额外文字。",
    '工具参数格式必须是：{"candidates":[{"content":"唯一候选"}]}',
    "每个 content 只能是可直接展示的正文字符串，不要编号，不要换行，不要把输入说明写进正文。",
    "只写一条候选，避免和输入里的连续原句片段太像。",
    buildLengthGuidance(strategy.lengthHint)
  ].join("\n");

  const user = [
    `原始输入：${rawInput.trim()}`,
    `题面核心：${extractOpeningCoreInput(rawInput)}`,
    `候选序号：${candidateIndex + 1}`,
    `策略类型：${strategy.strategyType}`,
    `策略名称：${strategy.label}`,
    `表达方式：${strategy.expressionMode}`,
    "请直接给出 1 条候选开头，禁止输出其他文字。"
  ].join("\n");

  return { system, user };
}

export function buildOpeningBatchRepairPrompt({
  rawInput,
  analysis,
  repairSlots,
  recentOutputNotes = [],
  freshnessSeed = 0
}: {
  rawInput: string;
  analysis: InputAnalysisResult;
  repairSlots: OpeningBatchRepairSlot[];
  recentOutputNotes?: string[];
  freshnessSeed?: number;
}) {
  const system = [
    "你是《开场》的批量开头修复器。",
    "你只允许输出 JSON，不要输出 Markdown、代码块、解释、推理过程或多余文字。",
    "必须严格返回一个对象：{\"candidates\":[{\"strategyType\":\"...\",\"openingStrategy\":\"...\",\"styleLabel\":\"...\",\"content\":\"...\"}]}。",
    "你只需要重写给定的修复项，不要复制原来的坏内容。",
    "content 只能是可直接展示的开头正文，不能包含分析、列表、标题、复述需求、元话术或推理过程。",
    "每条 content 必须是自然中文的单段文本，禁止换行，禁止空白，禁止前后附加说明。",
    "不要直接复用输入里的连续原句片段。",
    "只做可直接展示的正文修复，不要重新解释题目。"
  ].join("\n");

  const user = [
    "下面这些候选第一次生成不合格，请仅重写它们。",
    "",
    `原始输入：${rawInput}`,
    `风格偏好：${analysis.preferredStyles.join("、") || "自动判断"}`,
    "长度要求：",
    buildLengthGuidance(),
    recentOutputNotes.length > 0 ? `最近不要贴近这些写法：${recentOutputNotes.slice(0, 3).join(" / ")}` : "",
    "",
    "需要修复的候选：",
    repairSlots
      .map((slot, index) =>
        [
          `${index + 1}. ${slot.openingStrategy}`,
          `   strategyType：${slot.strategyType}`,
          `   风格：${slot.styleLabel}`,
          `   表达方式：${slot.expressionMode}`,
          `   句式方向：${describeSentenceShape(slot.strategyType, slot.expressionMode)}`,
          `   原因：${slot.reason}`,
          `   上一次输出：${slot.previousOutput}`
        ].join("\n")
      )
      .join("\n"),
    "",
    "修复要求：",
    "1. 只输出 JSON 对象。",
    "2. candidates 数组长度必须和需要修复的候选数量一致。",
    "3. 每个对象必须保留对应的 strategyType、openingStrategy 和 styleLabel，content 只写开头正文。",
    "4. 不要复述失败原因，不要解释，不要输出思考过程。",
    "5. 不要输出空字符串。",
    "6. 不要出现“xxx的内容”这种填空式表达。",
    "7. 不要直接复用输入里的连续原句片段。",
    "8. 这是开头，不是中段总结，不是背景说明。",
    "9. 重写时优先控制在 100-200 字之间。",
    "10. 不要为了压字数把语气砍断，也不要为了凑字数继续补背景。"
  ].join("\n");

  return { system, user };
}

export function buildOpeningCompressionPrompt({
  rawInput,
  originalContent,
  strategy,
  styleOptions,
  candidateIndex: _candidateIndex
}: {
  rawInput: string;
  originalContent: string;
  strategy: OpeningStrategyPlan;
  styleOptions: string[];
  candidateIndex: number;
}) {
  const styleList = styleOptions.length > 0 ? styleOptions.join("、") : "自动判断";

  const system = [
    "你是《开场》的中文开头压缩器。",
    "你只做压缩重写，不做扩写，不做解释，不做总结。",
    "目标是把开头收束到 100-200 字，尽量保留原意、入口和中文气质。",
    "只输出正文，不要标题、列表、引号、代码块或多余说明。",
    "不要把候选改成另一种完全不同的写法，只做更紧凑的收束。",
    "不要复述任务，不要提策略、风格、表达方式、入口方向。"
  ].join("\n");

  const user = [
    `用户原话：${rawInput}`,
    `整体气质：${styleList || "自动判断"}`,
    `这段开头原本偏向：${buildOpeningAngleInstruction(strategy)}。`,
    "原始开头：",
    originalContent,
    "",
    "压缩要求：",
    "- 请在不新增信息的前提下压缩这段开头。",
    "- 删掉重复背景、解释性铺陈和多余转折。",
    "- 保留原来的开头气质和主题方向。",
    "- 优先控制在 100-200 字之间。",
    "- 如果某个部分可以省略，就省略，不要硬撑字数。",
    "- 不要硬截断，不要用省略号糊住后半段。",
    "- 不要改变入口，不要改成另一种题材。",
    "- 不要把任务说明、风格说明或写法提示写回正文。",
    "- 只输出压缩后的正文。"
  ].join("\n");

  return { system, user };
}
