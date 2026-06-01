"use client";

import { useState } from "react";
import type { OpeningCandidateView } from "@/server/opening/types";

type OpeningCardProps = {
  candidate: OpeningCandidateView;
  onCopy: (candidate: OpeningCandidateView) => void | Promise<void>;
  onFeedback: (
    candidate: OpeningCandidateView,
    type: "like" | "dislike",
    reasonTag?: string
  ) => void | Promise<void>;
};

const REFINE_OPTIONS = [
  { instruction: "more_hook" as const, label: "🔥 更抓人" },
  { instruction: "more_subtle" as const, label: "🌫 更克制" },
  { instruction: "more_visual" as const, label: "🎬 更画面" },
  { instruction: "more_literary" as const, label: "✍️ 更文学" }
];

const REASON_TAGS = [
  "太平淡",
  "太直白",
  "没画面感",
  "不像人写的",
  "不符合我风格"
];

export function OpeningCard({ candidate, onCopy, onFeedback }: OpeningCardProps) {
  const [refinedPreview, setRefinedPreview] = useState<{ instructionLabel: string; text: string } | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [feedbackMode, setFeedbackMode] = useState<"like" | "dislike" | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  async function handleRefine(instruction: (typeof REFINE_OPTIONS)[number]["instruction"], label: string) {
    setIsRefining(true);
    setRefineError(null);

    try {
      const response = await fetch("/api/refine-opening", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          candidateId: candidate.id,
          instruction
        })
      });

      const payload = (await response.json()) as { refinedText?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "微调失败，请稍后再试。");
      }

      setRefinedPreview({
        instructionLabel: label,
        text: payload.refinedText ?? ""
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "微调失败，请稍后再试。";
      setRefineError(message);
    } finally {
      setIsRefining(false);
    }
  }

  async function handleReasonTagSelect(type: "like" | "dislike", reasonTag: string) {
    setFeedbackLoading(true);
    setFeedbackError(null);

    try {
      await onFeedback(candidate, type, reasonTag);

      setFeedbackMode(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "反馈失败，请稍后再试。";
      setFeedbackError(message);
    } finally {
      setFeedbackLoading(false);
    }
  }

  function openReasonTagMenu(type: "like" | "dislike") {
    setFeedbackMode(type);
    setFeedbackError(null);
  }

  return (
    <article className={`opening-card${candidate.isCopied ? " is-copied" : ""}`}>
      <div className="card-head">
        <div className="card-labels">
          <span className="label-pill is-strategy">{candidate.openingStrategy}</span>
          <span className="label-pill">{candidate.strategyType}</span>
          <span className="label-pill">{candidate.styleLabel}</span>
          <span className="label-pill">评分 {candidate.qualityScore}</span>
          {candidate.isSelected ? <span className="label-pill is-selected">已选中</span> : null}
        </div>
      </div>

      <p className="opening-copy">{candidate.content}</p>

      <div className="refine-section">
        <div className="refine-title">微调开头</div>
        <div className="refine-actions">
          {REFINE_OPTIONS.map((option) => (
            <button
              key={option.instruction}
              className="result-action"
              type="button"
              onClick={() => handleRefine(option.instruction, option.label)}
              disabled={isRefining}
            >
              {option.label}
            </button>
          ))}
        </div>
        {refineError ? <div className="refine-note is-error">{refineError}</div> : null}
        {refinedPreview ? (
          <div className="refined-preview">
            <div className="refined-preview-head">{refinedPreview.instructionLabel}</div>
            <p className="refined-copy">{refinedPreview.text}</p>
          </div>
        ) : null}
      </div>

      <div className="card-actions">
        <button className="result-action is-primary" type="button" onClick={() => onCopy(candidate)}>
          {candidate.isCopied ? "已复制" : "复制"}
        </button>
        <button className="result-action" type="button" onClick={() => openReasonTagMenu("like")}>
          👍 喜欢
        </button>
        <button className="result-action" type="button" onClick={() => openReasonTagMenu("dislike")}>
          👎 不喜欢
        </button>
      </div>

      {feedbackMode ? (
        <div className="reason-tag-panel">
          <div className="refine-title">选择原因标签</div>
          <div className="reason-tag-grid">
            {REASON_TAGS.map((tag) => (
              <button
                key={tag}
                className="reason-tag-button"
                type="button"
                disabled={feedbackLoading}
                onClick={() => handleReasonTagSelect(feedbackMode, tag)}
              >
                {tag}
              </button>
            ))}
            <button className="reason-tag-button is-cancel" type="button" onClick={() => setFeedbackMode(null)}>
              取消
            </button>
          </div>
          {feedbackError ? <div className="refine-note is-error">{feedbackError}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
