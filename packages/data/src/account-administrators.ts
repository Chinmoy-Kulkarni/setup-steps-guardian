import { bindStatement, type D1DatabaseLike } from "./database.js";
import { type DatabaseRow, readString } from "./rows.js";
import { assertNonEmpty, assertTimestamp } from "./validation.js";

export async function grantAccountAdministrator(
  db: D1DatabaseLike,
  input: {
    readonly accountId: string;
    readonly githubUserId: string;
    readonly createdAt: string;
  },
): Promise<void> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.githubUserId, "githubUserId");
  assertTimestamp(input.createdAt, "createdAt");

  await bindStatement(
    db,
    `
      INSERT INTO account_administrators (
        account_id,
        github_user_id,
        created_at
      )
      VALUES (?, ?, ?)
      ON CONFLICT (account_id, github_user_id) DO NOTHING
    `,
    [input.accountId, input.githubUserId, input.createdAt],
  ).run();
}

export async function revokeAccountAdministrators(
  db: D1DatabaseLike,
  accountId: string,
): Promise<void> {
  assertNonEmpty(accountId, "accountId");
  await bindStatement(
    db,
    `
      DELETE FROM account_administrators
      WHERE account_id = ?
    `,
    [accountId],
  ).run();
}

export async function isAccountAdministrator(
  db: D1DatabaseLike,
  accountId: string,
  githubUserId: string,
): Promise<boolean> {
  assertNonEmpty(accountId, "accountId");
  assertNonEmpty(githubUserId, "githubUserId");

  const row = await bindStatement(
    db,
    `
      SELECT 1 AS authorized
      FROM github_accounts
      WHERE id = ?
        AND (
          (account_type = 'User' AND id = ?)
          OR EXISTS (
            SELECT 1
            FROM account_administrators
            WHERE account_id = github_accounts.id
              AND github_user_id = ?
          )
        )
    `,
    [accountId, githubUserId, githubUserId],
  ).first<DatabaseRow>();

  return row !== null;
}

export async function listAdministeredAccountIds(
  db: D1DatabaseLike,
  githubUserId: string,
): Promise<readonly string[]> {
  assertNonEmpty(githubUserId, "githubUserId");

  const result = await bindStatement(
    db,
    `
      SELECT id AS account_id
      FROM github_accounts
      WHERE (account_type = 'User' AND id = ?)
        OR EXISTS (
          SELECT 1
          FROM account_administrators
          WHERE account_id = github_accounts.id
            AND github_user_id = ?
        )
      ORDER BY id
    `,
    [githubUserId, githubUserId],
  ).all<DatabaseRow>();

  return result.results.map((row) => readString(row, "account_id"));
}
