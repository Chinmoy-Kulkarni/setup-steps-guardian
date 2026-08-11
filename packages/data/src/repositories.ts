import {
  type Finding,
  FindingSchema,
  type RepositorySetupStatus,
  RepositorySetupStatusSchema,
  type WorkflowEvidence,
  WorkflowEvidenceSchema,
} from "@setup-fleet/contracts";
import { bindStatement, changedRows, type D1DatabaseLike, DataInvariantError } from "./database.js";
import {
  type DatabaseRow,
  readBoolean,
  readInteger,
  readNullableInteger,
  readNullableString,
  readString,
} from "./rows.js";
import { assertNonEmpty, assertTimestamp, toSqlBoolean } from "./validation.js";

export interface RepositoryRecord {
  readonly accountId: string;
  readonly repositoryId: string;
  readonly installationId: string;
  readonly owner: string;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly defaultBranch: string;
  readonly isArchived: boolean;
  readonly isSelected: boolean;
  readonly scanEnabled: boolean;
  readonly status: RepositorySetupStatus;
  readonly lastScannedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RepositoryDetails {
  readonly repository: RepositoryRecord;
  readonly evidence: WorkflowEvidence | null;
  readonly findings: readonly Finding[];
}

export interface UpsertRepositoryInput {
  readonly accountId: string;
  readonly installationId: string;
  readonly repositoryId: string;
  readonly owner: string;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly defaultBranch: string;
  readonly isArchived: boolean;
  readonly isSelected: boolean;
  readonly observedAt: string;
}

export interface RemoveRepositoryInput {
  readonly accountId: string;
  readonly repositoryId: string;
}

export interface SetRepositorySelectionInput {
  readonly accountId: string;
  readonly repositoryId: string;
  readonly isSelected: boolean;
  readonly updatedAt: string;
}

export interface SetRepositoryScanEnabledInput {
  readonly accountId: string;
  readonly repositoryId: string;
  readonly scanEnabled: boolean;
  readonly updatedAt: string;
}

const REPOSITORY_COLUMNS = `
  account_id,
  id,
  installation_id,
  owner,
  name,
  is_private,
  default_branch,
  is_archived,
  is_selected,
  scan_enabled,
  setup_status,
  last_scanned_at,
  created_at,
  updated_at
`;

const UPSERT_REPOSITORY_SQL = `
  INSERT INTO repositories (
    account_id,
    id,
    installation_id,
    owner,
    name,
    is_private,
    default_branch,
    is_archived,
    is_selected,
    setup_status,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unproven', ?, ?)
  ON CONFLICT (account_id, id) DO UPDATE SET
    installation_id = excluded.installation_id,
    owner = excluded.owner,
    name = excluded.name,
    is_private = excluded.is_private,
    default_branch = excluded.default_branch,
    is_archived = excluded.is_archived,
    is_selected = excluded.is_selected,
    updated_at = excluded.updated_at
`;

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function mapRepository(row: DatabaseRow): RepositoryRecord {
  return {
    accountId: readString(row, "account_id"),
    repositoryId: readString(row, "id"),
    installationId: readString(row, "installation_id"),
    owner: readString(row, "owner"),
    name: readString(row, "name"),
    isPrivate: readBoolean(row, "is_private"),
    defaultBranch: readString(row, "default_branch"),
    isArchived: readBoolean(row, "is_archived"),
    isSelected: readBoolean(row, "is_selected"),
    scanEnabled: readBoolean(row, "scan_enabled"),
    status: RepositorySetupStatusSchema.parse(readString(row, "setup_status")),
    lastScannedAt: readNullableString(row, "last_scanned_at"),
    createdAt: readString(row, "created_at"),
    updatedAt: readString(row, "updated_at"),
  };
}

function mapWorkflowEvidence(row: DatabaseRow): WorkflowEvidence {
  const failedStep = readNullableString(row, "failed_step");
  return WorkflowEvidenceSchema.parse({
    repositoryId: readString(row, "repository_id"),
    commitSha: readString(row, "commit_sha"),
    workflowHash: readString(row, "workflow_hash"),
    policyHash: readString(row, "policy_hash"),
    lockfileHashes: parseJson(readString(row, "lockfile_hashes_json")),
    runnerLabel: readString(row, "runner_label"),
    conclusion: readString(row, "conclusion"),
    durationMs: readInteger(row, "duration_ms"),
    ...(failedStep === null ? {} : { failedStep }),
    runId: readString(row, "run_id"),
    runAttempt: readInteger(row, "run_attempt"),
    completedAt: readString(row, "completed_at"),
  });
}

function mapFinding(row: DatabaseRow): Finding {
  const line = readNullableInteger(row, "line");
  const documentationUrl = readNullableString(row, "documentation_url");
  return FindingSchema.parse({
    code: readString(row, "code"),
    severity: readString(row, "severity"),
    title: readString(row, "title"),
    message: readString(row, "message"),
    path: readString(row, "path"),
    ...(line === null ? {} : { line }),
    evidence: parseJson(readString(row, "evidence_json")),
    remediation: readString(row, "remediation"),
    ...(documentationUrl === null ? {} : { documentationUrl }),
  });
}

export async function upsertRepository(
  db: D1DatabaseLike,
  input: UpsertRepositoryInput,
): Promise<void> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.installationId, "installationId");
  assertNonEmpty(input.repositoryId, "repositoryId");
  assertNonEmpty(input.owner, "owner");
  assertNonEmpty(input.name, "name");
  assertNonEmpty(input.defaultBranch, "defaultBranch");
  assertTimestamp(input.observedAt, "observedAt");

  await bindStatement(db, UPSERT_REPOSITORY_SQL, [
    input.accountId,
    input.repositoryId,
    input.installationId,
    input.owner,
    input.name,
    toSqlBoolean(input.isPrivate),
    input.defaultBranch,
    toSqlBoolean(input.isArchived),
    toSqlBoolean(input.isSelected),
    input.observedAt,
    input.observedAt,
  ]).run();
}

