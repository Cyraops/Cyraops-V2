-- Projects are the only home for tasks and uploaded files. The standalone knowledge base is removed.
UPDATE "DriveFile" AS file
SET "projectId" = task."projectId"
FROM "Task" AS task
WHERE file."taskId" = task."id"
  AND file."projectId" IS NULL
  AND task."projectId" IS NOT NULL;

DELETE FROM "DriveFile" WHERE "projectId" IS NULL;
DELETE FROM "Task" WHERE "projectId" IS NULL;

ALTER TABLE "DriveFile" DROP CONSTRAINT "DriveFile_folderId_fkey";
ALTER TABLE "DriveFile" DROP CONSTRAINT "DriveFile_taskId_fkey";
ALTER TABLE "DriveFile" DROP CONSTRAINT "DriveFile_projectId_fkey";
DROP INDEX "DriveFile_folderId_deletedAt_idx";
ALTER TABLE "DriveFile" DROP COLUMN "folderId";
ALTER TABLE "DriveFile" DROP COLUMN "taskId";
ALTER TABLE "DriveFile" DROP COLUMN "isPersonal";
ALTER TABLE "DriveFile" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task" DROP CONSTRAINT "Task_projectId_fkey";
ALTER TABLE "Task" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "FilePermission";
DROP TABLE "DriveFolder";
DROP TABLE "KnowledgePage";
DROP TYPE "PermissionLevel";

DELETE FROM "Notification" WHERE "type" = 'FILE_SHARED';
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE TEXT;
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM ('MESSAGE', 'TASK_ASSIGNED', 'TASK_COMMENT', 'PROJECT_CHANGE', 'DEADLINE', 'SYSTEM');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType" USING "type"::"NotificationType";
DROP TYPE "NotificationType_old";
