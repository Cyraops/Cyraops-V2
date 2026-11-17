-- AlterTable
ALTER TABLE "AiUsageLog" ADD COLUMN "userId" TEXT,
ADD COLUMN "source" TEXT;

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");
