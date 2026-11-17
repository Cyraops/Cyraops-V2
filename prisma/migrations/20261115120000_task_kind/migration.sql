-- Classify a task as a bug, a service item, or a category grouping item.
-- Nullable on purpose: existing rows are unknown, and guessing would corrupt reports.
CREATE TYPE "TaskKind" AS ENUM ('BUG', 'SERVICE', 'CATEGORY');

ALTER TABLE "Task" ADD COLUMN "kind" "TaskKind";

CREATE INDEX "Task_kind_idx" ON "Task"("kind");
