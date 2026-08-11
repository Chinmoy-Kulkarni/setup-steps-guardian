import {
  type FleetSummary,
  FleetSummarySchema,
  RepositorySetupStatusSchema,
} from "@setup-fleet/contracts";
import { bindStatement, type D1DatabaseLike } from "./database.js";
import {
  type DatabaseRow,
  readBoolean,
  readInteger,
  readNullableString,
  readString,
} from "./rows.js";
import { assertNonEmpty } from "./validation.js";

export async function getFleetSummary(
  db: D1DatabaseLike,
  accountId: string,
): Promise<FleetSummary> {
  assertNonEmpty(accountId, "accountId");

  const result = await bindStatement(
    db,
    `
      SELECT
        repositories.id AS repository_id,
        repositories.owner,
        repositories.name,
        repositories.is_private,
        repositories.default_branch,
        repositories.setup_status,
        workflow_evidence.completed_at AS last_evidence_at,
        SUM(CASE WHEN findings.severity = 'error' THEN 1 ELSE 0 END) AS error_count,
        SUM(CASE WHEN findings.severity = 'warning' THEN 1 ELSE 0 END) AS warning_count
      FROM repositories
      LEFT JOIN workflow_evidence
        ON workflow_evidence.account_id = repositories.account_id
        AND workflow_evidence.repository_id = repositories.id
      LEFT JOIN findings
        ON findings.account_id = repositories.account_id
        AND findings.repository_id = repositories.id
      WHERE repositories.account_id = ?
        AND repositories.is_selected = 1
        AND repositories.is_archived = 0
      GROUP BY
        repositories.account_id,
        repositories.id,
        repositories.owner,
        repositories.name,
        repositories.is_private,
        repositories.default_branch,
        repositories.setup_status,
        workflow_evidence.completed_at
      ORDER BY repositories.owner COLLATE NOCASE, repositories.name COLLATE NOCASE
    `,
    [accountId],
  ).all<DatabaseRow>();

  const repositories = result.results.map((row) => ({
    repositoryId: readString(row, "repository_id"),
    owner: readString(row, "owner"),
    name: readString(row, "name"),
    isPrivate: readBoolean(row, "is_private"),
    defaultBranch: readString(row, "default_branch"),
    status: RepositorySetupStatusSchema.parse(readString(row, "setup_status")),
    lastEvidenceAt: readNullableString(row, "last_evidence_at"),
    errorCount: readInteger(row, "error_count"),
    warningCount: readInteger(row, "warning_count"),
  }));
  const passing = repositories.filter((repository) => repository.status === "passing").length;

  return FleetSummarySchema.parse({
    accountId,
    repositories,
    totals: {
      selected: repositories.length,
      passing,
      attention: repositories.length - passing,
    },
  });
}
