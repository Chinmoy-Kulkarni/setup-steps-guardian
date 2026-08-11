import { describe, expect, it } from "vitest";
import { replaceEvidenceAndFindings } from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

const timestamp = "2026-08-10T22:00:00.000Z";

describe("scan result replacement", () => {
  it("orders evidence and finding replacement in one atomic batch", async () => {
    const db = new RecordingD1Database();

    await replaceEvidenceAndFindings(db, {
      accountId: "account-1",
      repositoryId: "repository-1",
      status: "failing",
      evidence: {
        commitSha: "a".repeat(40),
        workflowHash: "b".repeat(64),
        policyHash: "c".repeat(64),
        lockfileHashes: {
          "pnpm-lock.yaml": "d".repeat(64),
        },
        runnerLabel: "ubuntu-latest",
        conclusion: "failure",
        durationMs: 1_500,
        failedStep: "Install dependencies",
        runId: "run-1",
        runAttempt: 1,
        completedAt: timestamp,
      },
      findings: [
        {
          code: "INSTALL_COMMAND_MISMATCH",
          severity: "error",
          title: "Install command does not match",
          message: "Use the lockfile-specific frozen install command.",
          path: ".github/workflows/copilot-setup-steps.yml",
          evidence: { packageManager: "pnpm" },
          remediation: "Use pnpm install --frozen-lockfile.",
        },
      ],
      scannedAt: timestamp,
    });

    expect(db.batches).toHaveLength(1);
    const statements = db.batches[0] ?? [];
    expect(statements).toHaveLength(5);
    expect(normalizeSql(statements[0]?.sql ?? "")).toContain("DELETE FROM findings");
    expect(normalizeSql(statements[1]?.sql ?? "")).toContain("DELETE FROM workflow_evidence");
    expect(normalizeSql(statements[2]?.sql ?? "")).toContain("INSERT INTO workflow_evidence");
    expect(normalizeSql(statements[3]?.sql ?? "")).toContain("INSERT INTO findings");
    expect(normalizeSql(statements[4]?.sql ?? "")).toContain("UPDATE repositories");

    for (const statement of statements) {
      expect(statement.bindings).toContain("account-1");
      expect(statement.bindings).toContain("repository-1");
      expect(statement.sql).not.toContain("Install dependencies");
    }
  });
});
