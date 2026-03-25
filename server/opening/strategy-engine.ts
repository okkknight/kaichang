import type { InputAnalysisResult, OpeningStrategyPlan } from "@/server/opening/types";

const STRATEGIES: OpeningStrategyPlan[] = [
  {
    key: "scene",
    label: "画面切入型",
    reason: "用具体场景和空间感先把读者拉进去。",
    angle: "从一个可视化画面开始，先让人看见，再让人理解。",
    lengthHint: "优先中等长度，留出镜头感和细节。"
  },
  {
    key: "emotion",
    label: "情绪切入型",
    reason: "先把情绪拎出来，再去铺事实。",
    angle: "从心理状态、情绪波动或氛围变化进入。",
    lengthHint: "短到中等，尽量让第一句有温度。"
  },
  {
    key: "conflict",
    label: "冲突切入型",
    reason: "通过矛盾、反差或未解问题制造抓力。",
    angle: "直接把冲突摆在前面，不先解释太多。",
    lengthHint: "中等偏短，保持冲力。"
  },
  {
    key: "question",
    label: "提问切入型",
    reason: "用问题快速建立阅读动机。",
    angle: "让开场像一个用户会想继续追问的入口。",
    lengthHint: "短一些，强调节奏和抓人。"
  },
  {
    key: "character",
    label: "人物状态切入型",
    reason: "先写人，再写事。",
    angle: "从人物的动作、习惯、姿态或状态出发。",
    lengthHint: "中等长度，强调人物立场和气质。"
  },
  {
    key: "contrast",
    label: "反差切入型",
    reason: "通过不一致制造记忆点。",
    angle: "让开头有一点出人意料的对照或反向预期。",
    lengthHint: "短中皆可，重点是反差要成立。"
  },
  {
    key: "detail",
    label: "日常细节切入型",
    reason: "从不起眼的细节里建立真实感。",
    angle: "用一个细节把氛围慢慢托起来。",
    lengthHint: "偏短，重质感，不堆叙述。"
  }
];

function hasAny(input: string[], values: string[]) {
  return input.some((value) => values.includes(value));
}

function uniqueByLabel(items: OpeningStrategyPlan[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

export function chooseOpeningStrategies(
  analysis: InputAnalysisResult,
  styleOptions: string[],
  candidateCount: number
): OpeningStrategyPlan[] {
  const pool: OpeningStrategyPlan[] = [];

  if (analysis.contentType === "novel") {
    pool.push(
      STRATEGIES[0],
      STRATEGIES[4],
      STRATEGIES[2],
      STRATEGIES[5]
    );
  } else if (analysis.contentType === "essay") {
    pool.push(STRATEGIES[1], STRATEGIES[6], STRATEGIES[0], STRATEGIES[3]);
  } else if (analysis.contentType === "content") {
    pool.push(STRATEGIES[3], STRATEGIES[5], STRATEGIES[2], STRATEGIES[6]);
  } else {
    pool.push(STRATEGIES[0], STRATEGIES[1], STRATEGIES[2], STRATEGIES[4], STRATEGIES[6]);
  }

  if (hasAny(styleOptions, ["抓人", "公众号感", "小红书感"])) {
    pool.unshift(STRATEGIES[3], STRATEGIES[5]);
  }

  if (hasAny(styleOptions, ["氛围", "文学感"])) {
    pool.unshift(STRATEGIES[0], STRATEGIES[1], STRATEGIES[6]);
  }

  if (hasAny(styleOptions, ["克制", "随笔感"])) {
    pool.unshift(STRATEGIES[1], STRATEGIES[6]);
  }

  if (analysis.primaryNeeds.includes("冲突")) {
    pool.unshift(STRATEGIES[2]);
  }

  if (analysis.primaryNeeds.includes("问题")) {
    pool.unshift(STRATEGIES[3]);
  }

  if (analysis.primaryNeeds.includes("人物")) {
    pool.unshift(STRATEGIES[4]);
  }

  const ordered = uniqueByLabel(pool);
  const selected = ordered.slice(0, Math.max(3, candidateCount));

  while (selected.length < Math.min(5, candidateCount)) {
    const fallback = STRATEGIES[selected.length % STRATEGIES.length];
    if (!selected.some((item) => item.label === fallback.label)) {
      selected.push(fallback);
    } else {
      break;
    }
  }

  return uniqueByLabel(selected).slice(0, Math.min(5, Math.max(3, candidateCount)));
}
