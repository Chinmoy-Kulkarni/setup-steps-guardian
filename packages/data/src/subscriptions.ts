import { bindStatement, type D1DatabaseLike, DataInvariantError } from "./database.js";
import { type DatabaseRow, readEnum, readInteger, readNullableString, readString } from "./rows.js";
import {
  assertIntegerAtLeast,
  assertNonEmpty,
  assertTimestamp,
  normalizeTimestamp,
} from "./validation.js";

const ENTITLEMENT_STATUSES = ["active", "grace", "inactive"] as const;
const ENTITLEMENT_SOURCES = ["paddle", "github_marketplace", "manual", "none"] as const;

export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];
export type SubscriptionUpsertOutcome = "applied" | "duplicate" | "stale";

export interface SubscriptionEntitlement {
  readonly accountId: string;
  readonly planKey: string;
  readonly status: EntitlementStatus;
  readonly repositoryLimit: number | null;
  readonly source: EntitlementSource;
  readonly providerCustomerId: string | null;
  readonly providerSubscriptionId: string | null;
  readonly lastProviderEventId: string | null;
  readonly lastProviderEventAt: string | null;
  readonly effectiveAt: string;
  readonly expiresAt: string | null;
  readonly updatedAt: string;
}

interface SubscriptionEntitlementInput {
  readonly accountId: string;
  readonly planKey: string;
  readonly status: EntitlementStatus;
  readonly repositoryLimit: number | null;
  readonly effectiveAt: string;
  readonly expiresAt: string | null;
  readonly updatedAt: string;
}

export interface SetPaddleSubscriptionEntitlementInput extends SubscriptionEntitlementInput {
  readonly source: "paddle";
  readonly providerCustomerId: string | null;
  readonly providerSubscriptionId: string | null;
  readonly lastProviderEventId: string;
  readonly lastProviderEventAt: string;
}

export interface SetNonPaddleSubscriptionEntitlementInput extends SubscriptionEntitlementInput {
  readonly source: Exclude<EntitlementSource, "paddle">;
  readonly providerCustomerId?: never;
  readonly providerSubscriptionId?: never;
  readonly lastProviderEventId?: never;
  readonly lastProviderEventAt?: never;
}

export type SetSubscriptionEntitlementInput =
  | SetPaddleSubscriptionEntitlementInput
  | SetNonPaddleSubscriptionEntitlementInput;

export interface SubscriptionUpsertResult {
  readonly outcome: SubscriptionUpsertOutcome;
  readonly entitlement: SubscriptionEntitlement;
}

const SUBSCRIPTION_COLUMNS = `
  account_id,
  plan_key,
  entitlement_status,
  repository_limit,
  source,
  provider_customer_id,
  provider_subscription_id,
  last_provider_event_id,
  last_provider_event_at,
  effective_at,
  expires_at,
  updated_at
`;

function mapEntitlement(row: DatabaseRow): SubscriptionEntitlement {
  const repositoryLimit =
    row.repository_limit === null ? null : readInteger(row, "repository_limit");

  return {
    accountId: readString(row, "account_id"),
    planKey: readString(row, "plan_key"),
    status: readEnum(row, "entitlement_status", ENTITLEMENT_STATUSES),
    repositoryLimit,
    source: readEnum(row, "source", ENTITLEMENT_SOURCES),
    providerCustomerId: readNullableString(row, "provider_customer_id"),
    providerSubscriptionId: readNullableString(row, "provider_subscription_id"),
    lastProviderEventId: readNullableString(row, "last_provider_event_id"),
    lastProviderEventAt: readNullableString(row, "last_provider_event_at"),
    effectiveAt: readString(row, "effective_at"),
    expiresAt: readNullableString(row, "expires_at"),
    updatedAt: readString(row, "updated_at"),
  };
}

function validateInput(input: SetSubscriptionEntitlementInput): void {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.planKey, "planKey");
  if (input.repositoryLimit !== null) {
    assertIntegerAtLeast(input.repositoryLimit, 1, "repositoryLimit");
  }
  assertTimestamp(input.effectiveAt, "effectiveAt");
  if (input.expiresAt !== null) {
    assertTimestamp(input.expiresAt, "expiresAt");
  }
  assertTimestamp(input.updatedAt, "updatedAt");

  if (input.source === "paddle") {
    if (input.providerCustomerId !== null) {
      assertNonEmpty(input.providerCustomerId, "providerCustomerId");
    }
    if (input.providerSubscriptionId !== null) {
      assertNonEmpty(input.providerSubscriptionId, "providerSubscriptionId");
    }
    assertNonEmpty(input.lastProviderEventId, "lastProviderEventId");
    assertTimestamp(input.lastProviderEventAt, "lastProviderEventAt");
  }
}

