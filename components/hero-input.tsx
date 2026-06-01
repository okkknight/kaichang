"use client";

import { StyleSelector } from "@/components/style-selector";

type HeroInputProps = {
  rawInput: string;
  onRawInputChange: (value: string) => void;
  selectedStyles: string[];
  onToggleStyle: (style: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  canGenerate: boolean;
  inputLength: number;
  minLength: number;
  maxLength: number;
  status: string;
  statusKind: "idle" | "error" | "success";
};

export function HeroInput({
  rawInput,
  onRawInputChange,
  selectedStyles,
  onToggleStyle,
  onGenerate,
  isGenerating,
  canGenerate,
  inputLength,
  minLength,
  maxLength,
  status,
  statusKind
}: HeroInputProps) {
  return (
    <aside className="input-panel">
      <h2 className="panel-title">写下你的念头</h2>
      <p className="panel-description">
        你可以只写一点情绪、一个人物、一个场景，或者一个很模糊的要求。我会先帮你搭出第一段的门。
      </p>

      <label htmlFor="raw-input" className="sr-only">
        输入内容
      </label>
      <textarea
        id="raw-input"
        className="text-input"
        value={rawInput}
        onChange={(event) => onRawInputChange(event.target.value)}
        placeholder="比如：我想写一个关于海上女船长的故事，她表面强势，内心很重感情，开头要有宿命感和画面感。"
      />

      <div className="field-row">
        <div className="hint">
          {inputLength} / {maxLength} 字，至少 {minLength} 字
        </div>
        <button className="primary-button" type="button" onClick={onGenerate} disabled={!canGenerate}>
          {isGenerating ? "正在生成" : "生成开场"}
        </button>
      </div>

      <StyleSelector selectedStyles={selectedStyles} onToggleStyle={onToggleStyle} />

      <div className="status-line">
        <div className={`status-text${statusKind === "error" ? " is-error" : ""}${statusKind === "success" ? " is-success" : ""}`}>
          {status}
        </div>
      </div>
    </aside>
  );
}
