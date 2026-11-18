-- AlterTable
ALTER TABLE "AiConversation" ADD COLUMN     "workspaceRoot" TEXT,
ADD COLUMN     "workspaceRootRealpath" TEXT;

-- AlterTable
ALTER TABLE "AssistantConversation" ADD COLUMN     "workspaceRoot" TEXT,
ADD COLUMN     "workspaceRootRealpath" TEXT;
