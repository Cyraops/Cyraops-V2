-- Shipped agents become templates: cloneable starting points, not editable rows.
ALTER TABLE "AiAgent" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
UPDATE "AiAgent" SET "isTemplate" = true
  WHERE slug IN ('chief_of_staff','research','sales','communication','business_analyst','customer_support','workflow_automation');
