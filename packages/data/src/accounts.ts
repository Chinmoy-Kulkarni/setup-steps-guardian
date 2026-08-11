import { bindStatement, changedRows, type D1DatabaseLike } from "./database.js";
import { type DatabaseRow, readEnum, readString } from "./rows.js";
import { assertNonEmpty } from "./validation.js";

const ACCOUNT_TYPES = ["Organization", "User"] as const;

export interface GitHubAccountRecord {
  readonly id: string;
  readonly login: string;
  readonly accountType: (typeof ACCOUNT_TYPES)[number];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export async function getGitHubAccount(
  db: D1DatabaseLike,
  accountId: string,
): Promise<GitHubAccountRecord | null> {
  assertNonEmpty(accountId, "accountId");

  const row = await bindStatement(
    db,
    `
      SELECT id, login, account_type, created_at, updated_at
      FROM github_accounts
      WHERE id = ?
    `,
    [accountId],
  ).first<DatabaseRow>();

  return row === null
    ? null
    : {
        id: readString(row, "id"),
        login: readString(row, "login"),
        accountType: readEnum(row, "account_type", ACCOUNT_TYPES),
        createdAt: readString(row, "created_at"),
        updatedAt: readString(row, "updated_at"),
      };
}

export async function deleteAccount(db: D1DatabaseLike, accountId: string): Promise<boolean> {
  assertNonEmpty(accountId, "accountId");

  const result = await bindStatement(
    db,
    `
      DELETE FROM github_accounts
      WHERE id = ?
    `,
    [accountId],
  ).run();

  return changedRows(result) > 0;
}
