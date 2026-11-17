"use client";

import { Sparkles } from "lucide-react";

/**
 * The assistant's identity mark.
 *
 * Ours had a generic lucide icon on a flat blue circle, which is most of why the
 * surface read as "admin panel". This is a gradient orb with a halo that reacts
 * to work — one small thing that gives the bot a character.
 */
export function BotOrb({
  size = 28,
  working = false,
  halo = false,
}: {
  size?: number;
  working?: boolean;
  halo?: boolean;
}) {
  return (
    <span
      className={`cy-orb relative inline-flex shrink-0 items-center justify-center rounded-full ${halo ? "cy-orb-halo" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Sparkles size={Math.round(size * 0.5)} className="text-white" strokeWidth={2.2} />
      {working && (
        <span
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 3px var(--accent-ring)", animation: "cy-halo 1.6s var(--ease-out) infinite" }}
        />
      )}
    </span>
  );
}
