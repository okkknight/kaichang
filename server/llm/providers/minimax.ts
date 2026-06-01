import Anthropic from "@anthropic-ai/sdk";
import { BusinessError } from "@/server/errors";
import type { GeneratedTextResult, LlmProvider } from "@/server/llm/types";
import { logInfo, logWarn, summarizeError } from "@/server/logger";
import type { OpeningStrategyType } from "@/server/opening/types";
import {
  buildOpeningOutputSignature,
  buildRecentOutputSignatureMemoryFromEntries,
  detectRecentOutputHardBlocks,
  type RecentOutputSignatureEntry,
  type RecentOutputSignatureMemory
} from "@/server/opening/output-signatures";

function hasRealKey() {
  return Boolean(process.env.MINIMAX_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}

function getApiKey() {
  return process.env.MINIMAX_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
}

function getBaseUrl() {
  return (
    process.env.MINIMAX_BASE_URL?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim() ||
    "https://api.minimaxi.com/anthropic"
  );
}

function getModelName() {
  return process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.5-highspeed";
}

function normalizeText(text: string) {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/^["“”]|["“”]$/g, "")
    .trim();
}

function parseStrictOpeningCandidatesPayload(payload: unknown, expectedCount: number) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { candidates?: unknown }).candidates)) {
    throw new Error("模型返回的工具输入缺少 candidates 数组。");
  }

  const { candidates } = payload as {
    candidates: Array<{ content?: unknown }>;
  };

  if (candidates.length !== expectedCount) {
    throw new Error(`模型返回的候选数量不匹配，期望 ${expectedCount} 条，实际 ${candidates.length} 条。`);
  }

  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || typeof candidate.content !== "string") {
      throw new Error(`模型返回的第 ${index + 1} 条候选缺少 content。`);
    }

    const content = normalizeText(candidate.content);
    if (!content) {
      throw new Error(`模型返回的第 ${index + 1} 条候选为空白内容。`);
    }

    return content;
  });
}

function parseStrictRefinementPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || typeof (payload as { refinedText?: unknown }).refinedText !== "string") {
    throw new BusinessError(
      "REFINE_STRUCTURED_OUTPUT_INVALID",
      "模型没有按结构化格式返回改写结果。",
      502
    );
  }

  const refinedText = normalizeText((payload as { refinedText: string }).refinedText);
  if (!refinedText) {
    throw new BusinessError(
      "REFINE_STRUCTURED_OUTPUT_INVALID",
      "模型没有按结构化格式返回改写结果。",
      502
    );
  }

  return refinedText;
}

function stripTerminalPunctuation(value: string) {
  return value.replace(/[。！？!?\.]+$/g, "").trim();
}

function extractStrategy(user: string) {
  const strategyLine = user.split("\n").find((line) => line.startsWith("策略：")) ?? "策略：画面切入型";
  const extracted = strategyLine.replace("策略：", "").split("（")[0]?.trim();
  if (extracted) {
    return extracted;
  }

  const candidateIndex = extractCandidateIndex(user) - 1;
  const styles = extractStylePreferences(user);

  if (styles.some((style) => ["抓人", "公众号感", "小红书感"].includes(style))) {
    return ["提问切入型", "观点切入型", "反差切入型", "画面切入型", "情绪切入型"][candidateIndex % 5];
  }
  if (styles.some((style) => ["氛围", "文学感"].includes(style))) {
    return ["画面切入型", "情绪切入型", "反差切入型", "观点切入型", "提问切入型"][candidateIndex % 5];
  }
  if (styles.some((style) => ["克制", "随笔感"].includes(style))) {
    return ["情绪切入型", "画面切入型", "观点切入型", "反差切入型", "提问切入型"][candidateIndex % 5];
  }

  return ["画面切入型", "情绪切入型", "提问切入型", "观点切入型", "反差切入型"][candidateIndex % 5];
}

function extractEntryDirection(user: string) {
  return user
    .split("\n")
    .find((line) => line.startsWith("入口方向："))
    ?.replace("入口方向：", "")
    .trim();
}

function resolveMockStrategy(user: string) {
  const entryDirection = extractEntryDirection(user);

  if (entryDirection) {
    if (entryDirection.includes("提问") || entryDirection.includes("抛问") || entryDirection.includes("追问")) {
      return "提问切入型";
    }
    if (entryDirection.includes("身体") || entryDirection.includes("心里") || entryDirection.includes("记忆")) {
      return "情绪切入型";
    }
    if (entryDirection.includes("对照") || entryDirection.includes("落差")) {
      return "反差切入型";
    }
    if (entryDirection.includes("判断") || entryDirection.includes("观察")) {
      return "观点切入型";
    }
    if (entryDirection.includes("细节") || entryDirection.includes("动作") || entryDirection.includes("物件")) {
      return "画面切入型";
    }
  }

  return extractStrategy(user);
}

