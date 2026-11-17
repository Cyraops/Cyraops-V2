-- CreateTable
CREATE TABLE "AssistantPendingAction" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "toolId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantPendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantPendingAction_userId_status_createdAt_idx" ON "AssistantPendingAction"("userId", "status", "createdAt");
