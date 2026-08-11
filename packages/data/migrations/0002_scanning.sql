PRAGMA foreign_keys = ON;

CREATE TABLE workflow_evidence (
  account_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  workflow_hash TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  lockfile_hashes_json TEXT NOT NULL,
  runner_label TEXT NOT NULL,
  conclusion TEXT NOT NULL
    CHECK (
      conclusion IN (
        'success',
        'failure',
        'cancelled',
        'timed_out',
        'skipped',
        'action_required',
        'neutral',
        'startup_failure'
      )
    ),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  failed_step TEXT,
  run_id TEXT NOT NULL,
  run_attempt INTEGER NOT NULL CHECK (run_attempt > 0),
  completed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (account_id, repository_id),
  FOREIGN KEY (account_id, repository_id)
    REFERENCES repositories (account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX workflow_evidence_tenant_completed
  ON workflow_evidence (account_id, completed_at DESC);

CREATE TABLE findings (
  account_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  path TEXT NOT NULL,
  line INTEGER CHECK (line > 0),
  evidence_json TEXT NOT NULL,
  remediation TEXT NOT NULL,
  documentation_url TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, repository_id, ordinal),
  FOREIGN KEY (account_id, repository_id)
    REFERENCES repositories (account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX findings_tenant_severity
  ON findings (account_id, severity, repository_id);

CREATE TABLE scan_jobs (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('installation', 'webhook', 'scheduled', 'manual')),
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (account_id, id),
  UNIQUE (account_id, dedupe_key),
  FOREIGN KEY (account_id, repository_id)
    REFERENCES repositories (account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX scan_jobs_tenant_queue
  ON scan_jobs (
    account_id,
    status,
    available_at,
    priority DESC,
    created_at
  );

CREATE INDEX scan_jobs_expired_leases
  ON scan_jobs (status, lease_expires_at)
  WHERE status = 'running';

CREATE INDEX scan_jobs_tenant_history
  ON scan_jobs (account_id, created_at DESC);

CREATE INDEX scan_jobs_retention
  ON scan_jobs (status, completed_at)
  WHERE completed_at IS NOT NULL;