function extractCandidateIndex(user: string) {
  const line = user.split("\n").find((item) => item.startsWith("候选序号："));
  const number = Number(line?.replace("候选序号：", "").trim() || "1");
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function extractExpressionMode(user: string) {
  const expressionLine = user.split("\n").find((line) => line.startsWith("表达方式："))?.replace("表达方式：", "").trim();
  return expressionLine || "";
}

function extractStylePreferences(user: string) {
  const line = user.split("\n").find((item) => item.startsWith("风格偏好："))?.replace("风格偏好：", "").trim();
  if (!line || line === "自动判断") {
    return [];
  }

  return line.split("、").map((item) => item.trim()).filter(Boolean);
}

function extractRawInputFromPrompt(user: string) {
  const line = user.split("\n").find((item) => item.startsWith("原始输入："))?.replace("原始输入：", "").trim();
  return line || "";
}

function extractRefineOriginalContent(user: string) {
  const line = user.split("\n").find((item) => item.startsWith("原文："))?.replace("原文：", "").trim();
  return line || extractRawInputFromPrompt(user) || "";
}

function isEvaluationPrompt(input: { system: string; user: string }) {
  return (
    input.system.includes("中文开头评审官") ||
    input.system.includes("opening_quality_evaluation") ||
    input.user.includes("\"candidates\"")
  );
}

function extractSemanticTheme(user: string) {
  const rawInput = extractRawInputFromPrompt(user);
  if (rawInput) {
    const normalized = stripTerminalPunctuation(normalizeText(rawInput));
    const firstClause = normalized.split(/[，。！？；;]/)[0]?.trim();
    if (firstClause) {
      return firstClause.slice(0, 42) || normalized.slice(0, 42);
    }
    return normalized.slice(0, 42) || "这个主题";
  }

  const candidates = [
    "题面锚点：",
    "主体实体：",
    "核心意图：",
    "主题锚点：",
    "语义主题："
  ];

  for (const marker of candidates) {
    const line = user
      .split("\n")
      .find((item) => item.startsWith(marker))
      ?.replace(marker, "")
      .trim();

    if (line) {
      return stripTerminalPunctuation(line);
    }
  }

  return "这个主题";
}

function extractFreshnessSeed(user: string) {
  const line = user
    .split("\n")
    .find((item) => item.startsWith("最近输出轮换："))
    ?.replace("最近输出轮换：", "")
    .trim();

  const parsed = Number(line || "0");
  return Number.isFinite(parsed) ? Math.abs(Math.floor(parsed)) : 0;
}

type RecentOutputAvoidance = {
  strategyType: string;
  structureKey: string;
  formulaKey: string;
  semanticHead?: string;
  themeClusterKey?: string;
  clusterFamilyKey?: string;
  planClusterKey?: string;
  preview: string;
};

function mapStrategyLabelToType(strategy: string): OpeningStrategyType {
  if (strategy.includes("画面")) return "scene";
  if (strategy.includes("情绪")) return "emotion";
  if (strategy.includes("提问")) return "question";
  if (strategy.includes("反差")) return "contrast";
  return "statement";
}

function buildAvoidanceMemory(avoidance: RecentOutputAvoidance[]): RecentOutputSignatureMemory {
  const entries: RecentOutputSignatureEntry[] = avoidance.map((note) => {
    const strategyType = mapStrategyLabelToType(note.strategyType);
    const baseSignature = buildOpeningOutputSignature({
      strategyType,
      content: note.preview || note.semanticHead || note.themeClusterKey || "占位"
    });

    return {
      ...baseSignature,
      structureKey: note.structureKey || baseSignature.structureKey,
      formulaKey: note.formulaKey || baseSignature.formulaKey,
      semanticHead: note.semanticHead || baseSignature.semanticHead,
      themeClusterKey: note.themeClusterKey || baseSignature.themeClusterKey,
      planFingerprint: [strategyType, "", "", note.structureKey || baseSignature.structureKey, note.formulaKey || baseSignature.formulaKey].join("|"),
      clusterFamilyKey: note.clusterFamilyKey || baseSignature.clusterFamilyKey,
      planClusterKey: note.planClusterKey || baseSignature.planClusterKey,
      preview: note.preview || baseSignature.normalizedContent.slice(0, 24)
    };
  });

  return buildRecentOutputSignatureMemoryFromEntries(entries, {
    notes: avoidance.map((note) => note.preview),
    recentCount: entries.length
  });
}

function normalizeShapeText(content: string) {
  return normalizeText(content).replace(/[“”"'.。！？!?，,；;、]/g, "");
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

function extractRecentOutputAvoidance(user: string): RecentOutputAvoidance[] {
  const startMarker = "最近输出回避：";
  const start = user.indexOf(startMarker);
  if (start < 0) {
    return [];
  }

  const section = user.slice(start + startMarker.length);
  const lines = section.split("\n").map((line) => line.trim());
  const items: RecentOutputAvoidance[] = [];

  for (const line of lines) {
    if (!line || /^\d+\.\s*$/.test(line)) {
      continue;
    }
    if (/^(输入分析|候选计划|输出要求|主题锚点|语义主题|语义关键词):/.test(line)) {
      break;
    }

    const payload = line.replace(/^\d+\.\s*/, "");
    const parts = payload.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 4) {
      continue;
    }

    if (parts.length >= 8) {
      items.push({
        strategyType: parts[0],
        structureKey: parts[1],
        formulaKey: parts[2],
        semanticHead: parts[3],
        themeClusterKey: parts[4],
        clusterFamilyKey: parts[5].replaceAll("¦", "|"),
        planClusterKey: parts[6].replaceAll("¦", "|"),
        preview: parts.slice(7).join(" | ")
      });
      continue;
    }

    if (parts.length >= 6) {
      items.push({
        strategyType: parts[0],
        structureKey: parts[1],
        formulaKey: parts[2],
        semanticHead: parts[3],
        themeClusterKey: parts[4],
        preview: parts.slice(5).join(" | ")
      });
      continue;
    }

    items.push({
      strategyType: parts[0],
      structureKey: parts[1],
      formulaKey: parts[2],
      preview: parts.slice(3).join(" | ")
    });
  }

  return items;
}

function isRecentOutputCollision(
  text: string,
  strategy: string,
  avoidance: RecentOutputAvoidance[]
) {
  if (avoidance.length === 0) {
    return false;
  }

  const signature = buildOpeningOutputSignature({
    strategyType: mapStrategyLabelToType(strategy),
    content: text
  });
  return detectRecentOutputHardBlocks(signature, buildAvoidanceMemory(avoidance)).length > 0;
}

function buildProviderEscapeOpening(
  strategy: string,
  semanticTheme: string,
  candidateIndex: number,
  freshnessSeed: number,
  avoidance: RecentOutputAvoidance[],
  mode: "mock" | "recovered" | "fallback"
) {
  const theme = semanticTheme || "这个主题";
  const familiesByMode: Record<"mock" | "recovered" | "fallback", Record<string, string[][]>> = {
    mock: {
      "画面切入型": [
        [`先把镜头落低，${theme}会先从边角里出现。`, `${theme}最适合先被看见，而不是先被解释。`, `一处细节站住，后面的画面自然会跟上。`],
        [`别从大词起手，${theme}反而要先借一个现场开口。`, `动作和停顿比判断更快把${theme}带出来。`, `先有场，再有意，整条开头才会散开。`]
      ],
      "情绪切入型": [
        [`先别把感受写满，${theme}更适合先压在呼吸里。`, `${theme}真正靠近时，人先察觉到的是节奏变慢。`, `那点停顿一成立，情绪就已经有了入口。`],
        [`先承认心里那一下，${theme}才不会变成现成句子。`, `${theme}更像悄悄压进来的重量。`, `把余味留住，后面的展开才会更像真人在写。`]
      ],
      "提问切入型": [
        [`如果${theme}现在就摆到眼前，最先逼出来的问题会是什么？`, `${theme}真正抓人的地方，往往就藏在那道躲不开的追问里。`, `问题先问准，读者自然会往下走。`],
        [`别把提问问成口号，${theme}更适合被问成眼前这一下。`, `当${theme}不再抽象，问题也该贴着现实。`, `只要问号够贴身，入口就已经立住。`]
      ],
      "观点切入型": [
        [`${theme}更适合先被钉成一个判断。`, `第一句先落地，后面的层次才有地方长出来。`, `判断先站住，开头才不会滑回说明。`],
        [`有些主题不需要兜圈，${theme}就是该先把立场说清。`, `${theme}一旦被说成判断，后面的展开反而更自由。`, `先说准，再往里走，比先铺背景更稳。`]
      ],
      "反差切入型": [
        [`${theme}最有劲的地方，不在表面，而在那一点轻微错位。`, `先让前后两层状态并排站住，张力才会自己冒出来。`, `读者先察觉到不对，后面才愿意继续追。`],
        [`别急着翻底牌，${theme}更适合先露出那点不协调。`, `当表面和里面稍微错开，${theme}就不再只是概括。`, `这种偏差一成立，整条开头就会离开旧路。`]
      ]
    },
    recovered: {
      "画面切入型": [
        [`不要回到刚才那处细节，${theme}得换一个场面落地。`, `${theme}先借重心变化被看见，会比重复旧镜头稳。`, `入口一换，画面就会自己分开。`],
        [`这次先把镜头移到动作和节奏上。`, `${theme}更适合从场面的移动里站住。`, `先改轨道，再写细节，才不会回簇。`]
      ],
      "情绪切入型": [
        [`不要把情绪又写成同一个句首，${theme}得从另一层出来。`, `${theme}先把人的节奏拖慢，再慢慢往心里压。`, `入口换掉以后，余味才会是新的。`],
        [`先承认那点不肯明说的停顿。`, `${theme}更像沉默里慢慢浮起来的重量。`, `只要切面变了，后面的情绪也会跟着换气。`]
      ],
      "提问切入型": [
        [`别把问题停在表面，${theme}这次要先问到选择上。`, `${theme}真正难的地方，是它会逼人先站位。`, `问法一换，旧模板就很难再黏回来。`],
        [`这次别用刚才那种追问骨架。`, `${theme}更适合被问成正在发生的那一步。`, `不是换词，而是换整组问题结构。`]
      ],
      "观点切入型": [
        [`别沿着旧判断起步，${theme}得换一种站位。`, `${theme}更像顺序被重新洗过一次。`, `论断骨架一变，旧簇就回不来了。`],
        [`这次别写成经验口吻。`, `${theme}真正显出力道时，表面的平静往往还没散。`, `判断改轨以后，整条候选才算真的换了。`]
      ],
      "反差切入型": [
        [`别再用同一种反差起手，${theme}得换另一处错位。`, `${theme}先把表面和暗处轻轻错开，会比直接揭底更稳。`, `对照关系一换，旧家族就会被甩开。`],
        [`先从另一种不对劲进去。`, `${theme}真正有力的地方，不在夸张，而在两层节奏同时存在。`, `把并排关系换掉，整条候选就会分开。`]
      ]
    },
    fallback: {
      "画面切入型": [
        [`${theme}不该再回到原来的画面里，它需要一个新的落点。`, `先换掉起笔现场，再让内容慢慢往前走。`, `只要入口变了，重复簇就会被拦在外面。`]
      ],
      "情绪切入型": [
        [`${theme}不能再沿着旧情绪骨架写了。`, `先把那点波动换成另一层停顿，后面的话才会新。`, `先换簇，再展开，比修词更重要。`]
      ],
      "提问切入型": [
        [`${theme}这次必须换一套问法。`, `先把问题压近到现实里，再往下推。`, `只有问号换轨，旧簇才不会回来。`]
      ],
      "观点切入型": [
        [`${theme}需要的不是同一类判断，而是另一种组织方式。`, `先把立场换一个落法，再让后面的层次长出来。`, `只要骨架换了，内容就不会像回放。`]
      ],
      "反差切入型": [
        [`${theme}不能再沿着刚才那组对照走。`, `先把偏差换一个摆法，后面的张力才算新的。`, `不是更响，而是更换一层并排关系。`]
      ]
    }
  };

  const groups = familiesByMode[mode][strategy] ?? familiesByMode[mode]["观点切入型"];

  for (let attempt = 0; attempt < groups.length * 6; attempt += 1) {
    const group = groups[(freshnessSeed + candidateIndex + attempt) % groups.length];
    const ordered = [
      group[(freshnessSeed + attempt) % group.length],
      group[(freshnessSeed + candidateIndex + attempt + 1) % group.length],
      group[(freshnessSeed + candidateIndex * 3 + attempt + 2) % group.length]
    ];
    const text = normalizeText(ordered.join(" "));
    if (!isRecentOutputCollision(text, strategy, avoidance)) {
      return text;
    }
  }

  return normalizeText(`${theme}需要一个新的入口，而不是再回到刚才那种写法。`);
}

function buildFallbackThemeBase(semanticTheme: string, strategy: string, candidateIndex: number) {
  const theme = semanticTheme || "这个主题";

  const strategyVariants: Record<string, string[]> = {
    "画面切入型": [
      "门把手还带着一点余温",
      "台灯下那片没收拾完的桌面",
      "下班后仍然没散去的疲惫"
    ],
    "情绪切入型": [
      "胸口那点发紧的感觉",
      "被工作慢慢掏空的状态",
      "心里那种说不清的钝"
    ],
    "提问切入型": [
      "工作把人一点点耗空的过程",
      "人被工作磨钝的过程",
      "明明没发生大事却先累了这件事"
    ],
    "观点切入型": [
      "工作会慢慢磨掉人的锐气",
      "重复的日子最容易把人磨钝",
      "真正消耗人的往往不是大事"
    ],
    "反差切入型": [
      "表面照常运转，里头已经发空",
      "看起来没事，实际上已经发钝",
      "外面还在继续，里面先松了"
    ]
  };

  const variants = strategyVariants[strategy] ?? [];
  if (variants.length > 0) {
    return variants[candidateIndex % variants.length];
  }

  if (/(上班|工作|打工|加班|职场|工位|消耗|疲惫|麻木)/.test(theme)) {
    return "被工作慢慢磨薄的疲惫";
  }
  if (/(时间|光阴|飞快|越来越快|过得很快)/.test(theme)) {
    return "被时间催着往前跑的感觉";
  }
  if (/(失眠|睡不着|凌晨清醒)/.test(theme)) {
    return "深夜迟迟睡不着的清醒";
  }
  if (/(拖延|拖到最后一刻)/.test(theme)) {
    return "总要拖到最后一刻才开始的习惯";
  }
  if (/(海上|女船长|船长|航海)/.test(theme)) {
    return "海上独自掌舵的女船长";
  }

  return theme;
}

function countSentences(text: string) {
  return text.split(/[。！？!?]/).map((part) => part.trim()).filter(Boolean).length;
}

function addMoreSentences(
  text: string,
  strategy: string,
  expressionMode: string,
  themeBase: string,
  candidateIndex: number,
  freshnessSeed = 0
) {
  const additionsByStrategy: Record<string, string[]> = {
    "画面切入型": [
      "它先不是一个结论，而是一个能看见、能停顿、能继续往下走的现场。",
      "门口、灯光、脚步和呼吸一起把场面撑住了，读者也会更容易跟着进去。",
      "当画面真正稳下来，后面的情绪和判断才会慢慢浮出来。",
      "如果再往里看一点，真正留下来的其实是那种被日常一点点磨薄的痕迹。"
    ],
    "情绪切入型": [
      "真正先起变化的不是道理，而是心里那一点说不清的震动。",
      "它会先落在呼吸、肩膀和停顿里，然后才慢慢变成能说出口的话。",
      "如果情绪压得住，后面的展开反而更有余味。"
    ],
    "提问切入型": [
      "问题不只是为了吸引人，而是为了把人真正推到主题边上。",
      "当问题足够具体，读者才会真的想继续往下找答案。",
      "答案不用急着给，留一点余地，开头会更像开头。"
    ],
    "观点切入型": [
      "判断先摆出来，后面的展开才有地方落脚。",
      "这类开头不必很短，但必须先把态度钉清楚。",
      "一旦立场明确，读者就会知道故事要往哪边走。"
    ],
    "反差切入型": [
      "表面上没什么变化，真正的偏移却已经先发生了。",
      "一边还能照常说服自己，另一边早就开始失去平衡。",
      "这种对照如果写得稳，开头会更有余震。",
      "越是看起来没事，越容易在后面突然翻出更大的波动。"
    ]
  };

  const additions = additionsByStrategy[strategy] ?? [
    "它并不是只靠一个词就能说完的东西，需要多一点展开。",
    "换个角度看，同一个主题也能有不同的进入方式。",
    "写法上不必太整齐，留一点起伏反而更像真正的开头。"
  ];

  const targetByStrategy: Record<string, [number, number]> = {
    "画面切入型": [5, 6],
    "情绪切入型": [3, 5],
    "提问切入型": [1, 3],
    "观点切入型": [2, 5],
    "反差切入型": [5, 6]
  };

  const [minCount, maxCount] = targetByStrategy[strategy] ?? [2, 4];
  const currentCount = countSentences(text);
  const needed = Math.max(0, Math.min(maxCount - currentCount, Math.max(0, minCount - currentCount)));
  const maxExtra = minCount >= 5 ? 4 : 3;
  const extraCount = Math.max(0, Math.min(maxExtra, needed > 0 ? needed : candidateIndex % maxExtra));

  if (extraCount <= 0) {
    return text;
  }

  const startIndex = Math.abs(candidateIndex + freshnessSeed) % Math.max(1, additions.length);
  const picked = Array.from({ length: extraCount }, (_, index) => additions[(startIndex + index) % additions.length]);
  return `${text}${picked.map((sentence) => ` ${sentence}`).join("")}`;
}

function buildMockOpeningForPlan(
  strategy: string,
  expressionMode: string,
  semanticTheme: string,
  candidateIndex: number,
  freshnessSeed = 0,
  recentOutputAvoidance: RecentOutputAvoidance[] = []
) {
  const theme = buildFallbackThemeBase(semanticTheme, strategy, candidateIndex + freshnessSeed);

  const variants: Record<string, Record<string, string[]>> = {
    "画面切入型": {
      detail_focus: [
        `桌上那点来不及收走的痕迹还在，${theme}就这样先落到了眼前。`,
        `门边停住的那一下，已经把${theme}的轮廓悄悄勾出来了。`,
        `角落里那束光先亮着，${theme}也跟着有了第一层质感。`
      ],
      motion_focus: [
        `她把手里的东西放下时，${theme}才像真正开始呼吸。`,
        `他往前迈了半步，${theme}的节奏就跟着变了。`,
        `指尖一停，${theme}的入口也就跟着安静下来。`
      ],
      sensory_focus: [
        `灯光有点冷，${theme}就在这种冷里慢慢显形。`,
        `空气一静，${theme}先落在了耳边。`,
        `风声刚停的时候，${theme}已经有了可以被看见的边。`
      ],
      object_focus: [
        `那只杯子还摆在那儿，${theme}却已经不是一个空洞的说法了。`,
        `桌角那本翻开的本子，把${theme}轻轻托了起来。`,
        `门把手还带着一点余温，${theme}也因此有了可以被抓住的起点。`
      ],
      atmosphere_focus: [
        `房间里静了一下，${theme}就在这一下里慢慢站稳。`,
        `空气有点紧，${theme}也跟着变得有分量。`,
        `光线没怎么变，${theme}却先把场面改了。`
      ]
    },
    "情绪切入型": {
      body_signal: [
        `胸口先紧了一下，${theme}才慢慢冒出轮廓。`,
        `呼吸停了半拍，${theme}也就顺势往里沉了一点。`,
        `手心那点发热提醒着我，${theme}并不只是一个想法。`
      ],
      inner_voice: [
        `我知道${theme}迟早会来，可每次真的碰到，心里还是会停一下。`,
        `说不清为什么，${theme}一靠近，原本很吵的念头就先安静了。`,
        `有些话没说出口之前，${theme}已经先在心里压出一道痕。`
      ],
      memory_trigger: [
        `一想到${theme}，那些以为已经过去的细节就会又回来。`,
        `只要${theme}被提起，记忆里那些没收好的角落就会自己亮起来。`,
        `某个旧场景忽然浮上来时，${theme}就不再只是表面的说法。`
      ],
      quiet_scene: [
        `窗外明明没发生什么，${theme}却还是在这份安静里慢慢浮出来。`,
        `桌边那盏灯没怎么变，${theme}却突然变得很重。`,
        `屋里静得过分，${theme}反倒先把人往里拉了一下。`
      ],
      pressure_wave: [
        `有些压迫不是一下子砸下来，而是像${theme}这样，先轻轻碰到你，再慢慢收紧。`,
        `那种说不出的重量，一点点推着${theme}往前走。`,
        `当呼吸开始变窄，${theme}也就不再只是情绪了。`
      ]
    },
    "提问切入型": {
      direct_question: [
        `如果${theme}真的摆到眼前，你会先往前一步，还是先停一下？`,
        `你有没有发现，${theme}一出现，很多原本简单的事都会突然变复杂？`,
        `当${theme}已经开始影响你时，最先变的会是什么？`
      ],
      self_question: [
        `我到底是在等${theme}发生，还是在等自己终于愿意面对它？`,
        `是不是很多时候，我们不是没准备好，只是还没想好怎么接住${theme}？`,
        `为什么一想到${theme}，脑子里先冒出来的总是犹豫？`
      ],
      rhetorical_question: [
        `难道${theme}真的只是表面看到的那样吗？`,
        `为什么${theme}总会把人原本很笃定的判断打乱？`,
        `如果${theme}只是轻轻一碰，为什么后面却会牵出这么多东西？`
      ],
      scenario_question: [
        `要是今天真的轮到${theme}落到你头上，你会先做哪一步？`,
        `当${theme}就摆在眼前的时候，真正难住人的会是哪一秒？`,
        `如果把${theme}放进具体的场景里，它会先逼你回答什么？`
      ],
      double_question: [
        `你会不会也有这种时候：${theme}明明已经来了，自己却还想再等等？`,
        `明明知道${theme}不能再拖，为什么还是忍不住往后放？`,
        `你是不是也经历过，${theme}看起来很近，真正碰上却很远？`
      ]
    },
    "观点切入型": {
      judgment: [
        `${theme}一旦真正开始，改变的往往不是表面，而是人看事情的顺序。`,
        `真正麻烦的通常不是${theme}本身，而是它出现以后，很多默认成立的东西都要重来。`,
        `面对${theme}，先变的常常不是结果，而是一个人的判断方式。`
      ],
      observation: [
        `很多时候，${theme}并不会一下子把人推翻，它只是先让一些细小的地方开始变形。`,
        `你越靠近${theme}，越会发现它不是一个单独的点，而是一连串变化。`,
        `被轻轻推开的那一下，${theme}其实已经开始改写节奏了。`
      ],
      paradox: [
        `最不像问题的${theme}，往往才是最容易把人卡住的地方。`,
        `有些${theme}看起来只是轻轻一碰，实际上却会把后面的路全带偏。`,
        `越是看起来没什么，${theme}越容易在后面突然发力。`
      ],
      rule_of_thumb: [
        `一旦${theme}被拖到最后一刻，很多原本还算从容的东西就会开始失去节奏。`,
        `只要${theme}被推迟，后面就很容易连着失去好几层余地。`,
        `通常一碰上${theme}，真正先乱的不是动作，而是安排。`
      ],
      turning_point: [
        `${theme}真正站到面前的时候，故事就已经不是原来的那个故事了。`,
        `从${theme}那一刻开始，事情往往会往另一个方向慢慢拐过去。`,
        `一旦${theme}过了那个点，后面的发展就不会再按原样走。`
      ]
    },
    "反差切入型": {
      appearance_vs_truth: [
        `看上去${theme}只是个普通起点，真正往里走时才会发现，里面的走向早就换了。`,
        `表面那层平静一掀开，${theme}露出来的就不是原来以为的那一面。`,
        `大家先看到的只是${theme}，真正藏着劲的部分却不在表面。`
      ],
      before_after: [
        `刚开始的${theme}还像一块没被碰过的布，往后走几步，纹理就全变了。`,
        `前一秒还像没事，后一秒${theme}就把人带进了另一种节奏里。`,
        `前面看着很稳，${theme}一落下来，后面的空气就不一样了。`
      ],
      expectation_gap: [
        `原本以为${theme}会很平，结果真正靠近才发现它藏着别的东西。`,
        `大家最开始看到的只是${theme}，没想到真正难的其实还在后面。`,
        `表面像一条直线，${theme}真正往里走却开始转弯。`
      ],
      small_twist: [
        `${theme}原来只是一个小口子，可真正进去以后，里面的空气已经完全不一样了。`,
        `看起来只是轻轻一转，${theme}就把原来的方向悄悄换掉了。`,
        `一个很小的变化，已经足够让${theme}的节奏偏开。`
      ],
      parallel_split: [
        `一边是${theme}的表面，一边是它暗下去的那部分，两个方向同时存在，却不在同一个节奏里。`,
        `外面看起来很稳，里面却已经偏了，${theme}就是这样把两种状态放在一起。`,
        `明面和暗处并排摆着，${theme}真正有意思的地方反而在分叉之后。`
      ]
    }
  };

  const strategyPool = variants[strategy] ?? variants["画面切入型"];
  const modeKeys = Object.keys(strategyPool);
  const selectedMode = strategyPool[expressionMode]
    ? expressionMode
    : modeKeys[(candidateIndex + freshnessSeed) % Math.max(1, modeKeys.length)] || "detail_focus";
  const pool = strategyPool[selectedMode as keyof typeof strategyPool] ?? variants["画面切入型"].detail_focus;
  let text = "";
  const startIndex = Math.abs(candidateIndex - 1 + freshnessSeed) % Math.max(1, pool.length);

  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const candidate = pool[(startIndex + attempt) % pool.length].replaceAll(semanticTheme, theme);
    if (!isRecentOutputCollision(candidate, strategy, recentOutputAvoidance)) {
      text = candidate;
      break;
    }
  }

  if (!text) {
    text = buildProviderEscapeOpening(
      strategy,
      semanticTheme,
      candidateIndex,
      freshnessSeed,
      recentOutputAvoidance,
      "mock"
    );
  }

  const enriched = addMoreSentences(text, strategy, expressionMode, theme, candidateIndex, freshnessSeed);
  const finalized = isRecentOutputCollision(enriched, strategy, recentOutputAvoidance)
    ? buildProviderEscapeOpening(strategy, semanticTheme, candidateIndex, freshnessSeed + 29, recentOutputAvoidance, "mock")
    : enriched;

  return {
    text: normalizeText(finalized),
    providerName: "MiniMax",
    modelName: getModelName(),
    strategy
  };
}

function buildMockRefinementText(user: string) {
  const original = normalizeText(extractRefineOriginalContent(user));
  return original || "这段开头可以再收紧一点。";
}

function extractPlanItems(user: string) {
  const section = extractSection(user, user.includes("需要修复的候选：") ? "需要修复的候选：" : "候选计划：", user.includes("需要修复的候选：") ? "修复要求：" : "输出要求：");
  const lines = section.split("\n");
  const items: Array<{ strategy: string; expressionMode: string }> = [];
  let current: { strategy: string; expressionMode: string } | null = null;

  for (const line of lines) {
    const numbered = line.match(/^\s*\d+\.\s*(.+?)\s*$/);
    if (numbered) {
      current = { strategy: numbered[1].trim(), expressionMode: "" };
      items.push(current);
      continue;
    }

    const mode = line.match(/^\s*表达方式：(.+)$/);
    if (mode && current) {
      current.expressionMode = mode[1].trim();
    }
  }

  return items.filter((item) => item.strategy.length > 0);
}

function extractPlanStrategies(user: string) {
  const items = extractPlanItems(user);
  if (items.length > 0) {
    return items.map((item) => item.strategy);
  }

  return Array.from(user.matchAll(/^\s*\d+\.\s*(.+?)\s*$/gm)).map((match) => match[1].trim());
}

function extractPlanExpressionModes(user: string) {
  const items = extractPlanItems(user);
  if (items.length > 0) {
    return items.map((item) => item.expressionMode || "detail_focus");
  }

  const single = extractExpressionMode(user);
  return single ? [single] : [];
}

function extractSection(user: string, startMarker: string, endMarker: string) {
  const start = user.indexOf(startMarker);
  if (start < 0) {
    return "";
  }

  const afterStart = user.slice(start + startMarker.length);
  const end = afterStart.indexOf(endMarker);
  return (end >= 0 ? afterStart.slice(0, end) : afterStart).trim();
}

function buildMockOpeningsFromPrompt(user: string, count: number) {
  const semanticTheme = extractSemanticTheme(user);
  const strategies = extractPlanStrategies(user);
  const expressionModes = extractPlanExpressionModes(user);
  const freshnessSeed = extractFreshnessSeed(user);
  const recentOutputAvoidance = extractRecentOutputAvoidance(user);

  return Array.from({ length: count }, (_, index) => {
    const strategy = strategies[index] || strategies[0] || "画面切入型";
    const expressionMode = expressionModes[index] || expressionModes[0] || "detail_focus";
    return buildMockOpeningForPlan(strategy, expressionMode, semanticTheme, index + 1, freshnessSeed, recentOutputAvoidance);
  });
}

function buildMockSeed(rawInput: string) {
  const normalized = stripTerminalPunctuation(normalizeText(rawInput));
  const seed = normalized
    .replace(/^(我想写(?:一个|一篇|一段)?|想写(?:一个|一篇|一段)?|请写(?:一个|一篇|一段)?|帮我写(?:一个|一篇|一段)?)/, "")
    .replace(/^关于/, "")
    .replace(/，?开头要[^，。！？!?；;]+/g, "")
    .replace(/，?不要[^，。！？!?；;]+/g, "")
    .trim();

  return seed || normalized || "这件事";
}

function buildLightweightMockOpening(user: string, candidateIndexOverride?: number) {
  const rawInput = extractRawInputFromPrompt(user) || extractSemanticTheme(user);
  const strategy = resolveMockStrategy(user);
  const styles = extractStylePreferences(user);
  const candidateIndex = candidateIndexOverride ?? extractCandidateIndex(user);
  const seed = buildMockSeed(rawInput);

  const pools: Record<string, string[]> = {
    "画面切入型": [
      `事情真正开始前，${seed}先在一个看得见的细节里站住了。`,
      `风声压过来的那一刻，${seed}忽然有了具体的轮廓。`,
      `先亮出来的不是道理，而是${seed}落在现场里的那一点硬和冷。`
    ],
    "情绪切入型": [
      `${seed}最先变重的时候，人其实说不出自己到底在怕什么。`,
      `真正难熬的，往往不是别人看到的那一面，而是${seed}在心里慢慢沉下去的过程。`,
      `${seed}不是一句话能讲完的事，它总会先压住呼吸，再压住声音。`
    ],
    "提问切入型": [
      `如果${seed}真的摆到眼前，人会先学会沉默，还是先学会假装没事？`,
      `谁能说清，${seed}是从哪一刻开始慢慢改掉一个人的？`,
      `等到${seed}真的发生时，人还能像从前那样开口吗？`
    ],
    "观点切入型": [
      `${seed}从来不是一下子形成的，它总是先拿走一点力气，再拿走一点声音。`,
      `很多事表面上还在照常往前走，只有${seed}会把日子推得越来越钝。`,
      `${seed}真正可怕的地方，不在剧烈，而在它看上去什么都没变。`
    ],
    "反差切入型": [
      `表面上，${seed}只是安静地待在那里；真正靠近以后才知道，里面早就换了潮水。`,
      `别人先看到的，总是${seed}最硬的那一层，后来才会发现，下面压着的其实是另一种软。`,
      `看起来像一件事，真正写进去时才会发现，${seed}里面一直挤着两种相反的力。`
    ]
  };

  const pool = pools[strategy] ?? pools["观点切入型"];
  const styleTail =
    styles.length > 0
      ? ` ${styles.includes("克制") ? "语气压住一点，不要太满。" : ""}${styles.includes("画面") ? "先让场景自己发声。" : ""}`.trim()
      : "";

  const content = normalizeText(`${pool[(candidateIndex - 1) % pool.length]}${styleTail ? ` ${styleTail}` : ""}`);

  return {
    text: content,
    providerName: "MiniMax",
    modelName: getModelName(),
    strategy
  };
}

function buildRecoveredOpeningForPlan(
  strategy: string,
  expressionMode: string,
  semanticTheme: string,
  candidateIndex: number,
  freshnessSeed = 0,
  recentOutputAvoidance: RecentOutputAvoidance[] = []
) {
  const theme = semanticTheme || "这个主题";

  const variants: Record<string, Record<string, string[]>> = {
    "画面切入型": {
      detail_focus: [
        `先落到一个小细节上，${theme}才真正有了可以往下展开的入口。`,
        `一个被忽略的细节先浮出来，${theme}的轮廓也就慢慢清楚了。`,
        `细节先站住，${theme}再往里走就不会显得空。`
      ],
      motion_focus: [
        `动作刚停下来，${theme}也跟着被带进了画面里。`,
        `他/她轻轻一停，${theme}的节奏就开始变得明显。`,
        `一个动作把场面打开，${theme}也因此有了落点。`
      ],
      sensory_focus: [
        `光线、声音和温度先把场景撑起来，${theme}才会显得更真。`,
        `感官先给出一层质地，${theme}再顺着那层质地往里沉。`,
        `空气里的变化先被捕捉到，${theme}就不只是概念了。`
      ],
      object_focus: [
        `一个物件先把场景钉住，${theme}就有了继续往下写的抓手。`,
        `那件不起眼的东西先出现，${theme}的重量也就跟着显出来。`,
        `先把视线落在物上，${theme}会更容易变成具体的场面。`
      ],
      atmosphere_focus: [
        `气息先稳下来，${theme}才会像真的进入了故事。`,
        `氛围先铺开，${theme}就能自然往前推进，而不是靠说明。`,
        `先把空气里的紧张感托住，${theme}就更容易成立。`
      ]
    },
    "情绪切入型": {
      body_signal: [
        `胸口先紧一下，${theme}才慢慢露出它真正的轮廓。`,
        `呼吸变得浅了一点，${theme}也就顺势压进心里。`,
        `身体先比语言诚实，${theme}便有了真正的起点。`
      ],
      inner_voice: [
        `我没有立刻说出来，但${theme}已经先在心里停住了。`,
        `有些感觉不需要讲得太满，${theme}只要轻轻一碰就够了。`,
        `内心先沉了一下，${theme}也就不是空话了。`
      ],
      memory_trigger: [
        `一个旧画面被碰到，${theme}就会跟着重新回来。`,
        `记忆里那点没有收好的东西一浮起来，${theme}便不再只是现在的事。`,
        `只要回想起那个瞬间，${theme}就开始变得更清楚。`
      ],
      quiet_scene: [
        `房间里安静得有点慢，${theme}就在这种安静里慢慢显形。`,
        `越是没有声音，${theme}越会显得重。`,
        `静下来之后，${theme}反而更容易被看见。`
      ],
      pressure_wave: [
        `那种慢慢收紧的感觉先到，${theme}随后才真正站稳。`,
        `压力不是一下子压下来，而是像${theme}这样，先轻轻碰一下，再慢慢加重。`,
        `真正难受的不是一下子发生，而是${theme}那样一点点逼近。`
      ]
    },
    "提问切入型": {
      direct_question: [
        `如果把${theme}真的摆到眼前，你会先怎么面对它？`,
        `当${theme}开始变得具体，最先冒出来的问题会是什么？`,
        `你会不会也想知道，${theme}到底是怎么一步步变成现在这样的？`
      ],
      self_question: [
        `我到底是在等${theme}，还是在等自己愿意正面看它？`,
        `是不是很多时候，我们不是不知道答案，只是还没准备好面对${theme}？`,
        `明明已经靠近了，为什么我还是会在${theme}前面停一下？`
      ],
      rhetorical_question: [
        `难道${theme}真的只是表面看起来那么简单吗？`,
        `为什么${theme}总会把原本很笃定的想法一下子打乱？`,
        `如果${theme}只是个开始，那后面到底还藏着什么？`
      ],
      scenario_question: [
        `要是${theme}就摆在今天的场景里，你会先从哪里下手？`,
        `当${theme}真的落到具体的人和事里，问题会先从哪一步冒出来？`,
        `如果把${theme}放进一个真实场面里，它会先逼出什么答案？`
      ],
      double_question: [
        `你会不会也有这种时候：${theme}明明已经来了，却还是想再拖一下？`,
        `既然${theme}迟早要面对，为什么人总是会下意识往后放？`,
        `明明知道${theme}不能一直回避，为什么还是会停在原地？`
      ]
    },
    "观点切入型": {
      judgment: [
        `${theme}真正开始起作用的时候，改变的往往不是表面，而是人看事情的顺序。`,
        `真正麻烦的通常不是${theme}本身，而是它出现以后，很多默认成立的东西都要重来。`,
        `面对${theme}，先变的常常不是结果，而是一个人的判断方式。`
      ],
      observation: [
        `很多时候，${theme}并不会一下子把人推翻，它只是先让一些细小的地方开始变形。`,
        `你越靠近${theme}，越会发现它不是一个单独的点，而是一连串变化。`,
        `被轻轻推开的那一下，${theme}其实已经开始改写节奏了。`
      ],
      paradox: [
        `最不像问题的${theme}，往往才是最容易把人卡住的地方。`,
        `有些${theme}看起来只是轻轻一碰，实际上却会把后面的路全带偏。`,
        `越是看起来没什么，${theme}越容易在后面突然发力。`
      ],
      rule_of_thumb: [
        `一旦${theme}被拖到最后一刻，很多原本还算从容的东西就会开始失去节奏。`,
        `只要${theme}被推迟，后面就很容易连着失去好几层余地。`,
        `通常一碰上${theme}，真正先乱的不是动作，而是安排。`
      ],
      turning_point: [
        `${theme}真正站到面前的时候，故事就已经不是原来的那个故事了。`,
        `从${theme}那一刻开始，事情往往会往另一个方向慢慢拐过去。`,
        `一旦${theme}过了那个点，后面的发展就不会再按原样走。`
      ]
    },
    "反差切入型": {
      appearance_vs_truth: [
        `看上去${theme}只是个普通起点，真正往里走时才会发现，里面的走向早就换了。`,
        `表面那层平静一掀开，${theme}露出来的就不是原来以为的那一面。`,
        `大家先看到的只是${theme}，真正藏着劲的部分却不在表面。`
      ],
      before_after: [
        `刚开始的${theme}还像一块没被碰过的布，往后走几步，纹理就全变了。`,
        `前一秒还像没事，后一秒${theme}就把人带进了另一种节奏里。`,
        `前面看着很稳，${theme}一落下来，后面的空气就不一样了。`
      ],
      expectation_gap: [
        `原本以为${theme}会很平，结果真正靠近才发现它藏着别的东西。`,
        `大家最开始看到的只是${theme}，没想到真正难的其实还在后面。`,
        `表面像一条直线，${theme}真正往里走却开始转弯。`
      ],
      small_twist: [
        `${theme}原来只是一个小口子，可真正进去以后，里面的空气已经完全不一样了。`,
        `看起来只是轻轻一转，${theme}就把原来的方向悄悄换掉了。`,
        `一个很小的变化，已经足够让${theme}的节奏偏开。`
      ],
      parallel_split: [
        `一边是${theme}的表面，一边是它暗下去的那部分，两个方向同时存在，却不在同一个节奏里。`,
        `外面看起来很稳，里面却已经偏了，${theme}就是这样把两种状态放在一起。`,
        `明面和暗处并排摆着，${theme}真正有意思的地方反而在分叉之后。`
      ]
    }
  };

  const strategyVariants = variants[strategy] ?? variants.statement;
  const modeVariants = strategyVariants[expressionMode] ?? Object.values(strategyVariants).flat();
  const pool = modeVariants.length > 0 ? modeVariants : Object.values(variants.statement).flat();
  const startIndex = Math.abs(candidateIndex - 1 + freshnessSeed) % Math.max(1, pool.length);
  let base = "";

  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const candidate = pool[(startIndex + attempt) % pool.length] ?? theme;
    if (!isRecentOutputCollision(candidate, strategy, recentOutputAvoidance)) {
      base = candidate;
      break;
    }
  }

  if (!base) {
    base = buildProviderEscapeOpening(
      strategy,
      semanticTheme,
      candidateIndex,
      freshnessSeed,
      recentOutputAvoidance,
      "recovered"
    );
  }

  const normalized = normalizeText(base.replaceAll("他/她", "他或她"));
  if (!isRecentOutputCollision(normalized, strategy, recentOutputAvoidance)) {
    return normalized;
  }

  return buildProviderEscapeOpening(
    strategy,
    semanticTheme,
    candidateIndex,
    freshnessSeed + 41,
    recentOutputAvoidance,
    "recovered"
  );
}

function buildRecoveredOpeningsFromPrompt(user: string, count: number) {
  const semanticTheme = extractSemanticTheme(user);
  const strategies = extractPlanStrategies(user);
  const expressionModes = extractPlanExpressionModes(user);
  const freshnessSeed = extractFreshnessSeed(user);
  const recentOutputAvoidance = extractRecentOutputAvoidance(user);

  return Array.from({ length: count }, (_, index) => {
    const strategy = strategies[index] || strategies[0] || "画面切入型";
    const expressionMode = expressionModes[index] || expressionModes[0] || "detail_focus";
    return {
      text: buildRecoveredOpeningForPlan(
        strategy,
        expressionMode,
        semanticTheme,
        index + 1,
        freshnessSeed,
        recentOutputAvoidance
      ),
      providerName: "MiniMax",
      modelName: getModelName(),
      strategy
    };
  });
}

function buildFallbackOpeningsFromPrompt(user: string, count: number) {
  const semanticTheme = extractSemanticTheme(user);
  const strategies = extractPlanStrategies(user);
  const freshnessSeed = extractFreshnessSeed(user);
  const recentOutputAvoidance = extractRecentOutputAvoidance(user);

  return Array.from({ length: count }, (_, index) => {
    const strategy = strategies[index] || strategies[0] || "观点切入型";
    return {
      text: buildProviderEscapeOpening(
        strategy,
        semanticTheme,
        index + 1,
        freshnessSeed + index * 17,
        recentOutputAvoidance,
        "fallback"
      ),
      providerName: "MiniMax",
      modelName: getModelName(),
      strategy
    };
  });
}

function parseEvaluationInput(user: string) {
  try {
    return JSON.parse(user) as {
      rawInput?: string;
      contentType?: string;
      styleOptions?: string[];
      candidates?: Array<{
        index?: number;
        strategyType?: string;
        openingStrategy?: string;
        styleLabel?: string;
        content?: string;
      }>;
    };
  } catch {
    return null;
  }
}

function countThemeOverlap(rawInput: string, content: string) {
  const sourceTokens = rawInput
    .replace(/\s+/g, "")
    .split(/[，。！？!?；;、]/)
    .filter((part) => part.length >= 2)
    .slice(0, 8);

  return sourceTokens.reduce((total, token) => total + (content.includes(token) ? 1 : 0), 0);
}

function buildMockEvaluationForCandidate(candidate: {
  index?: number;
  strategyType?: string;
  openingStrategy?: string;
  styleLabel?: string;
  content?: string;
}, rawInput: string, contentType?: string) {
  const content = candidate.content?.trim() || "";
  const baseLength = content.length;
  const hookStrength = Math.min(5, Math.max(1, /[？?]/.test(content) ? 5 : baseLength > 50 ? 4 : 3));
  const clarity = Math.min(5, Math.max(1, content.includes("，") ? 4 : 3));
  const novelty = Math.min(5, Math.max(1, /原来|没想到|一边是|偏偏|突然|轻轻/.test(content) ? 4 : 3));
  const emotionalResonance = Math.min(5, Math.max(1, /心|呼吸|沉默|停住|发紧|安静|情绪/.test(content) ? 4 : 3));
  const visualImagery = Math.min(5, Math.max(1, /[海雨风灯车门窗手眼夜街船影桌光]/.test(content) ? 4 : 3));
  const themeOverlap = countThemeOverlap(rawInput, content);
  const thematicFit = Math.min(5, Math.max(1, themeOverlap >= 2 ? 5 : themeOverlap === 1 ? 4 : 3));
  const totalScore = Math.round(
    (hookStrength * 0.24 +
      clarity * 0.12 +
      novelty * 0.18 +
      emotionalResonance * 0.12 +
      visualImagery * 0.14 +
      thematicFit * 0.2) * 20
  );

  const strengths: string[] = [];
  if (hookStrength >= 4) strengths.push("开头钩子足够早");
  if (thematicFit >= 4) strengths.push("主题贴得比较准");
  if (visualImagery >= 4) strengths.push("画面感比较清楚");
  if (novelty >= 4) strengths.push("句式不太像模板");
  if (strengths.length === 0) strengths.push("整体表达比较稳");

  const weaknesses: string[] = [];
  if (clarity <= 3) weaknesses.push("还可以再收紧表意");
  if (emotionalResonance <= 3) weaknesses.push("情绪张力还能再提一点");
  if (thematicFit <= 3) weaknesses.push("和主题的咬合度还可以再紧一点");
  if (weaknesses.length === 0) weaknesses.push("短板不明显，但还能再精炼");

  return {
    index: candidate.index ?? 1,
    totalScore,
    dimensions: {
      hookStrength,
      clarity,
      novelty,
      emotionalResonance,
      visualImagery,
      thematicFit
    },
    summary:
      contentType === "novel"
        ? "这条开头更偏叙事入口，场景和人物状态都比较容易继续展开。"
        : contentType === "essay"
          ? "这条开头更像情绪入口，适合继续往个人感受里写。"
          : "这条开头更像观点或问题入口，适合直接往下展开。",
    strengths,
    weaknesses
  };
}

function buildMockEvaluationResponse(input: { system: string; user: string }): GeneratedTextResult {
  const parsed = parseEvaluationInput(input.user);
  if (!parsed?.candidates?.length) {
    return {
      text: JSON.stringify({ evaluations: [] }),
      providerName: "MiniMax",
      modelName: getModelName()
    };
  }

  const evaluations = parsed.candidates.map((candidate, index) =>
    buildMockEvaluationForCandidate(candidate, parsed.rawInput || "", parsed.contentType)
  );

  return {
    text: JSON.stringify({ evaluations }),
    providerName: "MiniMax",
    modelName: getModelName(),
    llmMode: "mock",
    recoveryState: "mock"
  };
}

function buildMockRefinementResponse(input: { system: string; user: string }) {
  return {
    refinedText: buildMockRefinementText(input.user),
    providerName: "MiniMax",
    modelName: getModelName(),
    llmMode: "mock" as const,
    recoveryState: "mock" as const
  };
}

function collectStringFragments(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringFragments(item, depth + 1));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = ["text", "content", "value", "output", "message"];
  const fragments = preferredKeys.flatMap((key) => collectStringFragments(record[key], depth + 1));

  if (fragments.length > 0) {
    return fragments;
  }

  return Object.values(record).flatMap((item) => collectStringFragments(item, depth + 1));
}

