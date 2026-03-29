import type {
  EntryAngleBrief,
  InputAnalysisResult,
  OpeningExpressionMode,
  OpeningStrategyPlan,
  OpeningStrategyType
} from "@/server/opening/types";

type ExpressionModeBlueprint = {
  mode: OpeningExpressionMode;
  label: string;
  hint: string;
};

type EntryAngleBlueprint = Omit<EntryAngleBrief, "strategyType" | "expressionMode"> & {
  strategyType: OpeningStrategyType;
  expressionMode: OpeningExpressionMode;
  lengthHint: string;
};

const CONTENT_PRIORS: Record<InputAnalysisResult["contentType"], OpeningStrategyType[]> = {
  novel: ["scene", "emotion", "contrast", "question", "statement"],
  essay: ["emotion", "statement", "scene", "contrast", "question"],
  article: ["statement", "question", "scene", "contrast", "emotion"]
};

const EXPRESSION_MODE_LIBRARY: Record<OpeningStrategyType, ExpressionModeBlueprint[]> = {
  scene: [
    { mode: "detail_focus", label: "细节切入", hint: "从一个具体细节或小物件进入，不要把画面直接讲成说明。" },
    { mode: "motion_focus", label: "动作切入", hint: "从动作、停顿、转身、抬眼等变化进入，让现场自己说话。" },
    { mode: "sensory_focus", label: "感官切入", hint: "从光线、声音、触感、温度等感受进入，保持自然。" },
    { mode: "object_focus", label: "物件切入", hint: "先写一个物件或场景元素，再慢慢带出人和情绪。" },
    { mode: "atmosphere_focus", label: "氛围切入", hint: "先立住整体气息，再慢慢贴近具体细节。" }
  ],
  emotion: [
    { mode: "body_signal", label: "身体反应", hint: "从心口、呼吸、手心、肩膀这类身体反应进入，不要抽象抒情。" },
    { mode: "inner_voice", label: "内心独白", hint: "像真实心里话那样切入，语气克制一点，不要整句都在解释。" },
    { mode: "memory_trigger", label: "记忆触发", hint: "从一个记忆点或回想进入，让情绪自然带出来。" },
    { mode: "quiet_scene", label: "安静映衬", hint: "用安静的场景映出情绪，不要把情绪总结成概念。" },
    { mode: "pressure_wave", label: "压迫波动", hint: "从压住、发紧、停顿这类感受进入，保留一点余味。" }
  ],
  question: [
    { mode: "direct_question", label: "直接提问", hint: "直接问读者，但问题必须紧贴主题，不要泛泛而问。" },
    { mode: "self_question", label: "自问自答", hint: "像自己在反问自己，带一点犹豫或迟疑。" },
    { mode: "rhetorical_question", label: "反问追问", hint: "问题里带一点质疑感，但不要空泛、不要标题党。" },
    { mode: "scenario_question", label: "场景设问", hint: "先给出具体场景，再顺势抛出问题。" },
    { mode: "double_question", label: "连问推进", hint: "用两个相连的小问题推进，不要写成问答模板。" }
  ],
  statement: [
    { mode: "judgment", label: "明确判断", hint: "先给判断，再往下展开，不要写成说明书。" },
    { mode: "observation", label: "观察陈述", hint: "像在观察一个事实，语气平稳但有方向感。" },
    { mode: "paradox", label: "轻微悖论", hint: "用一点反常识感打开，但不要硬拗。" },
    { mode: "rule_of_thumb", label: "经验判断", hint: "像经验之谈，但要贴着主题，不要变成总结段。" },
    { mode: "turning_point", label: "转折判断", hint: "先立一个判断，再把它轻轻转一下。" }
  ],
  contrast: [
    { mode: "appearance_vs_truth", label: "表里对照", hint: "写出表面和真实之间的偏差，不要套路化反转。" },
    { mode: "before_after", label: "前后对照", hint: "先写前一种状态，再露出后一种变化。" },
    { mode: "expectation_gap", label: "预期落差", hint: "先给读者一个预期，再把它轻轻掰开。" },
    { mode: "small_twist", label: "微小转折", hint: "用一个不大的变化把人带进另一层。" },
    { mode: "parallel_split", label: "并列分岔", hint: "用两种并行状态形成对照，不要硬造戏剧性。" }
  ]
};

