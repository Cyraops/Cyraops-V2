"use client";

import { useMemo } from "react";
import { ParticipantTile, type ParticipantTileProps } from "./participant-tile";

export interface ParticipantGridProps {
  participants: ParticipantTileProps[];
  activeSpeakerId?: string | null;
  spotlightParticipantId?: string | null;
  onSelectSpotlightParticipant?: (identity: string) => void;
  isMobileViewport?: boolean;
}

export function ParticipantGrid({
  participants,
  activeSpeakerId,
  spotlightParticipantId,
  onSelectSpotlightParticipant,
  isMobileViewport = false,
}: ParticipantGridProps) {
  const count = participants.length;

  // Determine active spotlight participant if in mobile or high-count layout
  const activeSpotlight = useMemo(() => {
    if (spotlightParticipantId) {
      const match = participants.find((p) => p.participantIdentity === spotlightParticipantId);
      if (match) return match;
    }
    if (activeSpeakerId) {
      const speaker = participants.find((p) => p.participantIdentity === activeSpeakerId);
      if (speaker) return speaker;
    }
    // Default to first remote participant or first tile
    return participants.find((p) => !p.isLocal) || participants[0];
  }, [participants, spotlightParticipantId, activeSpeakerId]);

  // Standard grid layout template class for desktop viewports
  const gridClass = useMemo(() => {
    if (count <= 1) return "grid-cols-1 grid-rows-1";
    if (count === 2) return "grid-cols-1 md:grid-cols-2 grid-rows-1";
    if (count <= 4) return "grid-cols-2 grid-rows-2";
    if (count <= 6) return "grid-cols-2 md:grid-cols-3 grid-rows-2";
    if (count <= 9) return "grid-cols-2 md:grid-cols-3 lg:grid-cols-3";
    return "grid-cols-2 md:grid-cols-4 lg:grid-cols-4";
  }, [count]);

  if (count === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-950 p-6 text-slate-400">
        <p className="text-sm">Connecting to media stream...</p>
      </div>
    );
  }

  // Mobile layout with > 2 participants: Prioritized Spotlight + Swipeable Filmstrip
  // Capped at 2 active video streams at any given time via SFU subscription gating in GroupCallStage
  if (isMobileViewport && count > 2) {
    const filmstripParticipants = participants.filter(
      (p) => p.participantIdentity !== activeSpotlight.participantIdentity
    );

    return (
      <div className="flex h-full w-full flex-col gap-2 p-1">
        {/* Primary Stage */}
        <div className="flex-1 min-h-0 w-full">
          <ParticipantTile {...activeSpotlight} />
        </div>

        {/* Mobile Horizontal Filmstrip */}
        <div className="flex h-24 w-full gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {filmstripParticipants.map((p) => (
            <button
              key={p.participantIdentity}
              type="button"
              onClick={() => onSelectSpotlightParticipant?.(p.participantIdentity)}
              className="h-full w-32 flex-shrink-0 text-left focus:outline-none focus:ring-2 focus:ring-accent rounded-xl overflow-hidden"
              title={`Switch spotlight to ${p.name}`}
              aria-label={`View ${p.name}`}
            >
              <ParticipantTile {...p} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Desktop Spotlight layout for > 9 participants: active speaker takes primary stage
  if (count > 9) {
    const filmstripParticipants = participants.filter(
      (p) => p.participantIdentity !== activeSpotlight.participantIdentity
    );

    return (
      <div className="flex h-full w-full flex-col gap-2 p-2">
        {/* Spotlight Stage */}
        <div className="flex-1 min-h-0">
          <ParticipantTile {...activeSpotlight} />
        </div>

        {/* Horizontal Filmstrip */}
        <div className="flex h-28 w-full gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {filmstripParticipants.map((p) => (
            <button
              key={p.participantIdentity}
              type="button"
              onClick={() => onSelectSpotlightParticipant?.(p.participantIdentity)}
              className="h-full w-40 flex-shrink-0 text-left focus:outline-none focus:ring-2 focus:ring-accent rounded-xl overflow-hidden"
              title={`Switch spotlight to ${p.name}`}
              aria-label={`View ${p.name}`}
            >
              <ParticipantTile {...p} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Standard Equal Dynamic Grid (Desktop / count <= 9)
  return (
    <div className={`grid h-full w-full gap-2 p-2 ${gridClass}`}>
      {participants.map((p) => (
        <div
          key={p.participantIdentity}
          className="relative min-h-[140px] w-full cursor-pointer"
          onClick={() => onSelectSpotlightParticipant?.(p.participantIdentity)}
        >
          <ParticipantTile {...p} />
        </div>
      ))}
    </div>
  );
}
