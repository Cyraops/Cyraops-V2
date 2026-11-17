-- Phase 1 Calling Security & Reliability Remediation Migration
-- Target: company_os_dev

BEGIN;

-- 1. Add scoped columns to CallIdempotencyKey
ALTER TABLE "CallIdempotencyKey" 
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "endpoint" TEXT,
  ADD COLUMN IF NOT EXISTS "payloadHash" TEXT;

CREATE INDEX IF NOT EXISTS "CallIdempotencyKey_userId_endpoint_idx" 
  ON "CallIdempotencyKey" ("userId", "endpoint");

-- 2. Create PostgreSQL partial unique index to enforce at most one active call per conversation
CREATE UNIQUE INDEX IF NOT EXISTS "idx_call_session_unique_active_per_conv"
  ON "CallSession" ("conversationId")
  WHERE status IN ('CREATED', 'RINGING', 'CONNECTING', 'ACTIVE');

COMMIT;

