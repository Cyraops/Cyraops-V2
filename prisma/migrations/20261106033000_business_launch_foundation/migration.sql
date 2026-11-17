-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "followUpDate" TIMESTAMP(3),
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "sourcePlatform" TEXT;

-- AlterTable
ALTER TABLE "ServiceCapability" ADD COLUMN     "expectedDuration" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pricingModel" TEXT NOT NULL DEFAULT 'FIXED_PRICE',
ADD COLUMN     "startingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "typicalDeliverables" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "address" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "industry" TEXT DEFAULT 'IT Services & Cloud Consulting',
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "registrationDetails" TEXT,
ADD COLUMN     "socialLinks" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "timezone" TEXT DEFAULT 'Asia/Kolkata',
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "BusinessReadinessItem" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ownerId" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessReadinessItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "problemStatement" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "deliverables" TEXT NOT NULL,
    "technologies" TEXT NOT NULL DEFAULT '[]',
    "timeline" TEXT NOT NULL,
    "pricing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentTerms" TEXT NOT NULL,
    "assumptions" TEXT,
    "validityDays" INTEGER NOT NULL DEFAULT 14,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deliverables" TEXT NOT NULL DEFAULT '[]',
    "billingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInvoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "dealId" TEXT,
    "clientCompanyId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Cloud & DevOps',
    "description" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "workDone" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "technologies" TEXT NOT NULL DEFAULT '[]',
    "isRealClient" BOOLEAN NOT NULL DEFAULT false,
    "clientName" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "metrics" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessReadinessItem_category_status_idx" ON "BusinessReadinessItem"("category", "status");

-- CreateIndex
CREATE INDEX "BusinessReadinessItem_ownerId_idx" ON "BusinessReadinessItem"("ownerId");

-- CreateIndex
CREATE INDEX "Proposal_dealId_status_idx" ON "Proposal"("dealId", "status");

-- CreateIndex
CREATE INDEX "Proposal_authorId_idx" ON "Proposal"("authorId");

-- CreateIndex
CREATE INDEX "ProjectMilestone_projectId_status_idx" ON "ProjectMilestone"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvoice_invoiceNumber_key" ON "ClientInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "ClientInvoice_projectId_status_idx" ON "ClientInvoice"("projectId", "status");

-- CreateIndex
CREATE INDEX "ClientInvoice_dealId_idx" ON "ClientInvoice"("dealId");

-- CreateIndex
CREATE INDEX "ClientInvoice_clientCompanyId_idx" ON "ClientInvoice"("clientCompanyId");

-- CreateIndex
CREATE INDEX "ClientInvoice_status_dueDate_idx" ON "ClientInvoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PortfolioItem_category_isPublic_idx" ON "PortfolioItem"("category", "isPublic");

-- CreateIndex
CREATE INDEX "Deal_sourcePlatform_idx" ON "Deal"("sourcePlatform");

-- CreateIndex
CREATE INDEX "Deal_followUpDate_idx" ON "Deal"("followUpDate");

-- AddForeignKey
ALTER TABLE "BusinessReadinessItem" ADD CONSTRAINT "BusinessReadinessItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

