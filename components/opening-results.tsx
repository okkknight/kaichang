"use client";

import { OpeningCard } from "@/components/opening-card";
import type { EvaluationState, GenerationState, LlmMode, OpeningCandidateView } from "@/server/opening/types";

type OpeningResultsProps = {
  candidates: OpeningCandidateView[];
  usageRemaining: number | null;
  isGenerating: boolean;
  llmMode?: LlmMode | null;
  generationState?: GenerationState | null;
  evaluationState?: EvaluationState | null;
  onCopy: (candidate: OpeningCandidateView) => void | Promise<void>;
  onFeedback: (
    candidate: OpeningCandidateView,
    type: "like" | "dislike",
    reasonTag?: string
  ) => void | Promise<void>;
};

export function OpeningResults({
  candidates,
  usageRemaining,
  isGenerating,
  llmMode,
  generationState,
  onCopy,
  onFeedback
}: OpeningResultsProps) {
  const generationNotice =
    generationState === "mock" || llmMode === "mock"
      ? {
          title: "当前为 mock 生成",
          copy: "仅用于开发 / 联调，这组结果不代表真实线上模型质量。",
          className: "is-mock"
        }
      : generationState === "recovered"
        ? {
            title: "真实模型结果已自动修复",
            copy: "这次生成来自真实模型，系统已自动修复格式偏差，结果仍可正常使用。",
            className: "is-recovered"
          }
        : generationState === "fallback" || llmMode === "fallback"
        ? {
            title: "当前模型暂不可用",
            copy: "已使用降级生成，请留意这组结果可能比真实模型更保底。",
            className: "is-fallback"
          }
        : null;

  return (
    <section className="results-panel">
      {generationNotice ? (
        <div className={`generation-mode-banner ${generationNotice.className}`}>
          <div className="generation-mode-title">{generationNotice.title}</div>
          <div className="generation-mode-copy">{generationNotice.copy}</div>
        </div>
      ) : null}

      <div className="results-head">
        <div>
          <h2 className="results-title">候选开场</h2>
          <div className="results-meta">
            {candidates.length > 0
              ? isGenerating
                ? `已先返回 ${candidates.length} 条候选，后面的还在继续补齐。`
                : `${candidates.length} 条候选已经准备好了。`
              : isGenerating
                ? "正在生成，这次结果会替换上一轮。"
                : "生成之后，结果会在这里展示。"}
          </div>
        </div>
        <div className="results-meta">
          {typeof usageRemaining === "number"
            ? `今日剩余 ${usageRemaining} 次`
            : "额度信息将在生成后显示"}
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="results-empty">
          {isGenerating
            ? "正在等模型返回候选，返回后这里会展示 3 到 5 个开场。"
            : "这里会显示 3 到 5 个候选开头。每条都应该有不同入口，比如画面切入、情绪切入、冲突切入、提问切入，避免所有结果都像同一段话的换皮版本。"}
        </div>
      ) : (
        <div className="results-grid">
          {candidates.map((candidate) => (
            <OpeningCard key={candidate.id} candidate={candidate} onCopy={onCopy} onFeedback={onFeedback} />
          ))}
        </div>
      )}
    </section>
  );
}
