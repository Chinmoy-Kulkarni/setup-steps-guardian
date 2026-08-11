import type { AccountPolicy } from "@setup-fleet/data";
import { DEFAULT_POLICY, sha256, stableStringify } from "@setup-fleet/policy-engine";
import { describe, expect, it } from "vitest";
import { loadAccountPolicy } from "../src/policy-loader.js";
import type { RepositoryReader } from "../src/scan-repository.js";

function reader(content: string | null): RepositoryReader {
  return {
    async getFileContent(input) {
      if (input.repository === ".github" && input.path === ".github/agent-setup-policy.yml") {
        return content;
      }
      return null;
    },
    async getLatestCompletedSetupRun() {
      return null;
    },
    async getRunDiagnostics() {
      return { runnerLabel: "unreported" };
    },
  };
}

describe("version-controlled account policy", () => {
  it("loads and normalizes policy from the selected .github repository", async () => {
    const loaded = await loadAccountPolicy({
      reader: reader(`
schemaVersion: 1
allowedRunners:
  - ubuntu-latest
maxTimeoutMinutes: 30
requireTimeout: true
requireExplicitPermissions: true
requireWorkflowDispatch: true
actionPinning: error
secretUsage: error
unsupportedJobKeys: error
`),
      owner: "octo-org",
      persisted: null,
    });

    expect(loaded).toMatchObject({
      source: "versioned",
      policy: {
        maxTimeoutMinutes: 30,
      },
    });
  });

  it("returns invalid versioned content for deterministic policy findings", async () => {
    const loaded = await loadAccountPolicy({
      reader: reader("unknown: true"),
      owner: "octo-org",
      persisted: null,
    });

    expect(loaded.source).toBe("versioned");
    expect(loaded.policy).toBeNull();
  });

  it("falls back to a verified persisted policy and then the default", async () => {
    const policyHash = await sha256(stableStringify(DEFAULT_POLICY));
    const persisted: AccountPolicy = {
      accountId: "42",
      schemaVersion: 1,
      policyHash,
      allowedRunners: DEFAULT_POLICY.allowedRunners,
      maxTimeoutMinutes: DEFAULT_POLICY.maxTimeoutMinutes,
      requireTimeout: DEFAULT_POLICY.requireTimeout,
      requireExplicitPermissions: DEFAULT_POLICY.requireExplicitPermissions,
      requireWorkflowDispatch: DEFAULT_POLICY.requireWorkflowDispatch,
      actionPinning: DEFAULT_POLICY.actionPinning,
      secretUsage: DEFAULT_POLICY.secretUsage,
      unsupportedJobKeys: DEFAULT_POLICY.unsupportedJobKeys,
      createdAt: "2026-08-10T22:00:00.000Z",
      updatedAt: "2026-08-10T22:00:00.000Z",
    };

    await expect(
      loadAccountPolicy({
        reader: reader(null),
        owner: "octo-org",
        persisted,
      }),
    ).resolves.toMatchObject({
      source: "persisted",
      policyHash,
    });

    await expect(
      loadAccountPolicy({
        reader: reader(null),
        owner: "octo-org",
        persisted: null,
      }),
    ).resolves.toMatchObject({
      source: "default",
      policyHash,
    });
  });
});
