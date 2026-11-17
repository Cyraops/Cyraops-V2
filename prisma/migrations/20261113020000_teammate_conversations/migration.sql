-- AlterTable
ALTER TABLE "AssistantConversation" ADD COLUMN     "agentSlug" TEXT;

-- CreateIndex
CREATE INDEX "AssistantConversation_assistantId_agentSlug_updatedAt_idx" ON "AssistantConversation"("assistantId", "agentSlug", "updatedAt");

