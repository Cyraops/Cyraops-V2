-- Bearer tokens that let an outside system (Zapier, Typeform, a form handler)
-- create leads without a session cookie.
CREATE TABLE "IntakeToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "assignedToId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntakeToken_tokenHash_key" ON "IntakeToken"("tokenHash");
CREATE INDEX "IntakeToken_userId_idx" ON "IntakeToken"("userId");

ALTER TABLE "IntakeToken" ADD CONSTRAINT "IntakeToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