function extractTextFromAnthropicResponse(response: Awaited<ReturnType<Anthropic["messages"]["create"]>>) {
  if (!("content" in response)) {
    throw new Error("MiniMax 返回了流式响应，但当前实现期望非流式文本。");
  }

  const blocks = response.content as Array<{ type?: string; text?: string }>;
  const text = blocks
    .flatMap((block) => {
      if (typeof block.text === "string") {
        return [block.text];
      }
      return collectStringFragments(block);
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("模型没有返回可解析的文本内容。");
  }

  return text;
}

async function callAnthropicCompatibleModel(input: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<GeneratedTextResult> {
  const client = new Anthropic({
    apiKey: getApiKey(),
    baseURL: getBaseUrl()
  });

  const response = await client.messages.create({
    model: getModelName(),
    max_tokens: input.maxTokens ?? 700,
    system: input.system,
    temperature: input.temperature ?? 1,
    thinking: {
      type: "disabled"
    },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: input.user }]
      }
    ]
  });

  return {
    text: normalizeText(extractTextFromAnthropicResponse(response)),
    providerName: "MiniMax",
    modelName: getModelName(),
    llmMode: "real",
    recoveryState: "strict"
  };
}

async function callAnthropicCompatibleOpeningModel(input: {
  system: string;
  user: string;
  count: number;
  temperature?: number;
  maxTokens?: number;
}): Promise<GeneratedTextResult[]> {
  const client = new Anthropic({
    apiKey: getApiKey(),
    baseURL: getBaseUrl()
  });

  const response = await client.messages.create({
    model: getModelName(),
    max_tokens: input.maxTokens ?? Math.min(900, 260 + input.count * 120),
    system: input.system,
    temperature: input.temperature ?? 0.7,
    thinking: {
      type: "disabled"
    },
    tool_choice: {
      type: "tool",
      name: "emit_opening_candidates",
      disable_parallel_tool_use: true
    },
    tools: [
      {
        name: "emit_opening_candidates",
        description: "Return opening candidates as structured JSON for the Kaichang opening generator.",
        input_schema: {
          type: "object",
          properties: {
            candidates: {
              type: "array",
              minItems: input.count,
              maxItems: input.count,
              items: {
                type: "object",
                properties: {
                  content: {
                    type: "string",
                    description: "A directly usable Chinese opening paragraph."
                  }
                },
                required: ["content"],
                additionalProperties: false
              }
            }
          },
          required: ["candidates"],
          additionalProperties: false
        }
      }
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: input.user }]
      }
    ]
  });

  const toolUse = response.content.find(
    (block) => block.type === "tool_use" && (block as { name?: string }).name === "emit_opening_candidates"
  ) as { id: string; type: "tool_use"; name: string; input: unknown } | undefined;

  if (!toolUse) {
    throw new Error("模型没有返回工具调用。");
  }

  const normalizedCandidates = parseStrictOpeningCandidatesPayload(toolUse.input, input.count);

  return normalizedCandidates.map((content) => ({
    text: content,
    providerName: "MiniMax",
    modelName: getModelName(),
    llmMode: "real",
    recoveryState: "strict"
  }));
}

