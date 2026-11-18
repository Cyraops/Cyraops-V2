-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");

-- Backfill: stamp the owning workspace where the schema offers an
-- unambiguous owner path. Contact has no creator/owner column, so the only
-- owner signals are linked deals (Deal.ownerId) and leads (Lead.assignedToId).
-- A row is stamped only when EVERY linked deal/lead agrees on one owner;
-- contacts with conflicting owners, or with no linked deal/lead at all, keep
-- workspaceId NULL and stay scoped through their deal/lead links
-- (memberContactWhere's fallback path).
UPDATE "Contact" c
SET "workspaceId" = t."ownerId"
FROM (
  SELECT cand.cid AS id, MIN(cand.owner) AS "ownerId"
  FROM (
    SELECT d."contactId" AS cid, d."ownerId" AS owner
    FROM "Deal" d
    WHERE d."contactId" IS NOT NULL AND d."ownerId" IS NOT NULL
    UNION ALL
    SELECT l."contactId" AS cid, l."assignedToId" AS owner
    FROM "Lead" l
    WHERE l."contactId" IS NOT NULL AND l."assignedToId" IS NOT NULL
  ) cand
  GROUP BY cand.cid
  HAVING MIN(cand.owner) = MAX(cand.owner)
) t
WHERE c.id = t.id AND c."workspaceId" IS NULL;
