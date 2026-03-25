"use client";

import type { OpeningCandidateView } from "@/server/opening/types";

type OpeningCardProps = {
  candidate: OpeningCandidateView;
  onCopy: (candidate: OpeningCandidateView) => void | Promise<void>;
};

export function OpeningCard({ candidate, onCopy }: OpeningCardProps) {
  return (
    <article className={`opening-card${candidate.isCopied ? " is-copied" : ""}`}>
      <div className="card-head">
        <div className="card-labels">
          <span className="label-pill is-strategy">{candidate.openingStrategy}</span>
          <span className="label-pill">{candidate.styleLabel}</span>
          <span className="label-pill">评分 {candidate.qualityScore}</span>
        </div>
      </div>

      <p className="opening-copy">{candidate.content}</p>

      <div className="card-actions">
        <button className="result-action is-primary" type="button" onClick={() => onCopy(candidate)}>
          {candidate.isCopied ? "已复制" : "复制"}
        </button>
      </div>
    </article>
  );
}