async function callAnthropicCompatibleRefinementModel(input: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ refinedText: string; providerName: string; modelName: string; llmMode: "real"; recoveryState: "strict" }> {
  const client = new Anthropic({
    apiKey: getApiKey(),
    baseURL: getBaseUrl()
  });

  const response = await client.messages.create({
    model: getModelName(),
    max_tokens: input.maxTokens ?? 900,
    system: input.system,
    temperature: input.temperature ?? 0.75,
    thinking: {
      type: "disabled"
    },
    tool_choice: {
      type: "tool",
      name: "emit_refined_opening",
      disable_parallel_tool_use: true
    },
    tools: [
      {
        name: "emit_refined_opening",
        description: "Return a refined opening as structured JSON for the Kaichang refine flow.",
        input_schema: {
          type: "object",
          properties: {
            refinedText: {
              type: "string",
              description: "A directly usable Chinese opening paragraph."
            }
          },
          required: ["refinedText"],
          additionalProperties: false
        }
      }
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: input.user }]
      }
    ]
  });

  const toolUse = response.content.find(
    (block) => block.type === "tool_use" && (block as { name?: string }).name === "emit_refined_opening"
  ) as { id: string; type: "tool_use"; name: string; input: unknown } | undefined;

  if (!toolUse) {
    throw new BusinessError(
      "REFINE_STRUCTURED_OUTPUT_INVALID",
      "模型没有按结构化格式返回改写结果。",
      502
    );
  }

  const refinedText = parseStrictRefinementPayload(toolUse.input);

  return {
    refinedText,
    providerName: "MiniMax",
    modelName: getModelName(),
    llmMode: "real",
    recoveryState: "strict"
  };
}

