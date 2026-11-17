-- CreateTable
CREATE TABLE "AssistantConversation" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AssistantMessage" ADD COLUMN "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "AssistantConversation_assistantId_updatedAt_idx" ON "AssistantConversation"("assistantId", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_conversationId_createdAt_idx" ON "AssistantMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
