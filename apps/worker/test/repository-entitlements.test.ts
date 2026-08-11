import type { D1DatabaseLike } from "@setup-fleet/data";
import { describe, expect, it, vi } from "vitest";

vi.mock("@setup-fleet/data", async (importOriginal) => {
  const original = await importOriginal<typeof import("@setup-fleet/data")>();
  return {
    ...original,
    getSubscriptionEntitlement: vi.fn(),
    listAccountRepositories: vi.fn(),
    setRepositoryScanEnabled: vi.fn(),
  };
});

import {
  getSubscriptionEntitlement,
  listAccountRepositories,
  setRepositoryScanEnabled,
} from "@setup-fleet/data";
import { reconcileRepositoryEntitlements } from "../src/repository-entitlements.js";

const repository = {
  accountId: "42",
  installationId: "200",
  owner: "octo-org",
  defaultBranch: "main",
  isArchived: false,
  isSelected: true,
  status: "unproven" as const,
  lastScannedAt: null,
  createdAt: "2026-08-10T22:00:00.000Z",
  updatedAt: "2026-08-10T22:00:00.000Z",
};

describe("repository entitlement reconciliation", () => {
  it("keeps public repositories and only the five oldest private repositories on free", async () => {
    vi.mocked(getSubscriptionEntitlement).mockResolvedValue(null);
    vi.mocked(listAccountRepositories).mockResolvedValue([
      {
        ...repository,
        repositoryId: "public",
        name: "public",
        isPrivate: false,
        scanEnabled: true,
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...repository,
        repositoryId: `private-${index + 1}`,
        name: `private-${index + 1}`,
        isPrivate: true,
        scanEnabled: true,
      })),
    ]);
    vi.mocked(setRepositoryScanEnabled).mockResolvedValue(true);

    await expect(
      reconcileRepositoryEntitlements({} as D1DatabaseLike, "42", "2026-08-10T22:00:00.000Z"),
    ).resolves.toEqual({ enabled: 6, blocked: 1 });

    expect(setRepositoryScanEnabled).toHaveBeenCalledTimes(1);
    expect(setRepositoryScanEnabled).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        repositoryId: "private-6",
        scanEnabled: false,
      }),
    );
  });
});
