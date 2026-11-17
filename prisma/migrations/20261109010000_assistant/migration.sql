-- CreateTable
CREATE TABLE "Assistant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Cyraops Assistant',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT 'deepseek-flash',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMemory" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assistant_userId_key" ON "Assistant"("userId");

-- CreateIndex
CREATE INDEX "AssistantMessage_assistantId_createdAt_idx" ON "AssistantMessage"("assistantId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantMemory_assistantId_createdAt_idx" ON "AssistantMemory"("assistantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMemory" ADD CONSTRAINT "AssistantMemory_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
