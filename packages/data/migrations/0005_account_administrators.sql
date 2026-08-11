PRAGMA foreign_keys = ON;

CREATE TABLE account_administrators (
  account_id TEXT NOT NULL,
  github_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, github_user_id),
  FOREIGN KEY (account_id)
    REFERENCES github_accounts (id)
    ON DELETE CASCADE
);

CREATE INDEX account_administrators_user
  ON account_administrators (github_user_id, account_id);
