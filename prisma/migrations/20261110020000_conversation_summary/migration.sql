-- AlterTable
ALTER TABLE "AssistantConversation" ADD COLUMN     "summarizedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryUpTo" TIMESTAMP(3);

