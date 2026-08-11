import { describe, expect, it } from "vitest";
import {
  CheckoutRequestSchema,
  FindingSchema,
  FleetSummarySchema,
  RepositoryDetailSchema,
  SessionResponseSchema,
  ValidationResultSchema,
  WorkflowEvidenceSchema,
} from "../src/index.js";

describe("shared contracts", () => {
  it("accepts a deterministic validation result", () => {
    const result = ValidationResultSchema.parse({
      schemaVersion: 1,
      status: "invalid",
      workflowPath: ".github/workflows/copilot-setup-steps.yml",
      policyHash: "a".repeat(64),
      findings: [
        {
          code: "SETUP_JOB_MISSING",
          severity: "error",
          title: "Required setup job is missing",
          message: "The workflow must define a copilot-setup-steps job.",
          path: ".github/workflows/copilot-setup-steps.yml",
          evidence: {},
          remediation: "Add the required job.",
        },
      ],
      patches: [],
    });

    expect(result.findings[0]?.code).toBe("SETUP_JOB_MISSING");
  });

  it("rejects unstable finding codes", () => {
    expect(() =>
      FindingSchema.parse({
        code: "setup-job-missing",
        severity: "error",
        title: "Invalid code",
        message: "Codes must be stable constants.",
        path: "workflow.yml",
        evidence: {},
        remediation: "Use a stable code.",
      }),
    ).toThrow();
  });

  it("validates workflow evidence hashes and timestamps", () => {
    const evidence = WorkflowEvidenceSchema.parse({
      repositoryId: "123",
      commitSha: "b".repeat(40),
      workflowHash: "c".repeat(64),
      policyHash: "d".repeat(64),
      lockfileHashes: {
        "pnpm-lock.yaml": "e".repeat(64),
      },
      runnerLabel: "ubuntu-latest",
      conclusion: "success",
      durationMs: 1_500,
      runId: "456",
      runAttempt: 1,
      completedAt: "2026-08-10T22:00:00.000Z",
    });

    expect(evidence.conclusion).toBe("success");
  });

  it("validates a tenant-scoped fleet response", () => {
    const summary = FleetSummarySchema.parse({
      accountId: "42",
      repositories: [
        {
          repositoryId: "100",
          owner: "example",
          name: "web",
          isPrivate: true,
          defaultBranch: "main",
          status: "stale",
          lastEvidenceAt: null,
          errorCount: 1,
          warningCount: 0,
        },
      ],
      totals: {
        selected: 1,
        passing: 0,
        attention: 1,
      },
    });

    expect(summary.totals.attention).toBe(1);
  });

  it("validates authenticated session and repository detail responses", () => {
    expect(
      SessionResponseSchema.parse({
        user: {
          id: "1",
          login: "octocat",
          avatarUrl: "https://avatars.githubusercontent.com/u/1",
        },
        accounts: [
          {
            accountId: "42",
            login: "octo-org",
            accountType: "Organization",
            canManage: true,
          },
        ],
        csrfToken: "1234567890123456",
      }).accounts,
    ).toHaveLength(1);

    expect(
      RepositoryDetailSchema.parse({
        repository: {
          repositoryId: "100",
          owner: "octo-org",
          name: "web",
          isPrivate: true,
          defaultBranch: "main",
          status: "unproven",
          lastEvidenceAt: null,
          errorCount: 0,
          warningCount: 0,
        },
        findings: [],
        evidence: null,
      }).repository.status,
    ).toBe("unproven");
  });

  it("validates checkout requests", () => {
    expect(CheckoutRequestSchema.parse({ accountId: "42", plan: "team" })).toEqual({
      accountId: "42",
      plan: "team",
    });
  });
});
