-- Move authentication to one workspace credential. User rows now represent profiles only.
ALTER TABLE "Workspace" ADD COLUMN "loginEmail" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "loginPasswordHash" TEXT;

UPDATE "Workspace" AS workspace
SET "loginEmail" = owner."email",
    "loginPasswordHash" = owner."passwordHash"
FROM "User" AS owner
WHERE owner."id" = workspace."ownerId";

ALTER TABLE "Workspace" ALTER COLUMN "loginEmail" SET NOT NULL;
ALTER TABLE "Workspace" ALTER COLUMN "loginPasswordHash" SET NOT NULL;
CREATE UNIQUE INDEX "Workspace_loginEmail_key" ON "Workspace"("loginEmail");

DROP INDEX "User_email_key";
ALTER TABLE "User" DROP COLUMN "email";
ALTER TABLE "User" DROP COLUMN "passwordHash";

DROP TABLE "Invitation";
DROP TABLE "PasswordReset";
