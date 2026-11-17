-- AlterTable
ALTER TABLE "AssistantMemory" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "AssistantMemory_assistantId_archivedAt_idx" ON "AssistantMemory"("assistantId", "archivedAt");

