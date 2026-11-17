-- A task can have several owners, and an AI agent can be one of them.
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "agentSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id"),
    -- Exactly one kind of owner per row.
    CONSTRAINT "TaskAssignee_one_owner" CHECK (num_nonnulls("userId", "agentSlug") = 1)
);

CREATE UNIQUE INDEX "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");
CREATE UNIQUE INDEX "TaskAssignee_taskId_agentSlug_key" ON "TaskAssignee"("taskId", "agentSlug");
CREATE INDEX "TaskAssignee_taskId_idx" ON "TaskAssignee"("taskId");
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing single assignee becomes the first row of its set, so
-- nobody loses work they already own.
INSERT INTO "TaskAssignee" ("id", "taskId", "userId", "createdAt")
SELECT 'ta_' || md5(random()::text || clock_timestamp()::text), "id", "assigneeId", CURRENT_TIMESTAMP
FROM "Task"
WHERE "assigneeId" IS NOT NULL;
