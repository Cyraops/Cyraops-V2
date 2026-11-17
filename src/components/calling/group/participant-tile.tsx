"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff, VideoOff, Crown, Volume2 } from "lucide-react";
import { Avatar } from "@/components/ui";
import type { Participant, TrackPublication, RemoteTrack } from "livekit-client";

export interface ParticipantTileProps {
  participantIdentity: string;
  name: string;
  avatarUrl?: string | null;
  isLocal: boolean;
  isHost: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  videoTrack?: TrackPublication | null;
  audioTrack?: TrackPublication | null;
}

export function ParticipantTile({
  participantIdentity,
  name,
  avatarUrl,
  isLocal,
  isHost,
  isSpeaking,
  isMuted,
  isCameraOff,
  videoTrack,
  audioTrack,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Attach / Detach Video Track
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack?.track) return;

    videoTrack.track.attach(el);
    return () => {
      try {
        videoTrack.track?.detach(el);
      } catch {}
    };
  }, [videoTrack, videoTrack?.track]);

  // Attach / Detach Audio Track (remote only; local is never attached to audio element to avoid feedback)
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioTrack?.track || isLocal) return;

    audioTrack.track.attach(el);
    return () => {
      try {
        audioTrack.track?.detach(el);
      } catch {}
    };
  }, [audioTrack, audioTrack?.track, isLocal]);

  return (
    <div
      role="region"
      aria-label={`Participant tile: ${name}`}
      className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-xl border bg-slate-900 transition-all duration-200 select-none ${
        isSpeaking
          ? "border-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.3)] ring-2 ring-emerald-500/80"
          : "border-slate-800 hover:border-slate-700"
      }`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          isCameraOff ? "opacity-0 pointer-events-none" : "opacity-100"
        } ${isLocal ? "-scale-x-100" : ""}`}
      />

      {/* Hidden Audio Element for Remote Participants */}
      {!isLocal && <audio ref={audioRef} autoPlay />}

      {/* Avatar Fallback when Camera is Off */}
      {isCameraOff && (
        <div className="relative z-10 flex flex-col items-center justify-center gap-2">
          <div className="relative">
            <Avatar name={name} src={avatarUrl} size="lg" />
            {isSpeaking && (
              <span className="absolute -inset-1 animate-ping rounded-full bg-emerald-500/30" />
            )}
          </div>
          <span className="text-sm font-medium text-slate-300">{name}</span>
        </div>
      )}

      {/* Bottom Name & Status Badge */}
      <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-md">
          {isHost && (
            <span title="Call Host" className="text-amber-400">
              <Crown size={12} />
            </span>
          )}
          <span className="truncate max-w-[120px] sm:max-w-[160px]">
            {name} {isLocal && "(You)"}
          </span>
          {isSpeaking && (
            <span className="flex items-center text-emerald-400" title="Speaking">
              <Volume2 size={12} className="animate-pulse" />
            </span>
          )}
        </div>

        {/* Audio / Video Mute Indicator */}
        <div className="flex items-center gap-1">
          {isMuted && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/90 text-white shadow-sm"
              title="Microphone muted"
            >
              <MicOff size={12} />
            </span>
          )}
          {isCameraOff && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-800/80 text-slate-400"
              title="Camera off"
            >
              <VideoOff size={12} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

