import { bindStatement, changedRows, type D1DatabaseLike, DataInvariantError } from "./database.js";
import { type DatabaseRow, readEnum, readInteger, readNullableString, readString } from "./rows.js";
import {
  assertIntegerAtLeast,
  assertIntegerBetween,
  assertNonEmpty,
  assertTimestamp,
  normalizeTimestamp,
} from "./validation.js";

const SCAN_REASONS = ["installation", "webhook", "scheduled", "manual"] as const;
const SCAN_JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;

export type ScanReason = (typeof SCAN_REASONS)[number];
export type ScanJobStatus = (typeof SCAN_JOB_STATUSES)[number];

export interface ScanJob {
  readonly accountId: string;
  readonly id: string;
  readonly repositoryId: string;
  readonly reason: ScanReason;
  readonly status: ScanJobStatus;
  readonly priority: number;
  readonly dedupeKey: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface EnqueueScanJobInput {
  readonly accountId: string;
  readonly jobId: string;
  readonly repositoryId: string;
  readonly reason: ScanReason;
  readonly dedupeKey: string;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly availableAt: string;
  readonly createdAt: string;
}

export interface EnqueueScanJobResult {
  readonly created: boolean;
  readonly job: ScanJob;
}

export interface ClaimScanJobInput {
  readonly accountId: string;
  readonly workerId: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}

export interface CompleteScanJobInput {
  readonly accountId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly completedAt: string;
}

export interface RetryScanJobInput {
  readonly accountId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly errorCode: string;
  readonly retryAt: string;
  readonly updatedAt: string;
}

export interface FailScanJobInput {
  readonly accountId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly errorCode: string;
  readonly failedAt: string;
}

const JOB_COLUMNS = `
  account_id,
  id,
  repository_id,
  reason,
  status,
  priority,
  dedupe_key,
  attempt_count,
  max_attempts,
  available_at,
  lease_owner,
  lease_expires_at,
  last_error_code,
  created_at,
  updated_at,
  completed_at
`;

function mapScanJob(row: DatabaseRow): ScanJob {
  return {
    accountId: readString(row, "account_id"),
    id: readString(row, "id"),
    repositoryId: readString(row, "repository_id"),
    reason: readEnum(row, "reason", SCAN_REASONS),
    status: readEnum(row, "status", SCAN_JOB_STATUSES),
    priority: readInteger(row, "priority"),
    dedupeKey: readString(row, "dedupe_key"),
    attemptCount: readInteger(row, "attempt_count"),
    maxAttempts: readInteger(row, "max_attempts"),
    availableAt: readString(row, "available_at"),
    leaseOwner: readNullableString(row, "lease_owner"),
    leaseExpiresAt: readNullableString(row, "lease_expires_at"),
    lastErrorCode: readNullableString(row, "last_error_code"),
    createdAt: readString(row, "created_at"),
    updatedAt: readString(row, "updated_at"),
    completedAt: readNullableString(row, "completed_at"),
  };
}

function validateEnqueueInput(input: EnqueueScanJobInput): void {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.jobId, "jobId");
  assertNonEmpty(input.repositoryId, "repositoryId");
  assertNonEmpty(input.dedupeKey, "dedupeKey");
  assertIntegerAtLeast(input.priority ?? 0, 0, "priority");
  assertIntegerAtLeast(input.maxAttempts ?? 3, 1, "maxAttempts");
  assertTimestamp(input.availableAt, "availableAt");
  assertTimestamp(input.createdAt, "createdAt");
}

export async function enqueueScanJob(
  db: D1DatabaseLike,
  input: EnqueueScanJobInput,
): Promise<EnqueueScanJobResult> {
  validateEnqueueInput(input);
  const priority = input.priority ?? 0;
  const maxAttempts = input.maxAttempts ?? 3;

  const inserted = await bindStatement(
    db,
    `
      INSERT INTO scan_jobs (
        account_id,
        id,
        repository_id,
        reason,
        status,
        priority,
        dedupe_key,
        attempt_count,
        max_attempts,
        available_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT (account_id, dedupe_key) DO NOTHING
      RETURNING ${JOB_COLUMNS}
    `,
    [
      input.accountId,
      input.jobId,
      input.repositoryId,
      input.reason,
      priority,
      input.dedupeKey,
      maxAttempts,
      input.availableAt,
      input.createdAt,
      input.createdAt,
    ],
  ).first<DatabaseRow>();

  if (inserted !== null) {
    return { created: true, job: mapScanJob(inserted) };
  }

  const existing = await bindStatement(
    db,
    `
      SELECT ${JOB_COLUMNS}
      FROM scan_jobs
      WHERE account_id = ? AND dedupe_key = ?
    `,
    [input.accountId, input.dedupeKey],
  ).first<DatabaseRow>();

  if (existing === null) {
    throw new DataInvariantError("Conflicting scan job disappeared before it could be read");
  }

  return { created: false, job: mapScanJob(existing) };
}

export async function listAccountsWithQueuedScanJobs(
  db: D1DatabaseLike,
  limit: number,
): Promise<readonly string[]> {
  assertIntegerBetween(limit, 1, 1_000, "limit");

  const result = await bindStatement(
    db,
    `
      SELECT account_id
      FROM scan_jobs
      WHERE status = 'queued'
        AND attempt_count < max_attempts
      GROUP BY account_id
      ORDER BY MIN(available_at), account_id
      LIMIT ?
    `,
    [limit],
  ).all<DatabaseRow>();

  return result.results.map((row) => readString(row, "account_id"));
}

