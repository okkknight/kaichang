"use client";

import { STYLE_OPTIONS } from "@/server/opening/types";

type StyleSelectorProps = {
  selectedStyles: string[];
  onToggleStyle: (style: string) => void;
};

export function StyleSelector({ selectedStyles, onToggleStyle }: StyleSelectorProps) {
  return (
    <div className="style-group">
      <div className="style-header">
        <div className="style-title">开头风格</div>
        <div className="style-subtitle">不选也可以，系统会自动判断</div>
      </div>
      <div className="chip-grid">
        {STYLE_OPTIONS.map((style) => {
          const active = selectedStyles.includes(style.label);
          return (
            <button
              key={style.label}
              type="button"
              className={`chip-button${active ? " is-active" : ""}`}
              onClick={() => onToggleStyle(style.label)}
            >
              {style.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
