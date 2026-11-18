-- CreateEnum
CREATE TYPE "PermissionMode" AS ENUM ('READ_ONLY', 'CONTROLLED', 'FULL_CONTROL', 'SYSTEM');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "permissionMode" "PermissionMode" NOT NULL DEFAULT 'CONTROLLED';

-- AlterTable
ALTER TABLE "AiAgent" ADD COLUMN "permissionMode" "PermissionMode";
