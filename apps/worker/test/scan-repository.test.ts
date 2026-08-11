import type { RepositoryRecord } from "@setup-fleet/data";
import { DEFAULT_POLICY, sha256, stableStringify } from "@setup-fleet/policy-engine";
import { describe, expect, it } from "vitest";
import {
  type RepositoryReader,
  type SetupWorkflowRun,
  scanRepository,
} from "../src/scan-repository.js";

const workflow = `
on:
  workflow_dispatch:
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/setup-node@1234567890123456789012345678901234567890
      - run: npm ci
`;

const repository: RepositoryRecord = {
  accountId: "42",
  repositoryId: "100",
  installationId: "200",
  owner: "octo-org",
  name: "web",
  isPrivate: true,
  defaultBranch: "main",
  isArchived: false,
  isSelected: true,
  scanEnabled: true,
  status: "unproven",
  lastScannedAt: null,
  createdAt: "2026-08-10T22:00:00.000Z",
  updatedAt: "2026-08-10T22:00:00.000Z",
};

function createReader(options: {
  currentWorkflow?: string | null;
  run?: SetupWorkflowRun | null;
  runWorkflow?: string;
  conclusion?: "success" | "failure";
}): RepositoryReader {
  const currentWorkflow =
    options.currentWorkflow === undefined ? workflow : options.currentWorkflow;
  const run = options.run ?? null;

  return {
    async getFileContent(input) {
      if (input.path === ".github/workflows/copilot-setup-steps.yml") {
        return input.ref === "main" ? currentWorkflow : (options.runWorkflow ?? workflow);
      }
      if (input.path === "package.json" || input.path === "package-lock.json") {
        return "{}";
      }
      return null;
    },
    async getLatestCompletedSetupRun() {
      return run;
    },
    async getRunDiagnostics() {
      return {
        runnerLabel: "ubuntu-latest",
        ...(options.conclusion === "failure" ? { failedStep: "Install dependencies" } : {}),
      };
    },
  };
}

describe("repository scanning", () => {
  it("reports a missing setup workflow without run evidence", async () => {
    const result = await scanRepository({
      repository,
      accountPolicy: null,
      existingEvidence: null,
      reader: createReader({ currentWorkflow: null }),
    });

    expect(result.status).toBe("missing");
    expect(result.validation.findings[0]?.code).toBe("WORKFLOW_MISSING");
  });

  it("creates passing evidence for a completed run", async () => {
    const run: SetupWorkflowRun = {
      runId: "300",
      runAttempt: 1,
      headSha: "a".repeat(40),
      conclusion: "success",
      startedAt: "2026-08-10T22:00:00.000Z",
      completedAt: "2026-08-10T22:01:00.000Z",
    };
    const result = await scanRepository({
      repository,
      accountPolicy: null,
      existingEvidence: null,
      reader: createReader({ run }),
    });

    expect(result.status).toBe("passing");
    expect(result.evidence).toMatchObject({
      runId: "300",
      durationMs: 60_000,
      runnerLabel: "ubuntu-latest",
    });
  });

  it("preserves evidence hashes for the same run so policy changes become stale", async () => {
    const policyHash = await sha256(stableStringify(DEFAULT_POLICY));
    const run: SetupWorkflowRun = {
      runId: "300",
      runAttempt: 1,
      headSha: "a".repeat(40),
      conclusion: "success",
      startedAt: "2026-08-10T22:00:00.000Z",
      completedAt: "2026-08-10T22:01:00.000Z",
    };
    const existingEvidence = {
      repositoryId: "100",
      commitSha: run.headSha,
      workflowHash: await sha256(workflow),
      policyHash,
      lockfileHashes: {
        "package-lock.json": await sha256("{}"),
      },
      runnerLabel: "ubuntu-latest",
      conclusion: "success" as const,
      durationMs: 60_000,
      runId: run.runId,
      runAttempt: run.runAttempt,
      completedAt: run.completedAt,
    };
    const changedPolicy = {
      accountId: "42",
      schemaVersion: 1,
      policyHash: await sha256(
        stableStringify({
          ...DEFAULT_POLICY,
          secretUsage: "error",
        }),
      ),
      allowedRunners: DEFAULT_POLICY.allowedRunners,
      maxTimeoutMinutes: DEFAULT_POLICY.maxTimeoutMinutes,
      requireTimeout: DEFAULT_POLICY.requireTimeout,
      requireExplicitPermissions: DEFAULT_POLICY.requireExplicitPermissions,
      requireWorkflowDispatch: DEFAULT_POLICY.requireWorkflowDispatch,
      actionPinning: DEFAULT_POLICY.actionPinning,
      secretUsage: "error" as const,
      unsupportedJobKeys: DEFAULT_POLICY.unsupportedJobKeys,
      createdAt: "2026-08-10T22:00:00.000Z",
      updatedAt: "2026-08-10T22:02:00.000Z",
    };

    const result = await scanRepository({
      repository,
      accountPolicy: changedPolicy,
      existingEvidence,
      reader: createReader({ run }),
    });

    expect(result.status).toBe("stale");
    expect(result.evidence?.policyHash).toBe(policyHash);
  });

  it("records failing run diagnostics", async () => {
    const result = await scanRepository({
      repository,
      accountPolicy: null,
      existingEvidence: null,
      reader: createReader({
        conclusion: "failure",
        run: {
          runId: "301",
          runAttempt: 1,
          headSha: "b".repeat(40),
          conclusion: "failure",
          startedAt: "2026-08-10T22:00:00.000Z",
          completedAt: "2026-08-10T22:00:30.000Z",
        },
      }),
    });

    expect(result.status).toBe("failing");
    expect(result.evidence?.failedStep).toBe("Install dependencies");
  });
});
