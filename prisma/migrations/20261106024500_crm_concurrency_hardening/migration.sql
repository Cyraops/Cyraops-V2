-- Drop old non-unique indexes
DROP INDEX IF EXISTS "Deal_convertedProjectId_idx";
DROP INDEX IF EXISTS "Project_dealId_idx";

-- Create unique indexes for 1:1 Deal-Project relations (F-P2-01)
CREATE UNIQUE INDEX "Deal_convertedProjectId_key" ON "Deal"("convertedProjectId");
CREATE UNIQUE INDEX "Project_dealId_key" ON "Project"("dealId");

-- Create partial unique indexes for duplicate prevention on active CRM records (F-P2-02)
CREATE UNIQUE INDEX "Contact_email_unique_active" ON "Contact"(lower("email")) WHERE "archivedAt" IS NULL AND "email" IS NOT NULL;
CREATE UNIQUE INDEX "Lead_email_unique_active" ON "Lead"(lower("email")) WHERE "archivedAt" IS NULL AND "email" IS NOT NULL;
CREATE UNIQUE INDEX "Company_name_unique_active" ON "Company"(lower("name")) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "Company_domain_unique_active" ON "Company"(lower("domain")) WHERE "archivedAt" IS NULL AND "domain" IS NOT NULL;

