-- AlterTable
ALTER TABLE "AssistantMessage" ADD COLUMN "attachments" TEXT;

-- CreateTable
CREATE TABLE "AssistantAttachment" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantAttachment_assistantId_createdAt_idx" ON "AssistantAttachment"("assistantId", "createdAt");
