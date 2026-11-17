-- AlterTable
ALTER TABLE "AiRoutine" ADD COLUMN     "emailSenders" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "triggerType" TEXT NOT NULL DEFAULT 'SCHEDULE',
ADD COLUMN     "watchField" TEXT,
ADD COLUMN     "watchModel" TEXT,
ADD COLUMN     "watchValue" TEXT,
ADD COLUMN     "webhookToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AiRoutine_webhookToken_key" ON "AiRoutine"("webhookToken");

