import type { D1DatabaseLike, RepositoryRecord } from "@setup-fleet/data";
import type { InstallationWebhookEvent } from "@setup-fleet/github";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@setup-fleet/data", async (importOriginal) => {
  const original = await importOriginal<typeof import("@setup-fleet/data")>();
  return {
    ...original,
    completeWebhookDelivery: vi.fn(),
    enqueueScanJob: vi.fn(),
    failWebhookDelivery: vi.fn(),
    grantAccountAdministrator: vi.fn(),
    getInstallationById: vi.fn(),
    listAccountRepositories: vi.fn(),
    recordWebhookDelivery: vi.fn(),
    removeInstallation: vi.fn(),
    removeRepository: vi.fn(),
    revokeAccountAdministrators: vi.fn(),
    setRepositoryScanEnabled: vi.fn(),
    upsertInstallation: vi.fn(),
    upsertRepository: vi.fn(),
  };
});

vi.mock("../src/repository-entitlements.js", () => ({
  reconcileRepositoryEntitlements: vi.fn(),
}));

import {
  completeWebhookDelivery,
  enqueueScanJob,
  failWebhookDelivery,
  getInstallationById,
  grantAccountAdministrator,
  listAccountRepositories,
  recordWebhookDelivery,
  removeInstallation,
  revokeAccountAdministrators,
  upsertRepository,
} from "@setup-fleet/data";
import {
  type GitHubRepositoryHydrator,
  processGitHubWebhook,
} from "../src/github-webhook-service.js";
import { reconcileRepositoryEntitlements } from "../src/repository-entitlements.js";

const now = new Date("2026-08-10T22:00:00.000Z");
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
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

function installationEvent(): InstallationWebhookEvent {
  return {
    type: "installation",
    action: "created",
    installationId: "200",
    installerUserId: "7",
    account: { id: "42", name: "octo-org", type: "Organization" },
    repositorySelection: "selected",
    repositories: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function hydrator(overrides: Partial<GitHubRepositoryHydrator> = {}): GitHubRepositoryHydrator {
  return {
    listInstallationRepositories: async () => [
      {
        id: "100",
        owner: "octo-org",
        name: "web",
        defaultBranch: "main",
        isPrivate: true,
        isArchived: false,
      },
    ],
    getRepository: async () => ({
      id: "100",
      owner: "octo-org",
      name: "web",
      defaultBranch: "main",
      isPrivate: true,
      isArchived: false,
    }),
    ...overrides,
  };
}

describe("GitHub webhook processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordWebhookDelivery).mockResolvedValue(true);
    vi.mocked(completeWebhookDelivery).mockResolvedValue(true);
    vi.mocked(failWebhookDelivery).mockResolvedValue(true);
    vi.mocked(listAccountRepositories).mockResolvedValue([repository]);
    vi.mocked(enqueueScanJob).mockResolvedValue({
      created: true,
      job: {
        id: "job",
        accountId: "42",
        repositoryId: "100",
        reason: "installation",
        status: "queued",
        priority: 60,
        dedupeKey: "delivery:100",
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: now.toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: null,
      },
    });
    vi.mocked(reconcileRepositoryEntitlements).mockResolvedValue({
      enabled: 1,
      blocked: 0,
    });
  });

  it("hydrates an installation, persists repositories, and enqueues scans", async () => {
    await expect(
      processGitHubWebhook({
        db: {} as D1DatabaseLike,
        eventName: "installation",
        deliveryId: "delivery",
        event: installationEvent(),
        repositoryHydrator: hydrator(),
        now,
        randomUuid: () => "job",
      }),
    ).resolves.toBe("processed");

    expect(upsertRepository).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: "42",
        repositoryId: "100",
        defaultBranch: "main",
      }),
    );
    expect(grantAccountAdministrator).toHaveBeenCalledWith(expect.anything(), {
      accountId: "42",
      githubUserId: "7",
      createdAt: now.toISOString(),
    });
    expect(enqueueScanJob).toHaveBeenCalledOnce();
    expect(completeWebhookDelivery).toHaveBeenCalledOnce();
  });

  it("does not repeat side effects for a processed delivery", async () => {
    vi.mocked(recordWebhookDelivery).mockResolvedValue(false);
    const listInstallationRepositories = vi.fn();

    await expect(
      processGitHubWebhook({
        db: {} as D1DatabaseLike,
        eventName: "installation",
        deliveryId: "delivery",
        event: installationEvent(),
        repositoryHydrator: hydrator({ listInstallationRepositories }),
        now,
      }),
    ).resolves.toBe("duplicate");

    expect(listInstallationRepositories).not.toHaveBeenCalled();
  });

  it("revokes account administrators when an installation is deleted", async () => {
    await processGitHubWebhook({
      db: {} as D1DatabaseLike,
      eventName: "installation",
      deliveryId: "delivery-delete",
      event: {
        ...installationEvent(),
        action: "deleted",
        installerUserId: null,
      },
      repositoryHydrator: hydrator(),
      now,
    });

    expect(revokeAccountAdministrators).toHaveBeenCalledWith(expect.anything(), "42");
    expect(removeInstallation).toHaveBeenCalledWith(expect.anything(), {
      accountId: "42",
      installationId: "200",
    });
  });

  it("rescans every enabled repository after an organization policy push", async () => {
    vi.mocked(getInstallationById).mockResolvedValue({
      accountId: "42",
      installationId: "200",
      repositorySelection: "selected",
      suspendedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    vi.mocked(listAccountRepositories).mockResolvedValue([
      repository,
      { ...repository, repositoryId: "101", name: "api" },
    ]);

    await processGitHubWebhook({
      db: {} as D1DatabaseLike,
      eventName: "push",
      deliveryId: "delivery",
      event: {
        type: "push",
        installationId: "200",
        repository: {
          id: "999",
          owner: "octo-org",
          name: ".github",
          defaultBranch: "main",
          isPrivate: true,
          isArchived: false,
        },
        branch: "main",
        headSha: "a".repeat(40),
        deleted: false,
        relevantPaths: [".github/agent-setup-policy.yml"],
        pushedAt: now.toISOString(),
      },
      repositoryHydrator: hydrator(),
      now,
      randomUuid: () => "job",
    });

    expect(enqueueScanJob).toHaveBeenCalledTimes(2);
  });

  it("records a failed delivery when processing throws", async () => {
    const failure = new Error("GitHub unavailable");

    await expect(
      processGitHubWebhook({
        db: {} as D1DatabaseLike,
        eventName: "installation",
        deliveryId: "delivery",
        event: installationEvent(),
        repositoryHydrator: hydrator({
          listInstallationRepositories: async () => {
            throw failure;
          },
        }),
        now,
      }),
    ).rejects.toBe(failure);

    expect(failWebhookDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "WEBHOOK_PROCESSING_FAILED" }),
    );
  });
});