function extractLooseCandidateTexts(text: string) {
  const normalized = normalizeText(text);
  const blocks: string[] = [];
  const numberedBlockPattern = /(?:^|\n)\s*(?:候选|开头|回答)?\s*(\d+)\s*[\.\)：:\-]\s*([\s\S]*?)(?=(?:\n\s*(?:候选|开头|回答)?\s*\d+\s*[\.\)：:\-])|$)/g;

  for (const match of normalized.matchAll(numberedBlockPattern)) {
    const block = normalizeRecoveredCandidate(match[2]);
    if (block.length > 0) {
      blocks.push(block);
    }
  }

  if (blocks.length > 0) {
    return Array.from(new Set(blocks));
  }

  const paragraphBlocks = normalized
    .split(/\n{2,}/)
    .map((item) => normalizeRecoveredCandidate(item))
    .filter((item) => item.length >= 8);

  if (paragraphBlocks.length > 0) {
    return Array.from(new Set(paragraphBlocks));
  }

  const sentenceBlocks = normalized
    .split(/\n+/)
    .map((item) => normalizeRecoveredCandidate(item))
    .filter((item) => item.length >= 8);

  return Array.from(new Set(sentenceBlocks));
}

function normalizeRecoveredCandidate(text: string) {
  return normalizeText(text)
    .replace(/^\s*(?:候选|开头|回答)?\s*\d+\s*[\.\)：:\-]\s*/i, "")
    .replace(/^\s*(?:内容|正文|结果|文本)\s*[:：]\s*/i, "")
    .replace(/^[-*•]\s*/gm, "")
    .trim();
}

