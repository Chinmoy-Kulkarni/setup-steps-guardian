import { describe, expect, it } from "vitest";
import {
  partitionRepositoriesByEntitlement,
  resolveEntitlement,
  resolvePersistedEntitlement,
} from "../src/entitlements.js";

describe("entitlements", () => {
  it("grants the documented active plan limits", () => {
    expect(resolveEntitlement(undefined)).toMatchObject({
      plan: "free",
      privateRepositoryLimit: 5,
    });
    expect(resolveEntitlement({ plan: "team", status: "active" })).toMatchObject({
      plan: "team",
      privateRepositoryLimit: 25,
    });
    expect(resolveEntitlement({ plan: "fleet", status: "active" })).toMatchObject({
      plan: "fleet",
      privateRepositoryLimit: 100,
    });
  });

  it("falls back to free limits after cancellation or pause", () => {
    expect(resolveEntitlement({ plan: "team", status: "canceled" }).plan).toBe("free");
    expect(resolveEntitlement({ plan: "fleet", status: "paused" }).plan).toBe("free");
  });

  it("maps persisted Paddle or Marketplace entitlement state", () => {
    expect(
      resolvePersistedEntitlement({
        accountId: "42",
        planKey: "fleet",
        status: "grace",
        repositoryLimit: 100,
        source: "paddle",
        providerCustomerId: "ctm_1",
        providerSubscriptionId: "sub_1",
        lastProviderEventId: "evt_1",
        lastProviderEventAt: "2026-08-10T22:00:00.000Z",
        effectiveAt: "2026-08-10T22:00:00.000Z",
        expiresAt: null,
        updatedAt: "2026-08-10T22:00:00.000Z",
      }),
    ).toMatchObject({
      plan: "fleet",
      privateRepositoryLimit: 100,
    });
  });

  it("keeps public repositories and blocks only excess private repositories", () => {
    const repositories = [
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `private-${index}`,
        isPrivate: true,
      })),
      { id: "public", isPrivate: false },
    ];
    const result = partitionRepositoriesByEntitlement(repositories, resolveEntitlement(undefined));

    expect(result.allowed.map((repository) => repository.id)).toContain("public");
    expect(result.blocked).toHaveLength(2);
  });
});
