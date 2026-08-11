import {
  type Finding,
  FindingSchema,
  type RepositorySetupStatus,
  RepositorySetupStatusSchema,
  type WorkflowConclusion,
  WorkflowEvidenceSchema,
} from "@setup-fleet/contracts";
import {
  bindStatement,
  changedRows,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  DataInvariantError,
} from "./database.js";
import { assertNonEmpty, assertTimestamp } from "./validation.js";

export interface WorkflowEvidenceInput {
  readonly commitSha: string;
  readonly workflowHash: string;
  readonly policyHash: string;
  readonly lockfileHashes: Readonly<Record<string, string>>;
  readonly runnerLabel: string;
  readonly conclusion: WorkflowConclusion;
  readonly durationMs: number;
  readonly failedStep?: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly completedAt: string;
}

export interface ReplaceEvidenceAndFindingsInput {
  readonly accountId: string;
  readonly repositoryId: string;
  readonly status: RepositorySetupStatus;
  readonly evidence: WorkflowEvidenceInput | null;
  readonly findings: readonly Finding[];
  readonly scannedAt: string;
}

function sortedJson(record: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))),
  );
}

export async function replaceEvidenceAndFindings(
  db: D1DatabaseLike,
  input: ReplaceEvidenceAndFindingsInput,
): Promise<void> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.repositoryId, "repositoryId");
  assertTimestamp(input.scannedAt, "scannedAt");
  const status = RepositorySetupStatusSchema.parse(input.status);
  const findings = FindingSchema.array().parse(input.findings);
  const evidence =
    input.evidence === null
      ? null
      : WorkflowEvidenceSchema.parse({
          repositoryId: input.repositoryId,
          commitSha: input.evidence.commitSha,
          workflowHash: input.evidence.workflowHash,
          policyHash: input.evidence.policyHash,
          lockfileHashes: input.evidence.lockfileHashes,
          runnerLabel: input.evidence.runnerLabel,
          conclusion: input.evidence.conclusion,
          durationMs: input.evidence.durationMs,
          ...(input.evidence.failedStep === undefined
            ? {}
            : { failedStep: input.evidence.failedStep }),
          runId: input.evidence.runId,
          runAttempt: input.evidence.runAttempt,
          completedAt: input.evidence.completedAt,
        });

  const statements: D1PreparedStatementLike[] = [
    bindStatement(
      db,
      `
        DELETE FROM findings
        WHERE account_id = ? AND repository_id = ?
      `,
      [input.accountId, input.repositoryId],
    ),
    bindStatement(
      db,
      `
        DELETE FROM workflow_evidence
        WHERE account_id = ? AND repository_id = ?
      `,
      [input.accountId, input.repositoryId],
    ),
  ];

  if (evidence !== null) {
    statements.push(
      bindStatement(
        db,
        `
          INSERT INTO workflow_evidence (
            account_id,
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
            completed_at,
            recorded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.accountId,
          input.repositoryId,
          evidence.commitSha,
          evidence.workflowHash,
          evidence.policyHash,
          sortedJson(evidence.lockfileHashes),
          evidence.runnerLabel,
          evidence.conclusion,
          evidence.durationMs,
          evidence.failedStep ?? null,
          evidence.runId,
          evidence.runAttempt,
          evidence.completedAt,
          input.scannedAt,
        ],
      ),
    );
  }

  for (const [ordinal, finding] of findings.entries()) {
    statements.push(
      bindStatement(
        db,
        `
          INSERT INTO findings (
            account_id,
            repository_id,
            ordinal,
            code,
            severity,
            title,
            message,
            path,
            line,
            evidence_json,
            remediation,
            documentation_url,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.accountId,
          input.repositoryId,
          ordinal,
          finding.code,
          finding.severity,
          finding.title,
          finding.message,
          finding.path,
          finding.line ?? null,
          sortedJson(finding.evidence),
          finding.remediation,
          finding.documentationUrl ?? null,
          input.scannedAt,
        ],
      ),
    );
  }

  statements.push(
    bindStatement(
      db,
      `
        UPDATE repositories
        SET
          setup_status = ?,
          last_scanned_at = ?,
          updated_at = ?
        WHERE account_id = ? AND id = ?
      `,
      [status, input.scannedAt, input.scannedAt, input.accountId, input.repositoryId],
    ),
  );

  const results = await db.batch(statements);
  const repositoryUpdate = results.at(-1);
  if (repositoryUpdate === undefined || changedRows(repositoryUpdate) !== 1) {
    throw new DataInvariantError("Cannot replace scan results for an unknown repository");
  }
}