function fillRecoveredCandidateTexts(input: {
  text: string;
  count: number;
  user: string;
}) {
  const recoveredTexts = extractLooseCandidateTexts(input.text);
  if (recoveredTexts.length === 0) {
    return buildRecoveredOpeningsFromPrompt(input.user, input.count).map((item) => normalizeText(item.text));
  }

  const recoveredFallbackCandidates = buildRecoveredOpeningsFromPrompt(input.user, input.count);
  const filled = Array.from({ length: input.count }, (_, index) => {
    const recovered = recoveredTexts[index];
    if (recovered) {
      return recovered;
    }

    return recoveredFallbackCandidates[index]?.text ?? recoveredFallbackCandidates[0]?.text ?? recoveredTexts[0];
  });

  return filled.map((item) => normalizeText(item));
}

export function createMiniMaxProvider(): LlmProvider {
  if (!hasRealKey() || process.env.MOCK_LLM === "1") {
    logInfo("llm/minimax", "provider initialized in mock mode", {
      hasRealKey: hasRealKey(),
      mockFlag: process.env.MOCK_LLM === "1",
      modelName: getModelName()
    });
    return {
      providerName: "MiniMax",
      modelName: getModelName(),
      llmMode: "mock",
      async generateText(input) {
        if (isEvaluationPrompt(input)) {
          return {
            ...buildMockEvaluationResponse(input),
            llmMode: "mock" as const,
            recoveryState: "mock" as const
          };
        }

        const mock = buildLightweightMockOpening(input.user);

        return {
          text: mock.text,
          providerName: mock.providerName,
          modelName: mock.modelName,
          llmMode: "mock" as const,
          recoveryState: "mock" as const
        } satisfies GeneratedTextResult;
      },
      async generateOpenings(input) {
        if (isEvaluationPrompt(input)) {
          return JSON.parse(buildMockEvaluationResponse(input).text).evaluations.map((item: any) => ({
            text: JSON.stringify(item),
            providerName: "MiniMax",
            modelName: getModelName(),
            llmMode: "mock" as const,
            recoveryState: "mock" as const
          } satisfies GeneratedTextResult));
        }

        const mockPayload = {
          candidates: Array.from({ length: input.count }, (_, index) => buildLightweightMockOpening(input.user, index + 1)).map((item) => ({
            content: item.text
          }))
        };
        const normalizedCandidates = parseStrictOpeningCandidatesPayload(mockPayload, input.count);

        return normalizedCandidates.map((text) => ({
          text,
          providerName: "MiniMax",
          modelName: getModelName(),
          llmMode: "mock" as const,
          recoveryState: "mock" as const
        } satisfies GeneratedTextResult));
      },
      async generateRefinement(input) {
        return buildMockRefinementResponse(input);
      }
    };
  }

  return {
    providerName: "MiniMax",
    modelName: getModelName(),
    llmMode: "real",
    async generateText(input) {
      logInfo("llm/minimax", "generateText request", {
        modelName: getModelName(),
        temperature: input.temperature ?? 1,
        maxTokens: input.maxTokens ?? 700,
        systemPreview: input.system.slice(0, 80),
        userPreview: input.user.slice(0, 80)
      });
      return callAnthropicCompatibleModel(input);
    },
    async generateOpenings(input) {
      try {
        logInfo("llm/minimax", "generateOpenings request", {
          modelName: getModelName(),
          count: input.count,
          temperature: input.temperature ?? 0.7,
          maxTokens: input.maxTokens ?? Math.min(900, 260 + input.count * 120),
          systemPreview: input.system.slice(0, 80),
          userPreview: input.user.slice(0, 80)
        });
        const generatedCandidates = await callAnthropicCompatibleOpeningModel({
          system: input.system,
          user: input.user,
          count: input.count,
          temperature: input.temperature ?? 0.7,
          maxTokens: input.maxTokens ?? Math.min(900, 260 + input.count * 120)
        });

        return generatedCandidates;
      } catch (error) {
        logWarn("llm/minimax", "generateOpenings failed", {
          modelName: getModelName(),
          error: summarizeError(error)
        });
        throw error;
      }
    },
    async generateRefinement(input) {
      try {
        logInfo("llm/minimax", "generateRefinement request", {
          modelName: getModelName(),
          temperature: input.temperature ?? 0.75,
          maxTokens: input.maxTokens ?? 900,
          systemPreview: input.system.slice(0, 80),
          userPreview: input.user.slice(0, 80)
        });
        return callAnthropicCompatibleRefinementModel({
          system: input.system,
          user: input.user,
          temperature: input.temperature,
          maxTokens: input.maxTokens
        });
      } catch (error) {
        logWarn("llm/minimax", "generateRefinement failed", {
          modelName: getModelName(),
          error: summarizeError(error)
        });
        throw error;
      }
    }
  };
}
