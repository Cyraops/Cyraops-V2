"use client";

import { Phone, Video } from "lucide-react";

interface CallHeaderControlsProps {
  disabled?: boolean;
  /** Shown as the tooltip when calling cannot work yet. */
  disabledReason?: string | null;
  onStartAudioCall: () => void;
  onStartVideoCall: () => void;
}

export function CallHeaderControls({
  disabled = false,
  disabledReason = null,
  onStartAudioCall,
  onStartVideoCall,
}: CallHeaderControlsProps) {
  const title = disabled && disabledReason ? disabledReason : "Start audio call";
  return (
    <div className="flex items-center gap-1 sm:gap-1.5">
      <button
        onClick={onStartAudioCall}
        disabled={disabled}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-accent disabled:opacity-40"
        title={title}
        aria-label="Start audio call"
      >
        <Phone size={16} />
      </button>

      <button
        onClick={onStartVideoCall}
        disabled={disabled}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-accent disabled:opacity-40"
        title={disabled && disabledReason ? disabledReason : "Start video call"}
        aria-label="Start video call"
      >
        <Video size={17} />
      </button>
    </div>
  );
}

