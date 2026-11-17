"use client";

import React, { useState } from "react";
import { Cyraops3DLogo, VoiceLogoState } from "./cyraops-3d-logo";

interface VoiceNavButtonProps {
  isOpen: boolean;
  onToggle: () => void;
  voiceState?: VoiceLogoState;
  amplitude?: number;
}

export function VoiceNavButton({
  isOpen,
  onToggle,
  voiceState = "IDLE",
  amplitude = 0,
}: VoiceNavButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const tooltipText = isOpen ? "Close Voice Assistant" : "Start Voice Assistant (⌥V)";

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Cyraops Voice Assistant"
        aria-expanded={isOpen}
        title={tooltipText}
        className={`group relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
          isOpen
            ? "border-emerald-500/40 bg-emerald-50/60 shadow-[0_0_12px_rgba(126,175,142,0.45)] dark:border-emerald-500/40 dark:bg-emerald-950/40"
            : "border-[var(--border)] bg-[var(--surface)] hover:scale-105 hover:border-emerald-400/50 hover:shadow-[0_0_12px_rgba(126,175,142,0.4)]"
        }`}
      >
        {/* Active pulsating beacon ring when voice session is running */}
        {isOpen && (
          <span className="absolute -inset-0.5 animate-ping rounded-xl bg-emerald-400/25 duration-1000" />
        )}

        {/* 3D Cyraops Logo miniature (34x34px) */}
        <div className="relative z-10 flex h-[34px] w-[34px] items-center justify-center overflow-hidden">
          <Cyraops3DLogo
            size="sm"
            state={isOpen ? voiceState : "IDLE"}
            amplitude={isOpen ? amplitude : 0}
          />
        </div>
      </button>

      {/* Accessible Tooltip */}
      {isHovered && (
        <div
          role="tooltip"
          className="absolute -bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-md transition-opacity dark:bg-neutral-800"
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}