export async function requeueExpiredScanJobs(
  db: D1DatabaseLike,
  now: string,
  retryAt: string,
): Promise<number> {
  const normalizedNow = normalizeTimestamp(now, "now");
  const normalizedRetryAt = normalizeTimestamp(retryAt, "retryAt");

  const result = await bindStatement(
    db,
    `
      UPDATE scan_jobs
      SET
        status = CASE
          WHEN attempt_count >= max_attempts THEN 'failed'
          ELSE 'queued'
        END,
        available_at = CASE
          WHEN attempt_count >= max_attempts THEN available_at
          ELSE ?
        END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = 'LEASE_EXPIRED',
        completed_at = CASE
          WHEN attempt_count >= max_attempts THEN ?
          ELSE NULL
        END,
        updated_at = ?
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND julianday(lease_expires_at) <= julianday(?)
    `,
    [normalizedRetryAt, normalizedNow, normalizedNow, normalizedNow],
  ).run();

  return changedRows(result);
}

export async function claimScanJob(
  db: D1DatabaseLike,
  input: ClaimScanJobInput,
): Promise<ScanJob | null> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.workerId, "workerId");
  assertTimestamp(input.claimedAt, "claimedAt");
  assertTimestamp(input.leaseExpiresAt, "leaseExpiresAt");
  if (Date.parse(input.leaseExpiresAt) <= Date.parse(input.claimedAt)) {
    throw new RangeError("leaseExpiresAt must be after claimedAt");
  }

  const row = await bindStatement(
    db,
    `
      UPDATE scan_jobs
      SET
        status = 'running',
        attempt_count = attempt_count + 1,
        lease_owner = ?,
        lease_expires_at = ?,
        updated_at = ?
      WHERE account_id = ?
        AND id = (
          SELECT id
          FROM scan_jobs
          WHERE account_id = ?
            AND status = 'queued'
            AND available_at <= ?
            AND attempt_count < max_attempts
          ORDER BY priority DESC, available_at, created_at
          LIMIT 1
        )
      RETURNING ${JOB_COLUMNS}
    `,
    [
      input.workerId,
      input.leaseExpiresAt,
      input.claimedAt,
      input.accountId,
      input.accountId,
      input.claimedAt,
    ],
  ).first<DatabaseRow>();

  return row === null ? null : mapScanJob(row);
}

export async function completeScanJob(
  db: D1DatabaseLike,
  input: CompleteScanJobInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.jobId, "jobId");
  assertNonEmpty(input.workerId, "workerId");
  assertTimestamp(input.completedAt, "completedAt");

  const row = await bindStatement(
    db,
    `
      UPDATE scan_jobs
      SET
        status = 'succeeded',
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL,
        completed_at = ?,
        updated_at = ?
      WHERE account_id = ?
        AND id = ?
        AND status = 'running'
        AND lease_owner = ?
      RETURNING id
    `,
    [input.completedAt, input.completedAt, input.accountId, input.jobId, input.workerId],
  ).first<DatabaseRow>();

  return row !== null;
}

export async function retryScanJob(
  db: D1DatabaseLike,
  input: RetryScanJobInput,
): Promise<ScanJob | null> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.jobId, "jobId");
  assertNonEmpty(input.workerId, "workerId");
  assertNonEmpty(input.errorCode, "errorCode");
  assertTimestamp(input.retryAt, "retryAt");
  assertTimestamp(input.updatedAt, "updatedAt");

  const row = await bindStatement(
    db,
    `
      UPDATE scan_jobs
      SET
        status = CASE
          WHEN attempt_count >= max_attempts THEN 'failed'
          ELSE 'queued'
        END,
        available_at = CASE
          WHEN attempt_count >= max_attempts THEN available_at
          ELSE ?
        END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = ?,
        completed_at = CASE
          WHEN attempt_count >= max_attempts THEN ?
          ELSE NULL
        END,
        updated_at = ?
      WHERE account_id = ?
        AND id = ?
        AND status = 'running'
        AND lease_owner = ?
      RETURNING ${JOB_COLUMNS}
    `,
    [
      input.retryAt,
      input.errorCode,
      input.updatedAt,
      input.updatedAt,
      input.accountId,
      input.jobId,
      input.workerId,
    ],
  ).first<DatabaseRow>();

  return row === null ? null : mapScanJob(row);
}

export async function failScanJob(db: D1DatabaseLike, input: FailScanJobInput): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.jobId, "jobId");
  assertNonEmpty(input.workerId, "workerId");
  assertNonEmpty(input.errorCode, "errorCode");
  assertTimestamp(input.failedAt, "failedAt");

  const row = await bindStatement(
    db,
    `
      UPDATE scan_jobs
      SET
        status = 'failed',
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = ?,
        completed_at = ?,
        updated_at = ?
      WHERE account_id = ?
        AND id = ?
        AND status = 'running'
        AND lease_owner = ?
      RETURNING id
    `,
    [input.errorCode, input.failedAt, input.failedAt, input.accountId, input.jobId, input.workerId],
  ).first<DatabaseRow>();

  return row !== null;
}
