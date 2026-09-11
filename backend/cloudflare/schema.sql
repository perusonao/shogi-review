CREATE TABLE IF NOT EXISTS analysis_requests (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  kif TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  game_id TEXT,
  error_message TEXT,
  claim_token TEXT,
  lease_until TEXT
);

CREATE INDEX IF NOT EXISTS analysis_requests_status_created
  ON analysis_requests(status, created_at);
