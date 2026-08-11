import type {
  AccountPolicy,
  OperationalCleanupResult,
  RepositoryDetails,
  ScanJob,
} from "@setup-fleet/data";
import { describe, expect, it } from "vitest";
import {
  processScanBatch,
  type ScanFailureClassifier,
  type ScanStore,
} from "../src/scan-processor.js";
import type { RepositoryReader } from "../src/scan-repository.js";

const now = new Date("2026-08-10T22:00:00.000Z");
const job: ScanJob = {
  accountId: "42",
  id: "job-1",
  repositoryId: "100",
  reason: "webhook",
  status: "running",
  priority: 1,
  dedupeKey: "push:100:sha",
  attemptCount: 1,
  maxAttempts: 3,
  availableAt: now.toISOString(),
  leaseOwner: "worker",
  leaseExpiresAt: "2026-08-10T22:02:00.000Z",
  lastErrorCode: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  completedAt: null,
};

function repositoryDetails(): RepositoryDetails {
  return {
    repository: {
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
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    evidence: null,
    findings: [],
  };
}

function validReader(): RepositoryReader {
  return {
    async getFileContent(input) {
      if (input.path === ".github/workflows/copilot-setup-steps.yml") {
        return `
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
      }
      if (input.path === "package.json" || input.path === "package-lock.json") {
        return "{}";
      }
      return null;
    },
    async getLatestCompletedSetupRun() {
      return null;
    },
    async getRunDiagnostics() {
      return { runnerLabel: "ubuntu-latest" };
    },
  };
}

function createStore(overrides: Partial<ScanStore> = {}): {
  store: ScanStore;
  saved: Parameters<ScanStore["saveResult"]>[0][];
} {
  const saved: Parameters<ScanStore["saveResult"]>[0][] = [];
  const cleanup: OperationalCleanupResult = {
    scanJobsDeleted: 0,
    webhookDeliveriesDeleted: 0,
  };
  const store: ScanStore = {
    requeueExpired: async () => 0,
    listQueuedAccounts: async () => ["42"],
    claim: async () => job,
    getDetails: async () => repositoryDetails(),
    getPolicy: async (): Promise<AccountPolicy | null> => null,
    savePolicy: async () => undefined,
    saveResult: async (input) => {
      saved.push(input);
    },
    complete: async () => true,
    fail: async () => true,
    retry: async () => ({ ...job, status: "queued" }),
    cleanup: async () => cleanup,
    ...overrides,
  };
  return { store, saved };
}

const failureClassifier: ScanFailureClassifier = {
  classify: () => ({ code: "GITHUB_UNAVAILABLE", retryable: true, retryAfterMs: 1_000 }),
};

describe("scheduled scan processing", () => {
  it("scans and persists a claimed repository", async () => {
    const state = createStore();
    const result = await processScanBatch({
      store: state.store,
      readerFactory: {
        create: async () => validReader(),
      },
      failureClassifier,
      now,
      workerId: "worker",
    });

    expect(result.completed).toBe(1);
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({
      accountId: "42",
      repositoryId: "100",
      status: "unproven",
    });
  });

  it("retries classified failures without swallowing them as success", async () => {
    const state = createStore();
    state.store.getDetails = async () => {
      throw new Error("GitHub failed");
    };

    const result = await processScanBatch({
      store: state.store,
      readerFactory: {
        create: async () => validReader(),
      },
      failureClassifier,
      now,
      workerId: "worker",
    });

    expect(result.retrying).toBe(1);
    expect(result.completed).toBe(0);
  });

  it("skips jobs whose repository was removed", async () => {
    const state = createStore({
      getDetails: async () => null,
    });

    const result = await processScanBatch({
      store: state.store,
      readerFactory: {
        create: async () => validReader(),
      },
      failureClassifier,
      now,
      workerId: "worker",
    });

    expect(result.skipped).toBe(1);
  });

  it("rejects invalid batch limits", async () => {
    const state = createStore();

    await expect(
      processScanBatch({
        store: state.store,
        readerFactory: {
          create: async () => validReader(),
        },
        failureClassifier,
        now,
        maxConcurrency: 0,
      }),
    ).rejects.toThrow("maxConcurrency");
  });

  it("fails non-retryable errors without requeueing", async () => {
    let failed = false;
    const state = createStore({
      getDetails: async () => {
        throw new Error("Authorization revoked");
      },
      fail: async () => {
        failed = true;
        return true;
      },
    });

    const result = await processScanBatch({
      store: state.store,
      readerFactory: {
        create: async () => validReader(),
      },
      failureClassifier: {
        classify: () => ({ code: "GITHUB_AUTHORIZATION", retryable: false }),
      },
      now,
      workerId: "worker",
    });

    expect(result.failed).toBe(1);
    expect(failed).toBe(true);
  });
});
