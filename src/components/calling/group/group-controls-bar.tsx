"use client";

import { useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Users,
  PhoneOff,
  MoreVertical,
  LogOut,
  Power,
} from "lucide-react";

export interface GroupControlsBarProps {
  isMuted: boolean;
  isCameraOff: boolean;
  isRosterOpen: boolean;
  participantCount: number;
  isHost: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleRoster: () => void;
  onLeaveCall: () => void;
  onEndCallForEveryone?: () => void;
}

export function GroupControlsBar({
  isMuted,
  isCameraOff,
  isRosterOpen,
  participantCount,
  isHost,
  onToggleMic,
  onToggleCamera,
  onToggleRoster,
  onLeaveCall,
  onEndCallForEveryone,
}: GroupControlsBarProps) {
  const [showHostMenu, setShowHostMenu] = useState(false);

  return (
    <div className="relative flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-2.5 shadow-2xl backdrop-blur-md select-none">
      {/* Microphone Toggle */}
      <button
        onClick={onToggleMic}
        title={isMuted ? "Unmute microphone (Cmd+D)" : "Mute microphone (Cmd+D)"}
        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
          isMuted
            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
            : "bg-slate-800 text-slate-100 hover:bg-slate-700 hover:text-white"
        }`}
      >
        {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>

      {/* Camera Toggle */}
      <button
        onClick={onToggleCamera}
        title={isCameraOff ? "Turn on camera (Cmd+E)" : "Turn off camera (Cmd+E)"}
        aria-label={isCameraOff ? "Turn on camera" : "Turn off camera"}
        className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
          isCameraOff
            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
            : "bg-slate-800 text-slate-100 hover:bg-slate-700 hover:text-white"
        }`}
      >
        {isCameraOff ? <VideoOff size={18} /> : <Video size={18} />}
      </button>

      {/* Roster Toggle */}
      <button
        onClick={onToggleRoster}
        title="Toggle participant list"
        aria-label="Toggle participant list"
        className={`relative flex h-11 items-center gap-2 rounded-xl px-3.5 transition ${
          isRosterOpen
            ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40"
            : "bg-slate-800 text-slate-100 hover:bg-slate-700 hover:text-white"
        }`}
      >
        <Users size={17} />
        <span className="text-xs font-semibold">{participantCount}</span>
      </button>

      {/* Host Menu (End Meeting for Everyone) */}
      {isHost && onEndCallForEveryone && (
        <div className="relative">
          <button
            onClick={() => setShowHostMenu(!showHostMenu)}
            title="Host options"
            aria-label="Host options"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition"
          >
            <MoreVertical size={18} />
          </button>

          {showHostMenu && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 w-52 rounded-xl border border-slate-800 bg-slate-900 p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
              <button
                onClick={() => {
                  setShowHostMenu(false);
                  onEndCallForEveryone();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition"
              >
                <Power size={14} />
                End Meeting for Everyone
              </button>
            </div>
          )}
        </div>
      )}

      {/* Leave Call Button */}
      <button
        onClick={onLeaveCall}
        title="Leave call"
        aria-label="Leave call"
        className="flex h-11 items-center gap-2 rounded-xl bg-rose-600 px-4 font-semibold text-xs text-white shadow-lg hover:bg-rose-500 transition"
      >
        <PhoneOff size={16} />
        <span>Leave</span>
      </button>
    </div>
  );
}

