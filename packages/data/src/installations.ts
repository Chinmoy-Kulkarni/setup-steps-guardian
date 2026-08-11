import { bindStatement, changedRows, type D1DatabaseLike } from "./database.js";
import { type DatabaseRow, readEnum, readNullableString, readString } from "./rows.js";
import { assertNonEmpty, assertTimestamp } from "./validation.js";

export type GitHubAccountType = "Organization" | "User";
export type RepositorySelection = "all" | "selected";
const REPOSITORY_SELECTIONS = ["all", "selected"] as const;

export interface InstallationRecord {
  readonly accountId: string;
  readonly installationId: string;
  readonly repositorySelection: RepositorySelection;
  readonly suspendedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertInstallationInput {
  readonly accountId: string;
  readonly accountLogin: string;
  readonly accountType: GitHubAccountType;
  readonly installationId: string;
  readonly repositorySelection: RepositorySelection;
  readonly suspendedAt: string | null;
  readonly observedAt: string;
}

export interface RemoveInstallationInput {
  readonly accountId: string;
  readonly installationId: string;
}

const UPSERT_ACCOUNT_SQL = `
  INSERT INTO github_accounts (
    id,
    login,
    account_type,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    login = excluded.login,
    account_type = excluded.account_type,
    updated_at = excluded.updated_at
`;

const UPSERT_INSTALLATION_SQL = `
  INSERT INTO installations (
    account_id,
    id,
    repository_selection,
    suspended_at,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (account_id, id) DO UPDATE SET
    repository_selection = excluded.repository_selection,
    suspended_at = excluded.suspended_at,
    updated_at = excluded.updated_at
`;

function mapInstallation(row: DatabaseRow): InstallationRecord {
  return {
    accountId: readString(row, "account_id"),
    installationId: readString(row, "id"),
    repositorySelection: readEnum(row, "repository_selection", REPOSITORY_SELECTIONS),
    suspendedAt: readNullableString(row, "suspended_at"),
    createdAt: readString(row, "created_at"),
    updatedAt: readString(row, "updated_at"),
  };
}

export async function upsertInstallation(
  db: D1DatabaseLike,
  input: UpsertInstallationInput,
): Promise<void> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.accountLogin, "accountLogin");
  assertNonEmpty(input.installationId, "installationId");
  assertTimestamp(input.observedAt, "observedAt");
  if (input.suspendedAt !== null) {
    assertTimestamp(input.suspendedAt, "suspendedAt");
  }

  await db.batch([
    bindStatement(db, UPSERT_ACCOUNT_SQL, [
      input.accountId,
      input.accountLogin,
      input.accountType,
      input.observedAt,
      input.observedAt,
    ]),
    bindStatement(db, UPSERT_INSTALLATION_SQL, [
      input.accountId,
      input.installationId,
      input.repositorySelection,
      input.suspendedAt,
      input.observedAt,
      input.observedAt,
    ]),
  ]);
}

export async function listInstallations(
  db: D1DatabaseLike,
  accountId: string,
): Promise<readonly InstallationRecord[]> {
  assertNonEmpty(accountId, "accountId");

  const result = await bindStatement(
    db,
    `
      SELECT
        account_id,
        id,
        repository_selection,
        suspended_at,
        created_at,
        updated_at
      FROM installations
      WHERE account_id = ?
      ORDER BY updated_at DESC, id
    `,
    [accountId],
  ).all<DatabaseRow>();

  return result.results.map(mapInstallation);
}

export async function getInstallationById(
  db: D1DatabaseLike,
  installationId: string,
): Promise<InstallationRecord | null> {
  assertNonEmpty(installationId, "installationId");

  const row = await bindStatement(
    db,
    `
      SELECT
        account_id,
        id,
        repository_selection,
        suspended_at,
        created_at,
        updated_at
      FROM installations
      WHERE id = ?
    `,
    [installationId],
  ).first<DatabaseRow>();

  return row === null ? null : mapInstallation(row);
}

export async function removeInstallation(
  db: D1DatabaseLike,
  input: RemoveInstallationInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.installationId, "installationId");

  const result = await bindStatement(
    db,
    `
      DELETE FROM installations
      WHERE account_id = ? AND id = ?
    `,
    [input.accountId, input.installationId],
  ).run();

  return changedRows(result) > 0;
}
