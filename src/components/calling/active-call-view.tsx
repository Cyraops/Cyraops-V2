"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  Participant,
  RemoteParticipant,
  LocalParticipant,
  RemoteTrackPublication,
  RemoteTrack,
  DisconnectReason,
} from "livekit-client";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  RefreshCw,
  Volume2,
  AlertCircle,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { Avatar } from "@/components/ui";

export interface ActiveCallSession {
  id: string;
  conversationId: string;
  type: "AUDIO" | "VIDEO";
  status: "RINGING" | "CONNECTING" | "ACTIVE" | "ENDED" | "CANCELLED" | "FAILED";
  initiatorId: string;
  hostId: string;
  participants: Array<{
    id: string;
    userId: string;
    status: string;
    isHost: boolean;
    user: {
      id: string;
      name: string;
      avatarUrl?: string | null;
      role?: string;
    };
  }>;
}

interface ActiveCallViewProps {
  call: ActiveCallSession;
  currentUserId: string;
  onCallEnded: () => void;
}

export function ActiveCallView({
  call,
  currentUserId,
  onCallEnded,
}: ActiveCallViewProps) {
  const [connectionState, setConnectionState] = useState<
    "initiating" | "connecting" | "connected" | "reconnecting" | "disconnected" | "failed"
  >("initiating");
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(call.type === "AUDIO");
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remoteParticipantConnected, setRemoteParticipantConnected] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHost = call.hostId === currentUserId;

  const isVideo = call.type === "VIDEO";
  const otherParticipant = call.participants.find((p) => p.userId !== currentUserId);
  const otherUser = otherParticipant?.user;

  // Enumerate available video inputs & device change tracking (Stage G)
  const refreshDevices = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const vInputs = devices.filter((d) => d.kind === "videoinput");
          setVideoDevices(vInputs);
          setSelectedVideoDeviceId((prevSelected) => {
            if (prevSelected && !vInputs.some((d) => d.deviceId === prevSelected)) {
              setErrorMessage("Active video input device was disconnected.");
              setIsCameraOff(true);
              return vInputs.length > 0 ? vInputs[0].deviceId : "";
            }
            if (!prevSelected && vInputs.length > 0) {
              return vInputs[0].deviceId;
            }
            return prevSelected;
          });
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
      const handleDeviceChange = () => {
        refreshDevices();
      };
      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      };
    }
  }, [refreshDevices]);

  // Best-effort browser unload cleanup (Stage E)
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

        // 1. Fetch short-lived token from backend
        const tokenRes = await fetch(`/api/calls/${call.id}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!tokenRes.ok) {
          const errData = await tokenRes.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to fetch calling token (${tokenRes.status})`);
        }

        const { token, url } = await tokenRes.json();
        if (!active) return;

        // 2. Initialize LiveKit Room instance
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: VideoPresets.h720.resolution,
          },
        });
        roomRef.current = room;

        // Register room lifecycle listeners
        room.on(RoomEvent.Connected, () => {
          if (!active) return;
          setConnectionState("connected");
          // Check if remote participants already exist
          if (room.remoteParticipants.size > 0) {
            setRemoteParticipantConnected(true);
          }
        });

        room.on(RoomEvent.Reconnecting, () => {
          if (!active) return;
          setConnectionState("reconnecting");
        });

        room.on(RoomEvent.Reconnected, () => {
          if (!active) return;
          setConnectionState("connected");
        });

        room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (!active) return;
          setConnectionState("disconnected");
          if (reason === DisconnectReason.SERVER_SHUTDOWN || reason === 4) {
            setErrorMessage("You have been disconnected from the call by the server.");
          }
          setTimeout(() => {
            if (active) onCallEnded();
          }, 1500);
        });

        room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
          if (!active) return;
          setRemoteParticipantConnected(true);
        });

        room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
          if (!active) return;
          setRemoteParticipantConnected(false);
        });

        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (!active) return;
            if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
              track.attach(remoteAudioRef.current);
            } else if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
              track.attach(remoteVideoRef.current);
            }
          }
        );

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach();
        });

        room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          if (!active) return;
          const remoteSpeaking = speakers.some((s) => s.identity !== currentUserId);
          const localSpeaking = speakers.some((s) => s.identity === currentUserId);
          setIsRemoteSpeaking(remoteSpeaking);
          setIsLocalSpeaking(localSpeaking);
        });

        // 3. Connect to SFU over WebRTC
        await room.connect(url, token);
        if (!active) {
          room.disconnect();
          return;
        }

        // 4. Publish Microphone Track
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          const micTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack?.mediaStreamTrack;
          if (micTrack) {
            micTrack.onended = () => {
              setIsMuted(true);
              setErrorMessage("Microphone disconnected or stopped by system.");
              refreshDevices();
            };
          }
        } catch (micErr: any) {
          console.warn("[CallingUI] Microphone access denied or unavailable:", micErr);
          setErrorMessage("Microphone permission denied or device unavailable. Audio input is disabled.");
        }

        // 5. Publish Camera Track if Video Call
        if (isVideo) {
          try {
            await room.localParticipant.setCameraEnabled(true);
            setIsCameraOff(false);
            // Attach local preview
            const camPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
            const camTrack = camPublication?.videoTrack;
            if (camTrack && localVideoRef.current) {
              camTrack.attach(localVideoRef.current);
            }
            if (camPublication?.track?.mediaStreamTrack) {
              camPublication.track.mediaStreamTrack.onended = () => {
                setIsCameraOff(true);
                setErrorMessage("Camera disconnected or stopped by system.");
                refreshDevices();
              };
            }
          } catch (camErr: any) {
            console.warn("[CallingUI] Camera access denied or unavailable:", camErr);
            setIsCameraOff(true);
            setErrorMessage("Camera permission denied or device unavailable. Continuing in audio-only mode.");
          }
        }
      } catch (err: any) {
        console.error("[CallingUI] Connection failure:", err);
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
  }, [call.id, currentUserId, isVideo, onCallEnded]);

  // Toggle Microphone
  const toggleMute = async () => {
    if (!roomRef.current) return;
    const next = !isMuted;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!next);
      setIsMuted(next);
    } catch (err: any) {
      setErrorMessage("Could not toggle microphone: " + (err?.message || "Unknown error"));
    }
  };

  // Toggle Camera
  const toggleCamera = async () => {
    if (!roomRef.current || !isVideo) return;
    const next = !isCameraOff;
    try {
      await roomRef.current.localParticipant.setCameraEnabled(!next);
      setIsCameraOff(next);

      if (!next && localVideoRef.current) {
        const camTrack = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
        if (camTrack) {
          camTrack.attach(localVideoRef.current);
        }
      }
    } catch (err: any) {
      setErrorMessage("Could not toggle camera: " + (err?.message || "Unknown error"));
    }
  };

  // Switch Video Device
  const switchCamera = async (deviceId: string) => {
    if (!roomRef.current || !deviceId) return;
    try {
      await roomRef.current.switchActiveDevice("videoinput", deviceId);
      setSelectedVideoDeviceId(deviceId);
    } catch (err: any) {
      setErrorMessage("Could not switch camera: " + (err?.message || "Unknown error"));
    }
  };

  // End or Leave Call
  const endCall = async () => {
    setConnectionState("disconnected");
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    try {
      if (isHost) {
        await fetch(`/api/calls/${call.id}/end`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "User ended call" }),
        });
      } else {
        await fetch(`/api/calls/${call.id}/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {}

    onCallEnded();
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="relative border-b border-[var(--border)] bg-[var(--surface-2)] transition-all duration-300">
      {/* Hidden audio element for remote audio playback */}
      <audio ref={remoteAudioRef} autoPlay />

      {/* Top Bar / Status */}
      <div className="flex items-center justify-between px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-2.5 w-2.5 rounded-full ${
              connectionState === "connected"
                ? "bg-emerald-500 animate-pulse"
                : connectionState === "reconnecting"
                ? "bg-amber-500 animate-ping"
                : connectionState === "failed"
                ? "bg-rose-500"
                : "bg-accent animate-pulse"
            }`}
          />
          <div className="min-w-0">
            <span className="block text-xs font-bold text-[var(--text)]">
              {isVideo ? "Video Call" : "Audio Call"} · {otherUser?.name || "Teammate"}
            </span>
            <span className="block text-[10px] text-[var(--muted)]">
              {connectionState === "connected"
                ? `Active · ${formatSeconds(callDuration)}`
                : connectionState === "reconnecting"
                ? "Reconnecting to LiveKit..."
                : connectionState === "failed"
                ? "Connection failed"
                : "Connecting securely..."}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMinimized(!minimized)}
            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition"
            aria-label={minimized ? "Expand call view" : "Minimize call view"}
            title={minimized ? "Expand view" : "Minimize view"}
          >
            {minimized ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          </button>
        </div>
      </div>

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle size={14} className="shrink-0" />
          <span className="flex-1">{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-[10px] font-semibold underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Call View Area (Collapsible) */}
      {!minimized && (
        <div className="p-4 sm:px-6">
          {isVideo ? (
            /* Video Call Grid */
            <div className="relative mx-auto flex h-[320px] max-w-3xl items-center justify-center overflow-hidden rounded-2xl bg-black shadow-inner">
              {/* Remote Video Track */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`h-full w-full object-cover transition-opacity duration-300 ${
                  remoteParticipantConnected ? "opacity-100" : "opacity-0"
                }`}
              />

              {/* Placeholder when remote participant video is not yet attached */}
              {!remoteParticipantConnected && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/80">
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/10 ring-4 ring-white/20">
                    <Avatar name={otherUser?.name || "Participant"} size="lg" src={otherUser?.avatarUrl} />
                  </div>
                  <p className="mt-3 text-sm font-semibold">
                    Waiting for {otherUser?.name || "remote participant"}...
                  </p>
                  <p className="text-[11px] text-white/60">Audio and video will render once connected</p>
                </div>
              )}

              {/* Local Video Preview (Picture-in-Picture) */}
              <div className="absolute bottom-3 right-3 h-28 w-44 overflow-hidden rounded-xl border border-white/20 bg-slate-900 shadow-xl transition">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`h-full w-full object-cover scale-x-[-1] ${isCameraOff ? "hidden" : "block"}`}
                />
                {isCameraOff && (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-slate-800 text-white/60">
                    <VideoOff size={18} />
                    <span className="mt-1 text-[9px] font-semibold">Camera off</span>
                  </div>
                )}
                <div className="absolute bottom-1 left-2 text-[9px] font-medium text-white/90 drop-shadow">
                  You
                </div>
              </div>

              {/* Remote Name Badge */}
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur-md">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isRemoteSpeaking ? "bg-emerald-400 animate-pulse" : "bg-white/40"
                  }`}
                />
                <span>{otherUser?.name || "Participant"}</span>
              </div>
            </div>
          ) : (
            /* Audio Call Card */
            <div className="mx-auto flex h-[200px] max-w-3xl flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-center shadow-sm">
              <div
                className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 ${
                  isRemoteSpeaking
                    ? "ring-4 ring-emerald-500/50 bg-[#eefaf3]"
                    : "ring-2 ring-[var(--border)] bg-[var(--hover)]"
                }`}
              >
                <Avatar name={otherUser?.name || "Participant"} size="lg" src={otherUser?.avatarUrl} />
                {isRemoteSpeaking && (
                  <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                    <Volume2 size={13} />
                  </span>
                )}
              </div>
              <h4 className="mt-3 font-display text-sm font-bold text-[var(--text)]">
                {otherUser?.name || "Participant"}
              </h4>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {connectionState === "connected"
                  ? isRemoteSpeaking
                    ? "Speaking..."
                    : "Connected"
                  : "Connecting audio..."}
              </p>
            </div>
          )}

          {/* Call Controls Toolbar */}
          <div className="mt-4 flex items-center justify-center gap-3">
            {/* Microphone Toggle */}
            <button
              onClick={toggleMute}
              className={`flex h-11 w-11 items-center justify-center rounded-full shadow-md transition active:scale-95 ${
                isMuted
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                  : "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
              title={isMuted ? "Unmute microphone" : "Mute microphone"}
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            {/* Camera Toggle (Video Call Only) */}
            {isVideo && (
              <button
                onClick={toggleCamera}
                className={`flex h-11 w-11 items-center justify-center rounded-full shadow-md transition active:scale-95 ${
                  isCameraOff
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                    : "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--hover)]"
                }`}
                title={isCameraOff ? "Turn camera on" : "Turn camera off"}
                aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
              >
                {isCameraOff ? <VideoOff size={18} /> : <Video size={18} />}
              </button>
            )}

            {/* Camera Switcher (If multiple cameras present) */}
            {isVideo && videoDevices.length > 1 && (
              <button
                onClick={() => {
                  const currentIndex = videoDevices.findIndex((d) => d.deviceId === selectedVideoDeviceId);
                  const nextIndex = (currentIndex + 1) % videoDevices.length;
                  void switchCamera(videoDevices[nextIndex].deviceId);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-md transition hover:bg-[var(--hover)] active:scale-95"
                title="Switch camera device"
                aria-label="Switch camera device"
              >
                <RefreshCw size={17} />
              </button>
            )}

            {/* End Call Button */}
            <button
              onClick={endCall}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition hover:bg-rose-700 active:scale-95 ring-4 ring-rose-500/20"
              title="End call"
              aria-label="End call"
            >
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

