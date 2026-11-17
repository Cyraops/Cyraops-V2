-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "acceptedByUserId" TEXT,
ADD COLUMN "acceptanceChannel" TEXT,
ADD COLUMN "acceptanceReference" TEXT,
ADD COLUMN "acceptanceNotes" TEXT;

-- CreateIndex
CREATE INDEX "Proposal_acceptedByUserId_idx" ON "Proposal"("acceptedByUserId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS client_invoice_seq START WITH 1 INCREMENT BY 1;

