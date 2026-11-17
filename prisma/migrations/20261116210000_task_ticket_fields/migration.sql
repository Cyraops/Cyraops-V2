-- Tasks are worked as tickets, so they need the properties a service desk shows.
CREATE TYPE "TaskSource" AS ENUM ('EMAIL', 'PHONE', 'CHAT', 'WEB', 'PORTAL', 'API');
CREATE TYPE "TaskType" AS ENUM ('SERVICE_REQUEST', 'INCIDENT', 'PROBLEM', 'CHANGE');

ALTER TABLE "Task" ADD COLUMN "source" "TaskSource";
ALTER TABLE "Task" ADD COLUMN "type" "TaskType";
ALTER TABLE "Task" ADD COLUMN "groupName" TEXT;
ALTER TABLE "Task" ADD COLUMN "category" TEXT;
ALTER TABLE "Task" ADD COLUMN "requesterName" TEXT;
ALTER TABLE "Task" ADD COLUMN "requesterEmail" TEXT;
ALTER TABLE "Task" ADD COLUMN "resolution" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "closedAt" TIMESTAMP(3);

-- Human-facing ticket number. SERIAL backfills existing rows in table order, so
-- every task already in the database gets a stable number in the same statement.
ALTER TABLE "Task" ADD COLUMN "number" SERIAL NOT NULL;
CREATE UNIQUE INDEX "Task_number_key" ON "Task"("number");
CREATE INDEX "Task_status_priority_idx" ON "Task"("status", "priority");
