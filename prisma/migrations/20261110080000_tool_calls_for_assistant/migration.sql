-- AlterTable
ALTER TABLE "AiToolCall" ADD COLUMN     "conversationId" TEXT,
ALTER COLUMN "taskId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AiToolCall_conversationId_createdAt_idx" ON "AiToolCall"("conversationId", "createdAt");

