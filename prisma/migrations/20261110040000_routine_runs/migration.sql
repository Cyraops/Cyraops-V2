-- CreateTable
CREATE TABLE "RoutineRun" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutineRun_status_scheduledFor_idx" ON "RoutineRun"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "RoutineRun_routineId_createdAt_idx" ON "RoutineRun"("routineId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineRun_routineId_scheduledFor_key" ON "RoutineRun"("routineId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "RoutineRun" ADD CONSTRAINT "RoutineRun_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "AiRoutine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

