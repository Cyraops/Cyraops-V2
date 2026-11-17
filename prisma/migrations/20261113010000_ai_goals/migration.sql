-- AlterTable
ALTER TABLE "AiTask" ADD COLUMN     "goalId" TEXT;

-- CreateTable
CREATE TABLE "AiGoal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "successCriteria" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "round" INTEGER NOT NULL DEFAULT 0,
    "maxRounds" INTEGER NOT NULL DEFAULT 10,
    "lastEvaluation" TEXT,
    "lastAdvancedAt" TIMESTAMP(3),
    "achievedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentMessage" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "fromAgentSlug" TEXT,
    "toAgentSlug" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'AGENT',
    "body" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGoal_status_lastAdvancedAt_idx" ON "AiGoal"("status", "lastAdvancedAt");

-- CreateIndex
CREATE INDEX "AiAgentMessage_goalId_createdAt_idx" ON "AiAgentMessage"("goalId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "AiGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentMessage" ADD CONSTRAINT "AiAgentMessage_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "AiGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

