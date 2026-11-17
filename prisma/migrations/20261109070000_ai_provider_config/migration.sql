-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "apiKeyHint" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProviderConfig_isActive_idx" ON "AiProviderConfig"("isActive");
