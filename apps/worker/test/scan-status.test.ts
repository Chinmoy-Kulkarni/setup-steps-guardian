import type { ValidationResult, WorkflowEvidence } from "@setup-fleet/contracts";
import { describe, expect, it } from "vitest";
import { deriveRepositoryStatus } from "../src/scan-status.js";

const valid: ValidationResult = {
  schemaVersion: 1,
  status: "valid",
  workflowPath: ".github/workflows/copilot-setup-steps.yml",
  workflowHash: "a".repeat(64),
  policyHash: "b".repeat(64),
  findings: [],
  patches: [],
};

const evidence: WorkflowEvidence = {
  repositoryId: "1",
  commitSha: "c".repeat(40),
  workflowHash: "a".repeat(64),
  policyHash: "b".repeat(64),
  lockfileHashes: {
    "pnpm-lock.yaml": "d".repeat(64),
  },
  runnerLabel: "ubuntu-latest",
  conclusion: "success",
  durationMs: 1_000,
  runId: "10",
  runAttempt: 1,
  completedAt: "2026-08-10T22:00:00.000Z",
};

describe("repository setup status", () => {
  it("prioritizes missing and invalid configuration", () => {
    expect(
      deriveRepositoryStatus({
        validation: {
          ...valid,
          status: "invalid",
          findings: [
            {
              code: "WORKFLOW_MISSING",
              severity: "error",
              title: "Missing",
              message: "Missing",
              path: ".github/workflows/copilot-setup-steps.yml",
              evidence: {},
              remediation: "Create it",
            },
          ],
        },
        evidence,
        lockfileHashes: evidence.lockfileHashes,
      }),
    ).toBe("missing");

    expect(
      deriveRepositoryStatus({
        validation: { ...valid, status: "invalid" },
        evidence,
        lockfileHashes: evidence.lockfileHashes,
      }),
    ).toBe("invalid");
  });

  it("reports drift before run evidence", () => {
    expect(
      deriveRepositoryStatus({
        validation: {
          ...valid,
          findings: [
            {
              code: "ACTION_REF_MUTABLE",
              severity: "warning",
              title: "Mutable",
              message: "Mutable",
              path: ".github/workflows/copilot-setup-steps.yml",
              evidence: {},
              remediation: "Pin it",
            },
          ],
        },
        evidence: null,
        lockfileHashes: {},
      }),
    ).toBe("drifting");
  });

  it("distinguishes unproven, stale, passing, and failing evidence", () => {
    expect(
      deriveRepositoryStatus({
        validation: valid,
        evidence: null,
        lockfileHashes: evidence.lockfileHashes,
      }),
    ).toBe("unproven");

    expect(
      deriveRepositoryStatus({
        validation: valid,
        evidence,
        lockfileHashes: {
          "pnpm-lock.yaml": "e".repeat(64),
        },
      }),
    ).toBe("stale");

    expect(
      deriveRepositoryStatus({
        validation: valid,
        evidence,
        lockfileHashes: evidence.lockfileHashes,
      }),
    ).toBe("passing");

    expect(
      deriveRepositoryStatus({
        validation: valid,
        evidence: { ...evidence, conclusion: "failure" },
        lockfileHashes: evidence.lockfileHashes,
      }),
    ).toBe("failing");
  });
});
