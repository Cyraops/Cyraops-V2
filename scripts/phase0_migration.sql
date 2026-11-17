-- Phase 0: Schema Evolution, Trigger, and Data Migration
BEGIN;

-- 1. Alter User table to add individual credentials
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Create unique index on email if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'User' AND indexname = 'User_email_key'
  ) THEN
    CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
  END IF;
END $$;

-- 2. Create PasswordSetupToken table
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

-- 3. PostgreSQL Trigger: Enforce Session Identity Immutability
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

-- 4. Data migration: Map existing users
-- Map owner from Workspace
UPDATE "User" u
SET "email" = LOWER(w."loginEmail"),
    "passwordHash" = w."loginPasswordHash",
    "mustChangePassword" = false
FROM "Workspace" w
WHERE u."id" = w."ownerId";

-- Map non-owner users who have no email
UPDATE "User"
SET "email" = 'audit.member@cyraops.com',
    "mustChangePassword" = true
WHERE "id" = 'cmvzwjiwx0000xt2phg0lw90o' AND ("email" IS NULL OR "email" = '');

UPDATE "User"
SET "email" = 'probe@cyraops.com',
    "mustChangePassword" = true
WHERE "id" = 'cmw10iyzd01soxt64u91fue3k' AND ("email" IS NULL OR "email" = '');

-- Fallback for any other user without email
UPDATE "User"
SET "email" = LOWER(REPLACE(REPLACE("name", ' ', '.'), '@', '.')) || '@cyraops.com',
    "mustChangePassword" = true
WHERE ("email" IS NULL OR "email" = '');

-- 5. Invalidate all legacy shared sessions
DELETE FROM "Session";

COMMIT;

