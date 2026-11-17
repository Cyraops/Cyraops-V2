-- AlterTable
ALTER TABLE "Message" ADD COLUMN "assistantId" TEXT;

-- CreateIndex
CREATE INDEX "Message_assistantId_createdAt_idx" ON "Message"("assistantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
