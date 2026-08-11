import { bindStatement, changedRows, type D1DatabaseLike, DataInvariantError } from "./database.js";
import { type DatabaseRow, readBoolean, readEnum, readInteger, readString } from "./rows.js";
import {
  assertIntegerAtLeast,
  assertIntegerBetween,
  assertNonEmpty,
  assertSha256,
  assertTimestamp,
  toSqlBoolean,
} from "./validation.js";

const POLICY_SEVERITIES = ["off", "warning", "error"] as const;
const ACCOUNT_POLICY_ID = "account";

export type PolicySeverity = (typeof POLICY_SEVERITIES)[number];

export interface AccountPolicy {
  readonly accountId: string;
  readonly schemaVersion: number;
  readonly policyHash: string;
  readonly allowedRunners: readonly string[];
  readonly maxTimeoutMinutes: number;
  readonly requireTimeout: boolean;
  readonly requireExplicitPermissions: boolean;
  readonly requireWorkflowDispatch: boolean;
  readonly actionPinning: PolicySeverity;
  readonly secretUsage: PolicySeverity;
  readonly unsupportedJobKeys: PolicySeverity;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertAccountPolicyInput {
  readonly accountId: string;
  readonly schemaVersion: number;
  readonly policyHash: string;
  readonly allowedRunners: readonly string[];
  readonly maxTimeoutMinutes: number;
  readonly requireTimeout: boolean;
  readonly requireExplicitPermissions: boolean;
  readonly requireWorkflowDispatch: boolean;
  readonly actionPinning: PolicySeverity;
  readonly secretUsage: PolicySeverity;
  readonly unsupportedJobKeys: PolicySeverity;
  readonly updatedAt: string;
}

function parseAllowedRunners(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((runner) => typeof runner !== "string" || runner.trim().length === 0)
  ) {
    throw new DataInvariantError("Expected allowed_runners_json to contain non-empty strings");
  }
  return parsed;
}

function mapAccountPolicy(row: DatabaseRow): AccountPolicy {
  return {
    accountId: readString(row, "account_id"),
    schemaVersion: readInteger(row, "schema_version"),
    policyHash: readString(row, "policy_hash"),
    allowedRunners: parseAllowedRunners(readString(row, "allowed_runners_json")),
    maxTimeoutMinutes: readInteger(row, "max_timeout_minutes"),
    requireTimeout: readBoolean(row, "require_timeout"),
    requireExplicitPermissions: readBoolean(row, "require_explicit_permissions"),
    requireWorkflowDispatch: readBoolean(row, "require_workflow_dispatch"),
    actionPinning: readEnum(row, "action_pinning", POLICY_SEVERITIES),
    secretUsage: readEnum(row, "secret_usage", POLICY_SEVERITIES),
    unsupportedJobKeys: readEnum(row, "unsupported_job_keys", POLICY_SEVERITIES),
    createdAt: readString(row, "created_at"),
    updatedAt: readString(row, "updated_at"),
  };
}

export async function upsertAccountPolicy(
  db: D1DatabaseLike,
  input: UpsertAccountPolicyInput,
): Promise<void> {
  assertNonEmpty(input.accountId, "accountId");
  assertIntegerAtLeast(input.schemaVersion, 1, "schemaVersion");
  assertSha256(input.policyHash, "policyHash");
  if (input.allowedRunners.length === 0) {
    throw new RangeError("allowedRunners must contain at least one runner");
  }
  for (const runner of input.allowedRunners) {
    assertNonEmpty(runner, "allowedRunners entry");
  }
  if (new Set(input.allowedRunners).size !== input.allowedRunners.length) {
    throw new RangeError("allowedRunners must not contain duplicates");
  }
  assertIntegerBetween(input.maxTimeoutMinutes, 1, 59, "maxTimeoutMinutes");
  assertTimestamp(input.updatedAt, "updatedAt");

  await bindStatement(
    db,
    `
      INSERT INTO policies (
        account_id,
        id,
        scope,
        repository_id,
        schema_version,
        policy_hash,
        allowed_runners_json,
        max_timeout_minutes,
        require_timeout,
        require_explicit_permissions,
        require_workflow_dispatch,
        action_pinning,
        secret_usage,
        unsupported_job_keys,
        created_at,
        updated_at
      )
      VALUES (?, ?, 'account', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, id) DO UPDATE SET
        schema_version = excluded.schema_version,
        policy_hash = excluded.policy_hash,
        allowed_runners_json = excluded.allowed_runners_json,
        max_timeout_minutes = excluded.max_timeout_minutes,
        require_timeout = excluded.require_timeout,
        require_explicit_permissions = excluded.require_explicit_permissions,
        require_workflow_dispatch = excluded.require_workflow_dispatch,
        action_pinning = excluded.action_pinning,
        secret_usage = excluded.secret_usage,
        unsupported_job_keys = excluded.unsupported_job_keys,
        updated_at = excluded.updated_at
    `,
    [
      input.accountId,
      ACCOUNT_POLICY_ID,
      input.schemaVersion,
      input.policyHash,
      JSON.stringify(input.allowedRunners),
      input.maxTimeoutMinutes,
      toSqlBoolean(input.requireTimeout),
      toSqlBoolean(input.requireExplicitPermissions),
      toSqlBoolean(input.requireWorkflowDispatch),
      input.actionPinning,
      input.secretUsage,
      input.unsupportedJobKeys,
      input.updatedAt,
      input.updatedAt,
    ],
  ).run();
}

export async function getAccountPolicy(
  db: D1DatabaseLike,
  accountId: string,
): Promise<AccountPolicy | null> {
  assertNonEmpty(accountId, "accountId");

  const row = await bindStatement(
    db,
    `
      SELECT
        account_id,
        schema_version,
        policy_hash,
        allowed_runners_json,
        max_timeout_minutes,
        require_timeout,
        require_explicit_permissions,
        require_workflow_dispatch,
        action_pinning,
        secret_usage,
        unsupported_job_keys,
        created_at,
        updated_at
      FROM policies
      WHERE account_id = ?
        AND scope = 'account'
        AND repository_id IS NULL
    `,
    [accountId],
  ).first<DatabaseRow>();

  return row === null ? null : mapAccountPolicy(row);
}

export async function deleteAccountPolicy(db: D1DatabaseLike, accountId: string): Promise<boolean> {
  assertNonEmpty(accountId, "accountId");

  const result = await bindStatement(
    db,
    `
      DELETE FROM policies
      WHERE account_id = ?
        AND scope = 'account'
        AND repository_id IS NULL
    `,
    [accountId],
  ).run();

  return changedRows(result) > 0;
}
