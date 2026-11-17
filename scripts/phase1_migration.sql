-- Phase 1 Migration: Calling Data Models, Enums, Indexes, and Constraints
BEGIN;

-- 1. Create Enums if not exist
DO $$ BEGIN
  CREATE TYPE "CallType" AS ENUM ('AUDIO', 'VIDEO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CallStatus" AS ENUM ('CREATED', 'RINGING', 'CONNECTING', 'ACTIVE', 'ENDING', 'ENDED', 'CANCELLED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ParticipantStatus" AS ENUM ('INVITED', 'RINGING', 'ACCEPTED', 'DECLINED', 'MISSED', 'CANCELLED', 'CONNECTING', 'CONNECTED', 'DISCONNECTED', 'LEFT', 'EJECTED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CallTerminationReason" AS ENUM ('NORMAL', 'HOST_ENDED', 'DECLINED', 'MISSED', 'TIMEOUT', 'EMPTY_ROOM', 'FAILED', 'CANCELLED_BY_CALLER', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CallEventType" AS ENUM (
    'CALL_CREATED', 'RINGING_STARTED', 'PARTICIPANT_INVITED', 'PARTICIPANT_RINGING',
    'PARTICIPANT_ACCEPTED', 'PARTICIPANT_DECLINED', 'PARTICIPANT_CONNECTING',
    'PARTICIPANT_CONNECTED', 'PARTICIPANT_DISCONNECTED', 'PARTICIPANT_LEFT',
    'PARTICIPANT_EJECTED', 'CALL_ACTIVE', 'HOST_REASSIGNED', 'CALL_ENDING',
    'CALL_ENDED', 'CALL_CANCELLED', 'CALL_FAILED', 'TIMEOUT_TRIGGERED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create CallSession Table
CREATE TABLE IF NOT EXISTS "CallSession" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "type" "CallType" NOT NULL DEFAULT 'AUDIO',
  "status" "CallStatus" NOT NULL DEFAULT 'CREATED',
  "initiatorId" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "livekitRoomName" TEXT NOT NULL,
  "screenShareEnabled" BOOLEAN NOT NULL DEFAULT false,
  "screenShareHostId" TEXT,
  "ringTimeoutAt" TIMESTAMP(3),
  "staleConnectingTimeoutAt" TIMESTAMP(3),
  "emptyRoomTimeoutAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "terminationReason" "CallTerminationReason",
  "terminationDetail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallSession_livekitRoomName_key" UNIQUE ("livekitRoomName"),
  CONSTRAINT "CallSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CallSession_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CallSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CallSession_conversationId_status_idx" ON "CallSession"("conversationId", "status");
CREATE INDEX IF NOT EXISTS "CallSession_status_ringTimeoutAt_idx" ON "CallSession"("status", "ringTimeoutAt");
CREATE INDEX IF NOT EXISTS "CallSession_status_staleConnectingTimeoutAt_idx" ON "CallSession"("status", "staleConnectingTimeoutAt");
CREATE INDEX IF NOT EXISTS "CallSession_status_emptyRoomTimeoutAt_idx" ON "CallSession"("status", "emptyRoomTimeoutAt");

-- 3. Create CallParticipant Table
CREATE TABLE IF NOT EXISTS "CallParticipant" (
  "id" TEXT NOT NULL,
  "callSessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "ParticipantStatus" NOT NULL DEFAULT 'INVITED',
  "isHost" BOOLEAN NOT NULL DEFAULT false,
  "canPublish" BOOLEAN NOT NULL DEFAULT true,
  "canSubscribe" BOOLEAN NOT NULL DEFAULT true,
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ringingAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "joinedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallParticipant_callSessionId_userId_key" UNIQUE ("callSessionId", "userId"),
  CONSTRAINT "CallParticipant_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CallParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CallParticipant_userId_status_idx" ON "CallParticipant"("userId", "status");
CREATE INDEX IF NOT EXISTS "CallParticipant_callSessionId_status_idx" ON "CallParticipant"("callSessionId", "status");

-- 4. Create CallEvent Table
CREATE TABLE IF NOT EXISTS "CallEvent" (
  "id" TEXT NOT NULL,
  "callSessionId" TEXT NOT NULL,
  "type" "CallEventType" NOT NULL,
  "actorId" TEXT,
  "targetUserId" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallEvent_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CallEvent_callSessionId_createdAt_idx" ON "CallEvent"("callSessionId", "createdAt");

-- 5. Create CallIdempotencyKey Table
CREATE TABLE IF NOT EXISTS "CallIdempotencyKey" (
  "key" TEXT NOT NULL,
  "callSessionId" TEXT,
  "responseJson" TEXT,
  "statusCode" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallIdempotencyKey_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "CallIdempotencyKey_expiresAt_idx" ON "CallIdempotencyKey"("expiresAt");

COMMIT;

