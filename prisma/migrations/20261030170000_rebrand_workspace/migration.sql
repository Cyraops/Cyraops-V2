ALTER TABLE "Workspace" ALTER COLUMN "name" SET DEFAULT 'Cyraops';

UPDATE "Workspace"
SET "name" = 'Cyraops'
WHERE "id" = 'main'
  AND "name" IN ('Northstar Workspace', 'Company Workspace');
