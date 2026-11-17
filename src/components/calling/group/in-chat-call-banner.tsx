"use client";

import { useState } from "react";
import { Phone, Users, Video } from "lucide-react";

export interface ActiveGroupCallSummary {
  callId: string;
  type: "AUDIO" | "VIDEO";
  hostName: string;
  participantCount: number;
  startedAt?: string | null;
}

interface InChatCallBannerProps {
  call: ActiveGroupCallSummary;
  isUserInCall?: boolean;
  onJoin: (callId: string) => Promise<void> | void;
}

export function InChatCallBanner({
  call,
  isUserInCall = false,
  onJoin,
}: InChatCallBannerProps) {
  const [isJoining, setIsJoining] = useState(false);

  if (isUserInCall) return null;

  const isVideo = call.type === "VIDEO";

  const handleJoin = async () => {
    if (isJoining) return;
    setIsJoining(true);
    try {
      await onJoin(call.callId);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Active group meeting in this channel"
      className="flex items-center justify-between gap-4 border-b border-emerald-500/30 bg-emerald-50/80 px-4 py-2.5 text-emerald-950 backdrop-blur-sm dark:bg-emerald-950/40 dark:text-emerald-100 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
          {isVideo ? <Video size={16} /> : <Phone size={16} />}
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Active {isVideo ? "Video" : "Audio"} Call
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-200/60 px-2 py-0.2 text-[10px] font-medium text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200">
              <Users size={10} />
              {call.participantCount} {call.participantCount === 1 ? "participant" : "participants"}
            </span>
          </div>
          <p className="truncate text-xs text-[var(--muted)]">
            Started by <span className="font-medium text-[var(--text)]">{call.hostName}</span>
          </p>
        </div>
      </div>

      <button
        onClick={handleJoin}
        disabled={isJoining}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
      >
        {isVideo ? <Video size={14} /> : <Phone size={14} />}
        <span>{isJoining ? "Joining..." : "Join Call"}</span>
      </button>
    </div>
  );
}

