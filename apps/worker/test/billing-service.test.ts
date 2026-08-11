import { describe, expect, it } from "vitest";
import { priceIdForPlan, subscriptionInputForPaddle } from "../src/billing-service.js";

describe("billing service", () => {
  it("selects only configured plan price identifiers", () => {
    expect(priceIdForPlan("team", { team: "pri_team", fleet: "pri_fleet" })).toBe("pri_team");
    expect(priceIdForPlan("fleet", { team: "pri_team", fleet: "pri_fleet" })).toBe("pri_fleet");
  });

  it("maps past-due Paddle subscriptions to a bounded grace entitlement", () => {
    expect(
      subscriptionInputForPaddle({
        eventId: "evt_1",
        githubAccountId: "42",
        providerSubscriptionId: "sub_1",
        providerCustomerId: "ctm_1",
        plan: "team",
        status: "past_due",
        occurredAt: "2026-08-10T22:00:00.000Z",
      }),
    ).toMatchObject({
      status: "grace",
      repositoryLimit: 25,
      source: "paddle",
      lastProviderEventId: "evt_1",
    });
  });
});
