PRAGMA foreign_keys = ON;

CREATE TABLE subscriptions (
  account_id TEXT PRIMARY KEY NOT NULL,
  plan_key TEXT NOT NULL,
  entitlement_status TEXT NOT NULL
    CHECK (entitlement_status IN ('active', 'grace', 'inactive')),
  repository_limit INTEGER CHECK (repository_limit IS NULL OR repository_limit > 0),
  source TEXT NOT NULL
    CHECK (source IN ('paddle', 'github_marketplace', 'manual', 'none')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  last_provider_event_id TEXT,
  last_provider_event_at TEXT,
  effective_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (last_provider_event_id IS NULL AND last_provider_event_at IS NULL)
    OR (last_provider_event_id IS NOT NULL AND last_provider_event_at IS NOT NULL)
  ),
  CHECK (
    source = 'paddle'
    OR (
      provider_customer_id IS NULL
      AND provider_subscription_id IS NULL
      AND last_provider_event_id IS NULL
      AND last_provider_event_at IS NULL
    )
  ),
  FOREIGN KEY (account_id)
    REFERENCES github_accounts (id)
    ON DELETE CASCADE
);

CREATE INDEX subscriptions_entitlement
  ON subscriptions (entitlement_status, expires_at);

CREATE UNIQUE INDEX subscriptions_provider_subscription
  ON subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE TABLE webhook_deliveries (
  account_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'failed')),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  last_error_code TEXT,
  PRIMARY KEY (account_id, delivery_id),
  FOREIGN KEY (account_id)
    REFERENCES github_accounts (id)
    ON DELETE CASCADE
);

CREATE INDEX webhook_deliveries_tenant_status
  ON webhook_deliveries (account_id, status, received_at);

CREATE INDEX webhook_deliveries_retention
  ON webhook_deliveries (status, processed_at)
  WHERE status IN ('processed', 'failed');

CREATE TABLE audit_events (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('github', 'user', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  reason_code TEXT,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id),
  FOREIGN KEY (account_id)
    REFERENCES github_accounts (id)
    ON DELETE CASCADE
);

CREATE INDEX audit_events_tenant_timeline
  ON audit_events (account_id, occurred_at DESC, id DESC);
