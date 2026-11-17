"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  Room,
  RoomEvent,
  VideoPresets,
  DisconnectReason,
  Participant,
  RemoteParticipant,
  Track,
} from "livekit-client";
import {
  Users,
  Maximize2,
  Minimize2,
  AlertCircle,
  UserPlus,
  VolumeX,
} from "lucide-react";
import { ParticipantGrid } from "./participant-grid";
import { GroupControlsBar } from "./group-controls-bar";
import { ParticipantRoster, type RosterMember } from "./participant-roster";
import { GroupInviteModal, type AvailableMember } from "./group-invite-modal";
import type { ParticipantTileProps } from "./participant-tile";

export interface GroupCallSession {
  id: string;
  conversationId: string;
  conversationName?: string | null;
  hostId: string;
  type: "AUDIO" | "VIDEO";
  status: string;
  participants: Array<{
    userId: string;
    status: string;
    isHost: boolean;
    user: {
      name: string;
      avatarUrl?: string | null;
    };
  }>;
}

export interface GroupCallStageProps {
  call: GroupCallSession;
  currentUserId: string;
  onCallEnded: () => void;
}

export function GroupCallStage({
  call,
  currentUserId,
  onCallEnded,
}: GroupCallStageProps) {
  const [connectionState, setConnectionState] = useState<
    "initiating" | "connecting" | "connected" | "reconnecting" | "disconnected" | "failed"
  >("initiating");
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(call.type === "AUDIO");
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [availableMembers, setAvailableMembers] = useState<AvailableMember[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [spotlightParticipantId, setSpotlightParticipantId] = useState<string | null>(null);

  // Audio Playback Unlock State (Safari / Strict Autoplay recovery)
  const [canPlaybackAudio, setCanPlaybackAudio] = useState(true);

  // Viewport width detection for mobile video subscription optimization (< 768px)
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 768;
    }
    return false;
  });

  // LiveKit room and remote participants state
  const roomRef = useRef<Room | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [version, setVersion] = useState(0); // Tick to re-render participant tiles on track events
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activeHostId, setActiveHostId] = useState<string>(call.hostId);
  const isCurrentUserHost = activeHostId === currentUserId;

  // Viewport resize tracking with debounce
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsMobileViewport(window.innerWidth < 768);
      }, 150);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Best-effort browser unload cleanup
  useEffect(() => {
    const handleUnload = () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/calls/${call.id}/leave?reason=unload`);
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [call.id]);

  // Duration timer
  useEffect(() => {
    if (connectionState === "connected") {
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [connectionState]);

  // Connect to LiveKit Room
  useEffect(() => {
    let active = true;

    async function initRoom() {
      try {
        setConnectionState("connecting");
        setErrorMessage(null);

        // 1. Fetch token from backend
        const tokenRes = await fetch(`/api/calls/${call.id}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!tokenRes.ok) {
          const errData = await tokenRes.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to fetch calling token (${tokenRes.status})`);
        }

        const data = await tokenRes.json();
        const { token, url, hostId } = data;
        if (hostId) setActiveHostId(hostId);

        if (!active) return;

        // 2. Initialize LiveKit Room instance with group multi-cast optimizations
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: VideoPresets.h720.resolution,
          },
          publishDefaults: {
            simulcast: true,
          },
        });
        roomRef.current = room;

        const updateRemoteParticipants = () => {
          if (!active) return;
          setRemoteParticipants(Array.from(room.remoteParticipants.values()));
          setVersion((v) => v + 1);
        };

        // Room lifecycle listeners
        room.on(RoomEvent.Connected, () => {
          if (!active) return;
          setConnectionState("connected");
          updateRemoteParticipants();
          if (!room.canPlaybackAudio) {
            setCanPlaybackAudio(false);
          }
        });

        room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (!active) return;
          setCanPlaybackAudio(room.canPlaybackAudio);
        });

        room.on(RoomEvent.Reconnecting, () => {
          if (!active) return;
          setConnectionState("reconnecting");
        });

        room.on(RoomEvent.Reconnected, () => {
          if (!active) return;
          setConnectionState("connected");
          updateRemoteParticipants();
          if (!room.canPlaybackAudio) {
            setCanPlaybackAudio(false);
          }
        });

        room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (!active) return;
          setConnectionState("disconnected");
          if (reason === DisconnectReason.SERVER_SHUTDOWN || reason === 4) {
            setErrorMessage("You have been removed from the call by the host or server.");
          }
          setTimeout(() => {
            if (active) onCallEnded();
          }, 1200);
        });

        room.on(RoomEvent.ParticipantConnected, () => {
          updateRemoteParticipants();
        });

        room.on(RoomEvent.ParticipantDisconnected, () => {
          updateRemoteParticipants();
        });

        room.on(RoomEvent.TrackSubscribed, () => {
          setVersion((v) => v + 1);
        });

        room.on(RoomEvent.TrackUnsubscribed, () => {
          setVersion((v) => v + 1);
        });

        room.on(RoomEvent.TrackMuted, () => {
          setVersion((v) => v + 1);
        });

        room.on(RoomEvent.TrackUnmuted, () => {
          setVersion((v) => v + 1);
        });

        room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          if (!active) return;
          if (speakers.length > 0) {
            setActiveSpeakerId(speakers[0].identity);
          } else {
            setActiveSpeakerId(null);
          }
        });

        // 3. Connect to SFU over WebRTC
        await room.connect(url, token);
        if (!active) {
          room.disconnect();
          return;
        }

        // Verify audio playback readiness immediately upon connection
        if (!room.canPlaybackAudio) {
          setCanPlaybackAudio(false);
        }

        // 4. Publish Microphone Track
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (micErr: any) {
          console.warn("[GroupCallStage] Microphone access denied or unavailable:", micErr);
          setErrorMessage("Microphone permission denied or device unavailable.");
        }

        // 5. Publish Camera Track if Video Call
        if (call.type === "VIDEO") {
          try {
            await room.localParticipant.setCameraEnabled(true);
            setIsCameraOff(false);
          } catch (camErr: any) {
            console.warn("[GroupCallStage] Camera access denied or unavailable:", camErr);
            setIsCameraOff(true);
            setErrorMessage("Camera permission denied. Continuing in audio mode.");
          }
        }

        updateRemoteParticipants();
      } catch (err: any) {
        console.error("[GroupCallStage] Connection failure:", err);
        if (!active) return;
        setConnectionState("failed");
        setErrorMessage(err?.message || "Failed to establish calling connection.");
      }
    }

    void initRoom();

    return () => {
      active = false;
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, [call.id, call.type, onCallEnded]);

  // Audio Playback Recovery (User Gesture Unlock for Safari/iOS/Strict Autoplay)
  const handleStartAudio = async () => {
    if (!roomRef.current) return;
    try {
      await roomRef.current.startAudio();
      setCanPlaybackAudio(roomRef.current.canPlaybackAudio);
    } catch (err: any) {
      console.warn("[GroupCallStage] startAudio failed:", err);
      setErrorMessage("Could not resume audio playback: " + (err?.message || "User interaction required."));
    }
  };

  // Toggle Microphone
  const toggleMute = useCallback(async () => {
    if (!roomRef.current) return;
    const next = !isMuted;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!next);
      setIsMuted(next);
      setVersion((v) => v + 1);
    } catch (err: any) {
      setErrorMessage("Could not toggle microphone: " + (err?.message || "Unknown error"));
    }
  }, [isMuted]);

  // Toggle Camera
  const toggleCamera = useCallback(async () => {
    if (!roomRef.current) return;
    const next = !isCameraOff;
    try {
      await roomRef.current.localParticipant.setCameraEnabled(!next);
      setIsCameraOff(next);
      setVersion((v) => v + 1);
    } catch (err: any) {
      setErrorMessage("Could not toggle camera: " + (err?.message || "Unknown error"));
    }
  }, [isCameraOff]);

  // Store stable refs for keyboard shortcuts to prevent stale React closures
  const toggleMuteRef = useRef(toggleMute);
  toggleMuteRef.current = toggleMute;
  const toggleCameraRef = useRef(toggleCamera);
  toggleCameraRef.current = toggleCamera;

  // Remediation A: Keyboard Shortcuts (Cmd+D / Ctrl+D for mic, Cmd+E / Ctrl+E for camera)
  useEffect(() => {
    if (connectionState !== "connected") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input, textarea, or contenteditable element
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT" ||
          target.isContentEditable ||
          target.getAttribute("contenteditable") === "true" ||
          target.getAttribute("role") === "textbox"
        ) {
          return;
        }
      }

      const modifier = e.metaKey || e.ctrlKey;
      if (!modifier) return;

      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        void toggleMuteRef.current();
      } else if (key === "e") {
        e.preventDefault();
        void toggleCameraRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [connectionState]);

  // Remediation E: Mobile Video Subscription Optimization (< 768px capped at 2 active video streams)
  useEffect(() => {
    if (!roomRef.current || connectionState !== "connected") return;

    const remotes = remoteParticipants;
    if (!isMobileViewport) {
      // Desktop / wide viewport: ensure all remote video tracks are subscribed
      for (const p of remotes) {
        for (const pub of p.videoTrackPublications.values()) {
          if (!pub.isSubscribed) {
            try {
              pub.setSubscribed(true);
            } catch (e) {
              console.warn("Failed to restore video subscription:", e);
            }
          }
        }
      }
      return;
    }

    // Narrow / mobile viewport: limit active remote video subscriptions to at most 2
    const priorityIds = new Set<string>();

    // 1. Explicit spotlight participant (if remote and present)
    if (spotlightParticipantId && remotes.some((p) => p.identity === spotlightParticipantId)) {
      priorityIds.add(spotlightParticipantId);
    }

    // 2. Active speaker (if remote and priority not full)
    if (activeSpeakerId && remotes.some((p) => p.identity === activeSpeakerId) && priorityIds.size < 2) {
      priorityIds.add(activeSpeakerId);
    }

    // 3. Fill up to 2 slots with remaining visible remotes
    for (const p of remotes) {
      if (priorityIds.size >= 2) break;
      priorityIds.add(p.identity);
    }

    // Apply to remote video tracks only (audio is NEVER unsubscribed)
    for (const p of remotes) {
      const shouldSubscribe = priorityIds.has(p.identity);
      for (const pub of p.videoTrackPublications.values()) {
        if (pub.isSubscribed !== shouldSubscribe) {
          try {
            pub.setSubscribed(shouldSubscribe);
          } catch (e) {
            console.warn(`Failed to set video subscription (${shouldSubscribe}) on track:`, e);
          }
        }
      }
    }
  }, [isMobileViewport, remoteParticipants, spotlightParticipantId, activeSpeakerId, connectionState]);

  // Leave Call
  const handleLeaveCall = async () => {
    try {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
      await fetch(`/api/calls/${call.id}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_left" }),
      });
    } catch (err) {
      console.warn("Leave call request error:", err);
    } finally {
      onCallEnded();
    }
  };

  // Host End Call For Everyone
  const handleEndCallForEveryone = async () => {
    try {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
      await fetch(`/api/calls/${call.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "host_terminated" }),
      });
    } catch (err) {
      console.warn("End call for everyone error:", err);
    } finally {
      onCallEnded();
    }
  };

  // Host Actions
  const handleMuteParticipant = async (targetUserId: string, trackSid?: string) => {
    try {
      const res = await fetch(`/api/calls/${call.id}/mute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          trackSid,
          trackKind: "audio",
          muted: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to mute participant");
      }
    } catch (err: any) {
      setErrorMessage(err.message);
      throw err; // Re-throw so caller (e.g. Mute All sequence) can record failure
    }
  };

  const handleKickParticipant = async (targetUserId: string) => {
    try {
      const res = await fetch(`/api/calls/${call.id}/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          reason: "Removed by host",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to remove participant");
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleTransferHost = async (newHostUserId: string) => {
    try {
      const res = await fetch(`/api/calls/${call.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newHostUserId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to transfer host role");
      }
      setActiveHostId(newHostUserId);
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  // Compile tile list for ParticipantGrid
  const participantTiles: ParticipantTileProps[] = useMemo(() => {
    // Suppress unused warning for version trigger
    void version;

    const tiles: ParticipantTileProps[] = [];
    const local = roomRef.current?.localParticipant;

    // 1. Local participant tile
    if (local) {
      const localAudioPub = local.getTrackPublication(Track.Source.Microphone);
      const localVideoPub = local.getTrackPublication(Track.Source.Camera);
      const localUserObj = call.participants.find((p) => p.userId === currentUserId)?.user;

      tiles.push({
        participantIdentity: currentUserId,
        name: (localUserObj?.name || "You") + " (You)",
        avatarUrl: localUserObj?.avatarUrl,
        isLocal: true,
        isHost: activeHostId === currentUserId,
        isSpeaking: activeSpeakerId === currentUserId,
        isMuted: isMuted || !localAudioPub || localAudioPub.isMuted,
        isCameraOff: isCameraOff || !localVideoPub || localVideoPub.isMuted,
        videoTrack: localVideoPub,
        audioTrack: localAudioPub,
      });
    }

    // 2. Remote participant tiles
    for (const remote of remoteParticipants) {
      const remoteUserObj = call.participants.find((p) => p.userId === remote.identity)?.user;
      const remoteAudioPub = remote.getTrackPublication(Track.Source.Microphone);
      const remoteVideoPub = remote.getTrackPublication(Track.Source.Camera);

      tiles.push({
        participantIdentity: remote.identity,
        name: remoteUserObj?.name || remote.name || remote.identity,
        avatarUrl: remoteUserObj?.avatarUrl,
        isLocal: false,
        isHost: activeHostId === remote.identity,
        isSpeaking: activeSpeakerId === remote.identity || remote.isSpeaking,
        isMuted: !remoteAudioPub || remoteAudioPub.isMuted,
        isCameraOff: !remoteVideoPub || remoteVideoPub.isMuted || !remoteVideoPub.isSubscribed,
        videoTrack: remoteVideoPub,
        audioTrack: remoteAudioPub,
      });
    }

    return tiles;
  }, [
    version,
    currentUserId,
    activeHostId,
    activeSpeakerId,
    isMuted,
    isCameraOff,
    call.participants,
    remoteParticipants,
  ]);

  // Compile roster member list for ParticipantRoster
  const rosterMembers: RosterMember[] = useMemo(() => {
    const list: RosterMember[] = [];

    // Local user
    const localUserObj = call.participants.find((p) => p.userId === currentUserId)?.user;
    const localAudio = roomRef.current?.localParticipant?.getTrackPublication(Track.Source.Microphone);
    list.push({
      userId: currentUserId,
      name: localUserObj?.name || "You",
      avatarUrl: localUserObj?.avatarUrl,
      isHost: activeHostId === currentUserId,
      status: "CONNECTED",
      isMuted: isMuted || !localAudio || localAudio.isMuted,
      isCameraOff: isCameraOff,
      audioTrackSid: localAudio?.trackSid,
    });

    // Remotes
    for (const remote of remoteParticipants) {
      const userObj = call.participants.find((p) => p.userId === remote.identity)?.user;
      const audioPub = remote.getTrackPublication(Track.Source.Microphone);
      const videoPub = remote.getTrackPublication(Track.Source.Camera);

      list.push({
        userId: remote.identity,
        name: userObj?.name || remote.name || remote.identity,
        avatarUrl: userObj?.avatarUrl,
        isHost: activeHostId === remote.identity,
        status: "CONNECTED",
        isMuted: !audioPub || audioPub.isMuted,
        isCameraOff: !videoPub || videoPub.isMuted || !videoPub.isSubscribed,
        audioTrackSid: audioPub?.trackSid,
      });
    }

    return list;
  }, [
    currentUserId,
    activeHostId,
    isMuted,
    isCameraOff,
    call.participants,
    remoteParticipants,
  ]);

  // Fetch available conversation members to invite
  useEffect(() => {
    if (!isInviteModalOpen) return;
    let alive = true;
    fetch(`/api/conversations/${call.conversationId}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (!alive || !Array.isArray(data.members)) return;
        const currentParticipantIds = new Set(participantTiles.map((p) => p.participantIdentity));
        const filtered = data.members
          .filter((m: any) => !currentParticipantIds.has(m.userId))
          .map((m: any) => ({
            id: m.userId,
            name: m.user?.name || "Member",
            email: m.user?.email || "",
            avatarUrl: m.user?.avatarUrl,
          }));
        setAvailableMembers(filtered);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isInviteModalOpen, call.conversationId, participantTiles]);

  const handleInviteMembers = async (userIds: string[]) => {
    try {
      const res = await fetch(`/api/calls/${call.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeIds: userIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to invite members");
      }
      setIsInviteModalOpen(false);
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  // Format Duration HH:MM:SS / MM:SS
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins}:${remainder.toString().padStart(2, "0")}`;
  };

  const groupTitle = call.conversationName || "Group Meeting";

  return (
    <div
      role="region"
      aria-label={`Active group call: ${groupTitle}`}
      className={`relative flex flex-col bg-slate-950 text-white transition-all overflow-hidden ${
        isMinimized
          ? "fixed bottom-6 right-6 z-50 h-72 w-96 rounded-2xl border border-slate-800 shadow-2xl"
          : "h-full w-full"
      }`}
    >
      {/* Top Header Bar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white font-semibold">
            <Users size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate text-slate-100">{groupTitle}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {connectionState === "connected"
                  ? formatTime(callDuration)
                  : connectionState === "reconnecting"
                  ? "Reconnecting..."
                  : "Connecting..."}
              </span>
              <span>•</span>
              <span>{participantTiles.length} active</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsInviteModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
            title="Invite teammates"
          >
            <UserPlus size={14} />
            <span className="hidden sm:inline">Invite</span>
          </button>

          <button
            onClick={() => setIsMinimized((prev) => !prev)}
            aria-label={isMinimized ? "Maximize call" : "Minimize call"}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Safari / Browser Autoplay Unlock Notice (Remediation B) */}
      {!canPlaybackAudio && connectionState === "connected" && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center justify-between gap-3 bg-amber-500/95 px-4 py-2.5 text-xs font-semibold text-slate-950 shadow-md backdrop-blur-md"
        >
          <div className="flex items-center gap-2">
            <VolumeX size={16} className="shrink-0" />
            <span>Audio playback is blocked by your browser autoplay policy. Click to unlock audio.</span>
          </div>
          <button
            onClick={handleStartAudio}
            className="rounded-lg bg-slate-950 px-3 py-1 font-medium text-white hover:bg-slate-900 transition shrink-0"
          >
            Enable Audio
          </button>
        </div>
      )}

      {/* Error / Alert banner */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between bg-amber-500/20 px-4 py-2 text-xs text-amber-200 border-b border-amber-500/30 backdrop-blur-md"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0 text-amber-400" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-[11px] font-semibold underline hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Stage Grid & Roster */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Participants Grid Stage */}
        <div className="flex-1 min-h-0 min-w-0 bg-slate-950 p-2">
          <ParticipantGrid
            participants={participantTiles}
            activeSpeakerId={activeSpeakerId}
            spotlightParticipantId={spotlightParticipantId}
            onSelectSpotlightParticipant={setSpotlightParticipantId}
            isMobileViewport={isMobileViewport}
          />
        </div>

        {/* Participant Roster Drawer */}
        <ParticipantRoster
          isOpen={isRosterOpen && !isMinimized}
          onClose={() => setIsRosterOpen(false)}
          onOpenInviteModal={() => setIsInviteModalOpen(true)}
          participants={rosterMembers}
          currentUserId={currentUserId}
          isCurrentUserHost={isCurrentUserHost}
          onMuteParticipant={handleMuteParticipant}
          onKickParticipant={handleKickParticipant}
          onTransferHost={handleTransferHost}
        />
      </div>

      {/* Floating Bottom Controls */}
      {!isMinimized && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
          <GroupControlsBar
            isMuted={isMuted}
            isCameraOff={isCameraOff}
            isRosterOpen={isRosterOpen}
            participantCount={participantTiles.length}
            isHost={isCurrentUserHost}
            onToggleMic={toggleMute}
            onToggleCamera={toggleCamera}
            onToggleRoster={() => setIsRosterOpen((prev) => !prev)}
            onLeaveCall={handleLeaveCall}
            onEndCallForEveryone={isCurrentUserHost ? handleEndCallForEveryone : undefined}
          />
        </div>
      )}

      {/* Group Invite Modal */}
      <GroupInviteModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        availableMembers={availableMembers}
        onInvite={handleInviteMembers}
      />
    </div>
  );
}
