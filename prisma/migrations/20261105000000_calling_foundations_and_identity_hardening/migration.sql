-- Migration: 20261105000000_calling_foundations_and_identity_hardening
-- Purpose: Canonical migration for Individual Employee Auth, Session Immutability, Calling Foundation Models, Constraints, and Indexes.

-- 1. User table individual authentication fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'User' AND indexname = 'User_email_key'
  ) THEN
    CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
  END IF;
END $$;

-- 2. PasswordSetupToken table
CREATE TABLE IF NOT EXISTS "PasswordSetupToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordSetupToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordSetupToken_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "PasswordSetupToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PasswordSetupToken_userId_expiresAt_idx" ON "PasswordSetupToken"("userId", "expiresAt");

-- 3. Session identity immutability trigger
CREATE OR REPLACE FUNCTION enforce_session_identity_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'SECURITY VIOLATION: Session userId is immutable and cannot be modified (attempted change from % to %).', OLD."userId", NEW."userId"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_identity_immutable ON "Session";
CREATE TRIGGER trg_session_identity_immutable
BEFORE UPDATE ON "Session"
FOR EACH ROW
EXECUTE FUNCTION enforce_session_identity_immutability();

-- 4. Calling Enums
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

-- 5. CallSession Table
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

-- Partial unique index: at most one active call per conversation
CREATE UNIQUE INDEX IF NOT EXISTS "idx_call_session_unique_active_per_conv"
  ON "CallSession" ("conversationId")
  WHERE status IN ('CREATED', 'RINGING', 'CONNECTING', 'ACTIVE');

-- 6. CallParticipant Table
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

-- 7. CallEvent Table
CREATE TABLE IF NOT EXISTS "CallEvent" (
  "id" TEXT NOT NULL,
  "callSessionId" TEXT NOT NULL,
  "type" "CallEventType" NOT NULL,
  "actorId" TEXT,
  "targetUserId" TEXT,
  "payload" JSONB,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallEvent_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'CallEvent' AND indexname = 'CallEvent_dedupeKey_key'
  ) THEN
    CREATE UNIQUE INDEX "CallEvent_dedupeKey_key" ON "CallEvent"("dedupeKey");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CallEvent_callSessionId_createdAt_idx" ON "CallEvent"("callSessionId", "createdAt");

-- 8. CallIdempotencyKey Table
CREATE TABLE IF NOT EXISTS "CallIdempotencyKey" (
  "key" TEXT NOT NULL,
  "userId" TEXT,
  "endpoint" TEXT,
  "payloadHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "lockedAt" TIMESTAMP(3),
  "callSessionId" TEXT,
  "responseJson" TEXT,
  "statusCode" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallIdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- Ensure columns exist in case table was created previously
ALTER TABLE "CallIdempotencyKey" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "CallIdempotencyKey" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;
ALTER TABLE "CallIdempotencyKey" ADD COLUMN IF NOT EXISTS "payloadHash" TEXT;
ALTER TABLE "CallIdempotencyKey" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "CallIdempotencyKey" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CallIdempotencyKey_userId_endpoint_idx" ON "CallIdempotencyKey"("userId", "endpoint");
CREATE INDEX IF NOT EXISTS "CallIdempotencyKey_expiresAt_idx" ON "CallIdempotencyKey"("expiresAt");

