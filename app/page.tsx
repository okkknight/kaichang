"use client";

import { useEffect, useMemo, useState } from "react";
import { HeroInput } from "@/components/hero-input";
import { OpeningResults } from "@/components/opening-results";
import { STYLE_OPTIONS, type OpeningCandidateView } from "@/server/opening/types";

const MAX_INPUT_LENGTH = 2000;
const MIN_INPUT_LENGTH = 20;

export default function HomePage() {
  const [rawInput, setRawInput] = useState("");
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<string>("把你的念头、情绪、构思丢给我，我们先把第一段站起来。");
  const [statusKind, setStatusKind] = useState<"idle" | "error" | "success">("idle");
  const [candidates, setCandidates] = useState<OpeningCandidateView[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [usageRemaining, setUsageRemaining] = useState<number | null>(null);

  useEffect(() => {
    document.documentElement.style.scrollBehavior = "smooth";
  }, []);

  const inputLength = rawInput.trim().length;
  const canGenerate = useMemo(() => {
    return inputLength >= MIN_INPUT_LENGTH && inputLength <= MAX_INPUT_LENGTH && !isGenerating;
  }, [inputLength, isGenerating]);

  async function handleGenerate() {
    if (inputLength < MIN_INPUT_LENGTH) {
      setStatusKind("error");
      setStatus("内容至少需要 20 个字，先给我一点感觉就行。");
      return;
    }

    if (inputLength > MAX_INPUT_LENGTH) {
      setStatusKind("error");
      setStatus("内容最多 2000 个字，先保留最关键的念头。");
      return;
    }

    setIsGenerating(true);
    setStatusKind("idle");
    setStatus("正在组织策略，帮你拆开第一段的入口。");

    try {
      const response = await fetch("/api/generate-openings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          rawInput,
          styleOptions: selectedStyles,
          candidateCount: 4
        })
      });

      const payload = (await response.json()) as {
        requestId?: string;
        candidates?: OpeningCandidateView[];
        usageRemaining?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "生成失败，请稍后再试。");
      }

      setRequestId(payload.requestId ?? null);
      setCandidates(payload.candidates ?? []);
      setUsageRemaining(typeof payload.usageRemaining === "number" ? payload.usageRemaining : null);
      setStatusKind("success");
      setStatus("开头已经排好队了，可以挑一条最像你要的。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败，请稍后再试。";
      setStatusKind("error");
      setStatus(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCopy(candidate: OpeningCandidateView) {
    try {
      await navigator.clipboard.writeText(candidate.content);
      setCandidates((current) =>
        current.map((item) =>
          item.id === candidate.id
            ? { ...item, isCopied: true }
            : item
        )
      );

      if (requestId) {
        await fetch("/api/copy-event", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            candidateId: candidate.id,
            generationRequestId: requestId
          })
        });
      }

      setStatusKind("success");
      setStatus("已经复制到剪贴板。");
    } catch {
      setStatusKind("error");
      setStatus("复制失败了，可以手动选中后再试一次。");
    }
  }

  return (
    <div className="app-shell">
      <main className="page-grid">
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-mark">开</span>
            <span className="brand-copy">
              <span className="brand-title">开场</span>
              <span className="brand-subtitle">写不出来时，先写出第一段</span>
            </span>
          </a>
          <button className="ghost-button" type="button" disabled>
            登录预留
          </button>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">中文优先 · 开头生成器 · A 阶段主链路</div>
            <h1 className="hero-title">把第一段先点燃。</h1>
            <p className="hero-lede">
              你不用把整篇都想明白。把一点感觉、一点情绪、一个场景丢给我，我会先给你
              3 到 5 个开场候选，让你挑到那个真正想继续写下去的起点。
            </p>

            <div className="hero-metrics">
              <div className="metric">
                <strong>3-5 个候选</strong>
                <span>不是一条泛泛答案，而是不同策略的开头对照。</span>
              </div>
              <div className="metric">
                <strong>输入先分析</strong>
                <span>先判断是小说、随笔还是内容文案，再分配开头策略。</span>
              </div>
              <div className="metric">
                <strong>可复制可落库</strong>
                <span>生成、复制、额度、候选都保留在数据层，便于后续扩展。</span>
              </div>
            </div>
          </div>

          <HeroInput
            rawInput={rawInput}
            onRawInputChange={setRawInput}
            selectedStyles={selectedStyles}
            onToggleStyle={(style) =>
              setSelectedStyles((current) =>
                current.includes(style)
                  ? current.filter((item) => item !== style)
                  : [...current, style]
              )
            }
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            inputLength={inputLength}
            minLength={MIN_INPUT_LENGTH}
            maxLength={MAX_INPUT_LENGTH}
            status={status}
            statusKind={statusKind}
          />
        </section>

        <OpeningResults
          candidates={candidates}
          usageRemaining={usageRemaining}
          onCopy={handleCopy}
        />

        <section className="tiny-note">
          当前风格标签：{STYLE_OPTIONS.map((item) => item.label).join("、")}。
        </section>
      </main>
    </div>
  );
}
