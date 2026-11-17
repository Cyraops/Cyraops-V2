"use client";

import { useState } from "react";
import {
  X,
  UserPlus,
  Crown,
  Mic,
  MicOff,
  Video,
  VideoOff,
  UserX,
  ArrowRightLeft,
  VolumeX,
} from "lucide-react";
import { Avatar } from "@/components/ui";

export interface RosterMember {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  isHost: boolean;
  status: "CONNECTED" | "CONNECTING" | "RINGING" | "DISCONNECTED";
  isMuted: boolean;
  isCameraOff: boolean;
  audioTrackSid?: string;
}

export interface ParticipantRosterProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInviteModal: () => void;
  participants: RosterMember[];
  currentUserId: string;
  isCurrentUserHost: boolean;
  onMuteParticipant?: (userId: string, trackSid?: string) => Promise<void>;
  onKickParticipant?: (userId: string) => Promise<void>;
  onTransferHost?: (newHostUserId: string) => Promise<void>;
}

export function ParticipantRoster({
  isOpen,
  onClose,
  onOpenInviteModal,
  participants,
  currentUserId,
  isCurrentUserHost,
  onMuteParticipant,
  onKickParticipant,
  onTransferHost,
}: ParticipantRosterProps) {
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [isMutingAll, setIsMutingAll] = useState(false);
  const [muteAllStatus, setMuteAllStatus] = useState<string | null>(null);
  const [muteAllError, setMuteAllError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleMute = async (userId: string, trackSid?: string) => {
    if (!onMuteParticipant || !trackSid || busyActionId) return;
    setBusyActionId(userId);
    try {
      await onMuteParticipant(userId, trackSid);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleMuteAll = async () => {
    if (isMutingAll || !onMuteParticipant || !isCurrentUserHost) return;

    // Filter remote participants who are not the host, have an audio track, and are not marked muted
    const targets = participants.filter(
      (p) => !p.isHost && p.userId !== currentUserId && !p.isMuted && p.audioTrackSid
    );

    if (targets.length === 0) {
      setMuteAllStatus("No active unmuted teammates to mute.");
      setTimeout(() => setMuteAllStatus(null), 3000);
      return;
    }

    setIsMutingAll(true);
    setMuteAllError(null);
    setMuteAllStatus(`Muting 0 of ${targets.length}...`);

    let successCount = 0;
    const failedNames: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      // Verify target hasn't left during the sequence
      const stillPresent = participants.some((p) => p.userId === target.userId);
      if (!stillPresent) continue;

      setMuteAllStatus(`Muting ${i + 1} of ${targets.length}...`);

      try {
        await onMuteParticipant(target.userId, target.audioTrackSid);
        successCount++;
      } catch (err: any) {
        console.warn(`Failed to mute participant ${target.name}:`, err);
        failedNames.push(target.name);
      }
    }

    setIsMutingAll(false);
    if (failedNames.length > 0) {
      setMuteAllError(`Failed to mute: ${failedNames.join(", ")}`);
    } else {
      setMuteAllStatus(`Muted ${successCount} teammate${successCount === 1 ? "" : "s"}`);
      setTimeout(() => setMuteAllStatus(null), 3000);
    }
  };

  const handleKick = async (userId: string) => {
    if (!onKickParticipant || busyActionId) return;
    setBusyActionId(userId);
    try {
      await onKickParticipant(userId);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleTransfer = async (userId: string) => {
    if (!onTransferHost || busyActionId) return;
    setBusyActionId(userId);
    try {
      await onTransferHost(userId);
    } finally {
      setBusyActionId(null);
    }
  };

  return (
    <aside
      aria-label="Participants roster"
      className="flex h-full w-72 flex-col border-l border-slate-800 bg-slate-950 p-4 text-slate-100 shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Participants</h3>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
            {participants.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          aria-label="Close roster"
        >
          <X size={16} />
        </button>
      </div>

      {/* Action Buttons: Invite & Host Mute All */}
      <div className="py-3 space-y-2">
        <button
          onClick={onOpenInviteModal}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600/20 px-3 py-2 text-xs font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 hover:text-white transition"
        >
          <UserPlus size={14} />
          Invite Teammates
        </button>

        {isCurrentUserHost && onMuteParticipant && (
          <button
            onClick={handleMuteAll}
            disabled={isMutingAll}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 hover:text-white disabled:opacity-50 transition"
            title="Mute all teammates in this call"
            aria-label="Mute all teammates"
          >
            <VolumeX size={14} />
            {isMutingAll ? "Muting Teammates..." : "Mute All Teammates"}
          </button>
        )}

        {/* Status / Error feedback for Mute All */}
        {muteAllStatus && (
          <p className="text-[11px] text-emerald-400 text-center animate-fade-in" role="status">
            {muteAllStatus}
          </p>
        )}
        {muteAllError && (
          <p className="text-[11px] text-rose-400 text-center animate-fade-in" role="alert">
            {muteAllError}
          </p>
        )}
      </div>

      {/* Participant List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {participants.map((p) => {
          const isSelf = p.userId === currentUserId;
          const isBusy = busyActionId === p.userId;

          return (
            <div
              key={p.userId}
              className="flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-900/60 p-2.5 transition hover:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar name={p.name} src={p.avatarUrl} size="sm" />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-xs font-medium text-slate-200">
                      {p.name} {isSelf && "(You)"}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {p.isHost ? "Host" : p.status.toLowerCase()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-slate-400">
                  {p.isHost && (
                    <span title="Meeting Host" className="text-amber-400">
                      <Crown size={13} />
                    </span>
                  )}
                  {p.isMuted ? (
                    <span title="Muted" className="inline-flex items-center text-rose-400">
                      <MicOff size={13} />
                    </span>
                  ) : (
                    <span title="Microphone on" className="inline-flex items-center text-emerald-400">
                      <Mic size={13} />
                    </span>
                  )}
                  {p.isCameraOff ? (
                    <span title="Camera off" className="inline-flex items-center text-slate-500">
                      <VideoOff size={13} />
                    </span>
                  ) : (
                    <span title="Camera on" className="inline-flex items-center text-emerald-400">
                      <Video size={13} />
                    </span>
                  )}
                </div>
              </div>

              {/* Host Controls for other participants */}
              {isCurrentUserHost && !isSelf && (
                <div className="mt-1 flex items-center justify-end gap-1.5 pt-1.5 border-t border-slate-800/60">
                  {!p.isMuted && p.audioTrackSid && onMuteParticipant && (
                    <button
                      onClick={() => handleMute(p.userId, p.audioTrackSid)}
                      disabled={isBusy || isMutingAll}
                      title="Mute microphone"
                      aria-label={`Mute ${p.name}`}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 transition disabled:opacity-50"
                    >
                      <VolumeX size={12} />
                    </button>
                  )}

                  {onTransferHost && (
                    <button
                      onClick={() => handleTransfer(p.userId)}
                      disabled={isBusy || isMutingAll}
                      title="Make Host"
                      aria-label={`Transfer host to ${p.name}`}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-amber-500/20 hover:text-amber-300 transition disabled:opacity-50"
                    >
                      <ArrowRightLeft size={12} />
                    </button>
                  )}

                  {onKickParticipant && (
                    <button
                      onClick={() => handleKick(p.userId)}
                      disabled={isBusy || isMutingAll}
                      title="Remove from meeting"
                      aria-label={`Remove ${p.name} from meeting`}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-600/30 hover:text-rose-400 transition disabled:opacity-50"
                    >
                      <UserX size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