export async function getRepository(
  db: D1DatabaseLike,
  accountId: string,
  repositoryId: string,
): Promise<RepositoryRecord | null> {
  assertNonEmpty(accountId, "accountId");
  assertNonEmpty(repositoryId, "repositoryId");

  const row = await bindStatement(
    db,
    `
      SELECT ${REPOSITORY_COLUMNS}
      FROM repositories
      WHERE account_id = ? AND id = ?
    `,
    [accountId, repositoryId],
  ).first<DatabaseRow>();

  return row === null ? null : mapRepository(row);
}

export async function listSelectedRepositories(
  db: D1DatabaseLike,
  accountId: string,
): Promise<readonly RepositoryRecord[]> {
  assertNonEmpty(accountId, "accountId");

  const result = await bindStatement(
    db,
    `
      SELECT ${REPOSITORY_COLUMNS}
      FROM repositories
      WHERE account_id = ?
        AND is_selected = 1
        AND scan_enabled = 1
        AND is_archived = 0
      ORDER BY owner COLLATE NOCASE, name COLLATE NOCASE
    `,
    [accountId],
  ).all<DatabaseRow>();

  return result.results.map(mapRepository);
}

export async function listAccountRepositories(
  db: D1DatabaseLike,
  accountId: string,
): Promise<readonly RepositoryRecord[]> {
  assertNonEmpty(accountId, "accountId");

  const result = await bindStatement(
    db,
    `
      SELECT ${REPOSITORY_COLUMNS}
      FROM repositories
      WHERE account_id = ?
      ORDER BY is_private, created_at, id
    `,
    [accountId],
  ).all<DatabaseRow>();

  return result.results.map(mapRepository);
}

export async function setRepositorySelection(
  db: D1DatabaseLike,
  input: SetRepositorySelectionInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.repositoryId, "repositoryId");
  assertTimestamp(input.updatedAt, "updatedAt");

  const result = await bindStatement(
    db,
    `
      UPDATE repositories
      SET is_selected = ?, updated_at = ?
      WHERE account_id = ? AND id = ?
    `,
    [toSqlBoolean(input.isSelected), input.updatedAt, input.accountId, input.repositoryId],
  ).run();

  return changedRows(result) > 0;
}

export async function setRepositoryScanEnabled(
  db: D1DatabaseLike,
  input: SetRepositoryScanEnabledInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.repositoryId, "repositoryId");
  assertTimestamp(input.updatedAt, "updatedAt");

  const result = await bindStatement(
    db,
    `
      UPDATE repositories
      SET scan_enabled = ?, updated_at = ?
      WHERE account_id = ? AND id = ?
    `,
    [toSqlBoolean(input.scanEnabled), input.updatedAt, input.accountId, input.repositoryId],
  ).run();

  return changedRows(result) > 0;
}

export async function getRepositoryDetails(
  db: D1DatabaseLike,
  accountId: string,
  repositoryId: string,
): Promise<RepositoryDetails | null> {
  assertNonEmpty(accountId, "accountId");
  assertNonEmpty(repositoryId, "repositoryId");

  const results = await db.batch<DatabaseRow>([
    bindStatement(
      db,
      `
        SELECT ${REPOSITORY_COLUMNS}
        FROM repositories
        WHERE account_id = ? AND id = ?
      `,
      [accountId, repositoryId],
    ),
    bindStatement(
      db,
      `
        SELECT
          repository_id,
          commit_sha,
          workflow_hash,
          policy_hash,
          lockfile_hashes_json,
          runner_label,
          conclusion,
          duration_ms,
          failed_step,
          run_id,
          run_attempt,
          completed_at
        FROM workflow_evidence
        WHERE account_id = ? AND repository_id = ?
      `,
      [accountId, repositoryId],
    ),
    bindStatement(
      db,
      `
        SELECT
          code,
          severity,
          title,
          message,
          path,
          line,
          evidence_json,
          remediation,
          documentation_url
        FROM findings
        WHERE account_id = ? AND repository_id = ?
        ORDER BY ordinal
      `,
      [accountId, repositoryId],
    ),
  ]);

  const repositoryResult = results[0];
  const evidenceResult = results[1];
  const findingsResult = results[2];
  if (
    repositoryResult === undefined ||
    evidenceResult === undefined ||
    findingsResult === undefined
  ) {
    throw new DataInvariantError("Repository detail query returned an incomplete batch");
  }

  const repositoryRow = repositoryResult.results[0];
  if (repositoryRow === undefined) {
    return null;
  }
  const evidenceRow = evidenceResult.results[0];

  return {
    repository: mapRepository(repositoryRow),
    evidence: evidenceRow === undefined ? null : mapWorkflowEvidence(evidenceRow),
    findings: findingsResult.results.map(mapFinding),
  };
}

export async function removeRepository(
  db: D1DatabaseLike,
  input: RemoveRepositoryInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.repositoryId, "repositoryId");

  const result = await bindStatement(
    db,
    `
      DELETE FROM repositories
      WHERE account_id = ? AND id = ?
    `,
    [input.accountId, input.repositoryId],
  ).run();

  return changedRows(result) > 0;
}
