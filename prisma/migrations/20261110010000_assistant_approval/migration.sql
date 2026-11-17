-- AlterTable
ALTER TABLE "Assistant" ADD COLUMN     "approvalMode" TEXT NOT NULL DEFAULT 'ASK';

-- CreateTable
CREATE TABLE "AssistantApprovalRule" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantApprovalRule_assistantId_idx" ON "AssistantApprovalRule"("assistantId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantApprovalRule_assistantId_toolName_key" ON "AssistantApprovalRule"("assistantId", "toolName");

-- AddForeignKey
ALTER TABLE "AssistantApprovalRule" ADD CONSTRAINT "AssistantApprovalRule_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