const ENTRY_ANGLE_LIBRARY: Record<OpeningStrategyType, EntryAngleBlueprint[]> = {
  scene: [
    {
      id: "scene-detail",
      label: "从细节进入",
      description: "从一个能看见、能被摸到的具体细节切进来，让画面先站住。",
      mustPreserve: ["具体场景", "可见细节"],
      shouldAvoid: ["环境介绍", "写作分析腔"],
      strategyType: "scene",
      expressionMode: "detail_focus",
      lengthHint: "3-5句，先给画面再推进。"
    },
    {
      id: "scene-motion",
      label: "从动作进入",
      description: "从停顿、转身、抬眼、放下这类动作切入，让现场自然展开。",
      mustPreserve: ["动作变化", "现场感"],
      shouldAvoid: ["中段铺陈", "概括句"],
      strategyType: "scene",
      expressionMode: "motion_focus",
      lengthHint: "3-5句，动作要先成立。"
    },
    {
      id: "scene-object",
      label: "从物件进入",
      description: "先落到一个物件或场景元素，再把人和情绪慢慢带出来。",
      mustPreserve: ["物件", "场景元素"],
      shouldAvoid: ["泛空镜头", "大词开场"],
      strategyType: "scene",
      expressionMode: "object_focus",
      lengthHint: "4-6句，可以先铺后收。"
    }
  ],
  emotion: [
    {
      id: "emotion-body",
      label: "从身体反应进入",
      description: "从呼吸、胸口、手心、肩膀等身体反应切入，让情绪先落地。",
      mustPreserve: ["身体反应", "情绪感"],
      shouldAvoid: ["抽象抒情", "概念化总结"],
      strategyType: "emotion",
      expressionMode: "body_signal",
      lengthHint: "3-5句，先压住再展开。"
    },
    {
      id: "emotion-voice",
      label: "从心里话进入",
      description: "像真实心里话一样开口，保留犹豫、克制和一点没说完的余地。",
      mustPreserve: ["自白感", "克制"],
      shouldAvoid: ["模板句", "空话"],
      strategyType: "emotion",
      expressionMode: "inner_voice",
      lengthHint: "3-4句，语气要像人在想。"
    },
    {
      id: "emotion-memory",
      label: "从记忆触发进入",
      description: "从一个记忆点或旧画面进入，让情绪自然带出回声。",
      mustPreserve: ["记忆点", "余味"],
      shouldAvoid: ["总结段", "说教口吻"],
      strategyType: "emotion",
      expressionMode: "memory_trigger",
      lengthHint: "4-5句，先回想再落地。"
    }
  ],
  question: [
    {
      id: "question-direct",
      label: "直接抛问",
      description: "直接问一个紧扣主题的问题，让读者自然停一下。",
      mustPreserve: ["问题", "主题贴合"],
      shouldAvoid: ["标题党", "空泛问句"],
      strategyType: "question",
      expressionMode: "direct_question",
      lengthHint: "1-3句，问题要短准。"
    },
    {
      id: "question-scenario",
      label: "场景设问",
      description: "先把问题放进一个具体场景，再顺势把读者带进去。",
      mustPreserve: ["场景", "问题意识"],
      shouldAvoid: ["泛提问", "教程口吻"],
      strategyType: "question",
      expressionMode: "scenario_question",
      lengthHint: "2-4句，场景先立住。"
    },
    {
      id: "question-self",
      label: "自我追问",
      description: "像自己在反问自己，带一点迟疑和停顿。",
      mustPreserve: ["自问自答", "犹豫感"],
      shouldAvoid: ["模板问答", "过度解释"],
      strategyType: "question",
      expressionMode: "self_question",
      lengthHint: "2-4句，留一点空白。"
    }
  ],
  statement: [
    {
      id: "statement-judgment",
      label: "明确判断",
      description: "先把判断钉住，再往下展开。",
      mustPreserve: ["立场", "判断"],
      shouldAvoid: ["说明书", "概括段"],
      strategyType: "statement",
      expressionMode: "judgment",
      lengthHint: "2-4句，先立后展。"
    },
    {
      id: "statement-observation",
      label: "观察陈述",
      description: "像在观察一个事实，平稳但有方向。",
      mustPreserve: ["观察感", "事实感"],
      shouldAvoid: ["大词总结", "空泛抒情"],
      strategyType: "statement",
      expressionMode: "observation",
      lengthHint: "3-5句，慢一点更稳。"
    },
    {
      id: "statement-turn",
      label: "转折判断",
      description: "先给一个判断，再轻轻转一下，让开头有个转身。",
      mustPreserve: ["转折", "判断"],
      shouldAvoid: ["硬拗反转", "标题化表达"],
      strategyType: "statement",
      expressionMode: "turning_point",
      lengthHint: "3-5句，转折要自然。"
    }
  ],
  contrast: [
    {
      id: "contrast-frontback",
      label: "表里对照",
      description: "先把表面和真实摆在一起，让偏差自己冒出来。",
      mustPreserve: ["表面/真实", "对照感"],
      shouldAvoid: ["硬反转", "套路化揭秘"],
      strategyType: "contrast",
      expressionMode: "appearance_vs_truth",
      lengthHint: "4-6句，可以先并排再揭开。"
    },
    {
      id: "contrast-beforeafter",
      label: "前后对照",
      description: "先写前一种状态，再让后一种变化出现。",
      mustPreserve: ["前后差异", "变化"],
      shouldAvoid: ["夸张转折", "总结语气"],
      strategyType: "contrast",
      expressionMode: "before_after",
      lengthHint: "3-5句，先摆差异再推进。"
    },
    {
      id: "contrast-gap",
      label: "预期落差",
      description: "先给一个预期，再把它轻轻掰开。",
      mustPreserve: ["落差", "反差"],
      shouldAvoid: ["猎奇", "强行反转"],
      strategyType: "contrast",
      expressionMode: "expectation_gap",
      lengthHint: "3-5句，落差要准。"
    }
  ]
};

