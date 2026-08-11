PRAGMA foreign_keys = ON;

CREATE TABLE github_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  login TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('Organization', 'User')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX github_accounts_login
  ON github_accounts (account_type, login COLLATE NOCASE);

CREATE TABLE installations (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  repository_selection TEXT NOT NULL
    CHECK (repository_selection IN ('all', 'selected')),
  suspended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id),
  FOREIGN KEY (account_id)
    REFERENCES github_accounts (id)
    ON DELETE CASCADE
);

CREATE INDEX installations_tenant_list
  ON installations (account_id, updated_at DESC);

CREATE TABLE repositories (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  is_private INTEGER NOT NULL CHECK (is_private IN (0, 1)),
  default_branch TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  is_selected INTEGER NOT NULL DEFAULT 1 CHECK (is_selected IN (0, 1)),
  setup_status TEXT NOT NULL DEFAULT 'unproven'
    CHECK (
      setup_status IN (
        'missing',
        'invalid',
        'drifting',
        'unproven',
        'passing',
        'failing',
        'stale'
      )
    ),
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id),
  UNIQUE (account_id, owner, name),
  FOREIGN KEY (account_id, installation_id)
    REFERENCES installations (account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX repositories_tenant_list
  ON repositories (account_id, is_selected, owner COLLATE NOCASE, name COLLATE NOCASE);

CREATE INDEX repositories_installation
  ON repositories (account_id, installation_id);

CREATE TABLE policies (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('account', 'repository')),
  repository_id TEXT,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  policy_hash TEXT NOT NULL,
  allowed_runners_json TEXT NOT NULL,
  max_timeout_minutes INTEGER NOT NULL CHECK (max_timeout_minutes BETWEEN 1 AND 59),
  require_timeout INTEGER NOT NULL CHECK (require_timeout IN (0, 1)),
  require_explicit_permissions INTEGER NOT NULL
    CHECK (require_explicit_permissions IN (0, 1)),
  require_workflow_dispatch INTEGER NOT NULL
    CHECK (require_workflow_dispatch IN (0, 1)),
  action_pinning TEXT NOT NULL CHECK (action_pinning IN ('off', 'warning', 'error')),
  secret_usage TEXT NOT NULL CHECK (secret_usage IN ('off', 'warning', 'error')),
  unsupported_job_keys TEXT NOT NULL
    CHECK (unsupported_job_keys IN ('off', 'warning', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id),
  CHECK (
    (scope = 'account' AND repository_id IS NULL)
    OR (scope = 'repository' AND repository_id IS NOT NULL)
  ),
  FOREIGN KEY (account_id)
    REFERENCES github_accounts (id)
    ON DELETE CASCADE,
  FOREIGN KEY (account_id, repository_id)
    REFERENCES repositories (account_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX policies_account_scope
  ON policies (account_id)
  WHERE scope = 'account';

CREATE UNIQUE INDEX policies_repository_scope
  ON policies (account_id, repository_id)
  WHERE scope = 'repository';
