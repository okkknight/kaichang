"use client";

import { OpeningCard } from "@/components/opening-card";
import type { OpeningCandidateView } from "@/server/opening/types";

type OpeningResultsProps = {
  candidates: OpeningCandidateView[];
  usageRemaining: number | null;
  onCopy: (candidate: OpeningCandidateView) => void | Promise<void>;
};

export function OpeningResults({ candidates, usageRemaining, onCopy }: OpeningResultsProps) {
  return (
    <section className="results-panel">
      <div className="results-head">
        <div>
          <h2 className="results-title">候选开场</h2>
          <div className="results-meta">
            {candidates.length > 0 ? `${candidates.length} 条候选已经准备好了。` : "生成之后，结果会在这里展示。"}
          </div>
        </div>
        <div className="results-meta">
          {typeof usageRemaining === "number" ? `今日剩余 ${usageRemaining} 次` : "额度信息将在生成后显示"}
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="results-empty">
          这里会显示 3 到 5 个候选开头。每条都应该有不同入口，比如画面切入、情绪切入、冲突切入、提问切入，避免所有结果都像同一段话的换皮版本。
        </div>
      ) : (
        <div className="results-grid">
          {candidates.map((candidate) => (
            <OpeningCard key={candidate.id} candidate={candidate} onCopy={onCopy} />
          ))}
        </div>
      )}
    </section>
  );
}
