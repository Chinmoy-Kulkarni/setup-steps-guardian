ALTER TABLE repositories
ADD COLUMN scan_enabled INTEGER NOT NULL DEFAULT 1 CHECK (scan_enabled IN (0, 1));

CREATE INDEX idx_repositories_account_scan_enabled
  ON repositories(account_id, is_selected, scan_enabled, is_archived);
