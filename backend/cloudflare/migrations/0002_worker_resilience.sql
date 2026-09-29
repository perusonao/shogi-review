ALTER TABLE analysis_requests ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_requests ADD COLUMN failure_stage TEXT;
ALTER TABLE analysis_requests ADD COLUMN last_error_at TEXT;
