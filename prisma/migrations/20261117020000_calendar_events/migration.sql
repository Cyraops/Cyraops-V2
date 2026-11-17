-- A calendar event that is not a task: a meeting with a start, an end and people.
CREATE TABLE "CalendarEvent" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "location" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "attendees" TEXT NOT NULL DEFAULT '',
  "creatorId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CalendarEvent_startsAt_idx" ON "CalendarEvent"("startsAt");
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
