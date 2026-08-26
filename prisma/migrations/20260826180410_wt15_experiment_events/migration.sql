-- WT-15: acquisition experiments — funnel instrumentation.
-- Tracks tool usage + conversion funnel (view → analysis start → result → account).

-- Experiment events: one row per funnel event. Append-only.
CREATE TABLE "ExperimentEvent" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "event"     TEXT NOT NULL,
    "tool"      TEXT,
    "variant"   TEXT,
    "source"    TEXT,
    "referrer"  TEXT,
    "sessionId" TEXT,
    "ip"        TEXT,
    "detail"    TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ExperimentEvent_tool_event_createdAt_idx" ON "ExperimentEvent"("tool", "event", "createdAt");
CREATE INDEX "ExperimentEvent_createdAt_idx" ON "ExperimentEvent"("createdAt");

-- Track which SEO tool (if any) a submission came from.
ALTER TABLE "Submission" ADD COLUMN "tool" TEXT;