async function readEntitlement(
  db: D1DatabaseLike,
  accountId: string,
): Promise<SubscriptionEntitlement | null> {
  const row = await bindStatement(
    db,
    `
      SELECT ${SUBSCRIPTION_COLUMNS}
      FROM subscriptions
      WHERE account_id = ?
    `,
    [accountId],
  ).first<DatabaseRow>();

  return row === null ? null : mapEntitlement(row);
}

export async function setSubscriptionEntitlement(
  db: D1DatabaseLike,
  input: SetSubscriptionEntitlementInput,
): Promise<SubscriptionUpsertResult> {
  validateInput(input);
  const isPaddle = input.source === "paddle";
  const providerCustomerId = isPaddle ? input.providerCustomerId : null;
  const providerSubscriptionId = isPaddle ? input.providerSubscriptionId : null;
  const lastProviderEventId = isPaddle ? input.lastProviderEventId : null;
  const lastProviderEventAt = isPaddle
    ? normalizeTimestamp(input.lastProviderEventAt, "lastProviderEventAt")
    : null;

  const row = await bindStatement(
    db,
    `
      INSERT INTO subscriptions (
        account_id,
        plan_key,
        entitlement_status,
        repository_limit,
        source,
        provider_customer_id,
        provider_subscription_id,
        last_provider_event_id,
        last_provider_event_at,
        effective_at,
        expires_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id) DO UPDATE SET
        plan_key = excluded.plan_key,
        entitlement_status = excluded.entitlement_status,
        repository_limit = excluded.repository_limit,
        source = excluded.source,
        provider_customer_id = excluded.provider_customer_id,
        provider_subscription_id = excluded.provider_subscription_id,
        last_provider_event_id = excluded.last_provider_event_id,
        last_provider_event_at = excluded.last_provider_event_at,
        effective_at = excluded.effective_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      WHERE excluded.source <> 'paddle'
        OR subscriptions.last_provider_event_id IS NULL
        OR (
          excluded.last_provider_event_id <> subscriptions.last_provider_event_id
          AND (
            excluded.last_provider_event_at > subscriptions.last_provider_event_at
            OR (
              excluded.last_provider_event_at = subscriptions.last_provider_event_at
              AND excluded.last_provider_event_id > subscriptions.last_provider_event_id
            )
          )
        )
      RETURNING ${SUBSCRIPTION_COLUMNS}
    `,
    [
      input.accountId,
      input.planKey,
      input.status,
      input.repositoryLimit,
      input.source,
      providerCustomerId,
      providerSubscriptionId,
      lastProviderEventId,
      lastProviderEventAt,
      input.effectiveAt,
      input.expiresAt,
      input.updatedAt,
    ],
  ).first<DatabaseRow>();

  if (row !== null) {
    return {
      outcome: "applied",
      entitlement: mapEntitlement(row),
    };
  }

  const existing = await readEntitlement(db, input.accountId);
  if (existing === null || !isPaddle) {
    throw new DataInvariantError("Subscription upsert did not return the persisted entitlement");
  }

  return {
    outcome: existing.lastProviderEventId === input.lastProviderEventId ? "duplicate" : "stale",
    entitlement: existing,
  };
}

export async function getSubscriptionEntitlement(
  db: D1DatabaseLike,
  accountId: string,
): Promise<SubscriptionEntitlement | null> {
  assertNonEmpty(accountId, "accountId");
  return readEntitlement(db, accountId);
}

export async function getSubscriptionEntitlementByProviderSubscriptionId(
  db: D1DatabaseLike,
  providerSubscriptionId: string,
): Promise<SubscriptionEntitlement | null> {
  assertNonEmpty(providerSubscriptionId, "providerSubscriptionId");

  const row = await bindStatement(
    db,
    `
      SELECT ${SUBSCRIPTION_COLUMNS}
      FROM subscriptions
      WHERE source = 'paddle'
        AND provider_subscription_id = ?
    `,
    [providerSubscriptionId],
  ).first<DatabaseRow>();

  return row === null ? null : mapEntitlement(row);
}
