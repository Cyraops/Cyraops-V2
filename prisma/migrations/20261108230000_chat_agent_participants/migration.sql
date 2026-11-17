-- AlterTable
ALTER TABLE "Message" ADD COLUMN "agentId" TEXT,
ALTER COLUMN "senderId" DROP NOT NULL;

-- Switch the sender relation from RESTRICT to SET NULL now that senderId is optional.
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey",
ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Message_agentId_createdAt_idx" ON "Message"("agentId", "createdAt");
