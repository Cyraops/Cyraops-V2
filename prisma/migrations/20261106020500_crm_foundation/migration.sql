-- AlterTable
ALTER TABLE "Company" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "convertedProjectId" TEXT,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "companyId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "dealId" TEXT;

-- CreateIndex
CREATE INDEX "Company_archivedAt_idx" ON "Company"("archivedAt");

-- CreateIndex
CREATE INDEX "Contact_archivedAt_idx" ON "Contact"("archivedAt");

-- CreateIndex
CREATE INDEX "Deal_archivedAt_idx" ON "Deal"("archivedAt");

-- CreateIndex
CREATE INDEX "Deal_convertedProjectId_idx" ON "Deal"("convertedProjectId");

-- CreateIndex
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");

-- CreateIndex
CREATE INDEX "Lead_archivedAt_idx" ON "Lead"("archivedAt");

-- CreateIndex
CREATE INDEX "Project_dealId_idx" ON "Project"("dealId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_convertedProjectId_fkey" FOREIGN KEY ("convertedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

