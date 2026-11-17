"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneOff, Users, Video, X } from "lucide-react";
import { Avatar } from "@/components/ui";
import { playIncomingRingtone, stopIncomingRingtone } from "../ringtone";

export interface GroupIncomingCallData {
  callId: string;
  conversationId: string;
  conversationName?: string | null;
  type: "AUDIO" | "VIDEO";
  initiator: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  participantCount?: number;
  ringTimeoutAt?: string | null;
}

interface GroupIncomingCallModalProps {
  call: GroupIncomingCallData | null;
  onAccept: (call: GroupIncomingCallData) => void;
  onDecline: (call: GroupIncomingCallData) => void;
  onDismiss: () => void;
}

export function GroupIncomingCallModal({
  call,
  onAccept,
  onDecline,
  onDismiss,
}: GroupIncomingCallModalProps) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (call) {
      playIncomingRingtone();
    } else {
      stopIncomingRingtone();
    }
    return () => {
      stopIncomingRingtone();
    };
  }, [call]);

  if (!call) return null;

  const isVideo = call.type === "VIDEO";
  const groupTitle = call.conversationName || "Group Meeting";

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    stopIncomingRingtone();
    try {
      await onAccept(call);
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy(true);
    stopIncomingRingtone();
    try {
      await onDecline(call);
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    stopIncomingRingtone();
    onDismiss();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming group ${isVideo ? "video" : "audio"} call: ${groupTitle}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={handleDismiss}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition"
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>

        {/* Ringing Avatar Animation with group icon */}
        <div className="relative mx-auto mb-4 flex h-20 w-20 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/20 opacity-75" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-[#f0efff] dark:bg-[#302c4e] ring-4 ring-accent/30 shadow-md">
            <Avatar name={call.initiator.name} src={call.initiator.avatarUrl} size="lg" />
            <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white shadow-sm ring-2 ring-[var(--surface)]">
              <Users size={12} />
            </div>
          </div>
        </div>

        <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
          {isVideo ? <Video size={13} /> : <Phone size={13} />}
          <span>Incoming Group {isVideo ? "Video" : "Audio"} Call</span>
        </div>

        <h3 className="mt-2 text-lg font-bold tracking-tight text-[var(--text)] truncate px-2" title={groupTitle}>
          {groupTitle}
        </h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Started by <span className="font-medium text-[var(--text)]">{call.initiator.name}</span>
        </p>

        {call.participantCount && call.participantCount > 1 ? (
          <p className="mt-1 text-[11px] text-accent font-medium">
            {call.participantCount} members currently active
          </p>
        ) : null}

        {/* Action Controls */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={handleDecline}
            disabled={busy}
            aria-label="Decline call"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition hover:bg-rose-700 active:scale-95 disabled:opacity-50"
            title="Decline"
          >
            <PhoneOff size={20} />
          </button>
          <button
            onClick={handleAccept}
            disabled={busy}
            aria-label="Join call"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50 ring-4 ring-emerald-500/20"
            title="Join"
          >
            {isVideo ? <Video size={20} /> : <Phone size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}