function buildExpressionModeMap(strategyType: OpeningStrategyType) {
  return new Map(EXPRESSION_MODE_LIBRARY[strategyType].map((item) => [item.mode, item]));
}

export function describeExpressionMode(strategyType: OpeningStrategyType, expressionMode: OpeningExpressionMode) {
  const mode = EXPRESSION_MODE_LIBRARY[strategyType].find((item) => item.mode === expressionMode);
  return mode ?? EXPRESSION_MODE_LIBRARY[strategyType][0];
}

function toStrategyPlan(angle: EntryAngleBlueprint): OpeningStrategyPlan {
  const mode = describeExpressionMode(angle.strategyType, angle.expressionMode);
  return {
    strategyType: angle.strategyType,
    label: angle.label,
    reason: angle.description,
    angle: angle.description,
    lengthHint: angle.lengthHint,
    expressionMode: angle.expressionMode,
    entryAngle: {
      ...angle
    }
  };
}

export function chooseOpeningStrategies(
  analysis: InputAnalysisResult,
  styleOptions: string[],
  candidateCount: number
): OpeningStrategyPlan[] {
  const targetCount = Math.min(5, Math.max(3, candidateCount));
  const styleOrder: OpeningStrategyType[] = [];
  if (styleOptions.some((style) => ["画面", "氛围", "文学感"].includes(style))) {
    styleOrder.push("scene", "emotion", "contrast", "statement", "question");
  } else if (styleOptions.some((style) => ["抓人", "公众号感", "小红书感"].includes(style))) {
    styleOrder.push("question", "statement", "contrast", "scene", "emotion");
  } else if (styleOptions.some((style) => ["克制", "随笔感"].includes(style))) {
    styleOrder.push("emotion", "scene", "statement", "contrast", "question");
  }

  const strategyOrder = Array.from(
    new Set<OpeningStrategyType>([
      ...styleOrder,
      ...CONTENT_PRIORS[analysis.contentType],
      "scene",
      "emotion",
      "question",
      "statement",
      "contrast"
    ])
  );

  const selected: OpeningStrategyPlan[] = [];
  const usedStrategyTypes = new Set<OpeningStrategyType>();

  for (const strategyType of strategyOrder) {
    if (selected.length >= targetCount) break;
    const angles = ENTRY_ANGLE_LIBRARY[strategyType];
    if (!angles || angles.length === 0) continue;

    selected.push(toStrategyPlan(angles[0]));
  }

  if (selected.length < targetCount) {
    for (const strategyType of strategyOrder) {
      if (selected.length >= targetCount) break;
      const angles = ENTRY_ANGLE_LIBRARY[strategyType];
      if (!angles || angles.length === 0) continue;
      for (const angle of angles) {
        if (selected.length >= targetCount) break;
        if (selected.some((item) => item.entryAngle.id === angle.id)) continue;
        selected.push(toStrategyPlan(angle));
      }
    }
  }

  if (selected.length < targetCount) {
    for (const [strategyType, angles] of Object.entries(ENTRY_ANGLE_LIBRARY) as Array<
      [OpeningStrategyType, EntryAngleBlueprint[]]
    >) {
      if (selected.length >= targetCount) break;
      for (const angle of angles) {
        if (selected.length >= targetCount) break;
        if (selected.some((item) => item.entryAngle.id === angle.id)) continue;
        selected.push(toStrategyPlan(angle));
      }
    }
  }

  return selected.slice(0, targetCount);
}
