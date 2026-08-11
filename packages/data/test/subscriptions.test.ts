import { describe, expect, it } from "vitest";
import {
  getSubscriptionEntitlementByProviderSubscriptionId,
  setSubscriptionEntitlement,
} from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

const timestamp = "2026-08-10T22:00:00.000Z";

function paddleRow(eventId: string, eventAt: string) {
  return {
    account_id: "account-1",
    plan_key: "team",
    entitlement_status: "active",
    repository_limit: 100,
    source: "paddle",
    provider_customer_id: "ctm_1",
    provider_subscription_id: "sub_1",
    last_provider_event_id: eventId,
    last_provider_event_at: eventAt,
    effective_at: timestamp,
    expires_at: null,
    updated_at: timestamp,
  };
}

const paddleInput = {
  accountId: "account-1",
  planKey: "team",
  status: "active",
  repositoryLimit: 100,
  source: "paddle",
  providerCustomerId: "ctm_1",
  providerSubscriptionId: "sub_1",
  lastProviderEventId: "evt_2",
  lastProviderEventAt: "2026-08-10T17:00:00-05:00",
  effectiveAt: timestamp,
  expiresAt: null,
  updatedAt: timestamp,
} as const;

describe("Paddle subscription ordering", () => {
  it("applies a new event and normalizes its provider timestamp", async () => {
    const db = new RecordingD1Database();
    db.queueFirst(paddleRow("evt_2", timestamp));

    const result = await setSubscriptionEntitlement(db, paddleInput);

    expect(result.outcome).toBe("applied");
    expect(result.entitlement.providerSubscriptionId).toBe("sub_1");
    expect(db.prepared[0]?.bindings).toContain(timestamp);
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain(
      "RETURNING account_id, plan_key, entitlement_status",
    );
  });

  it("classifies the same provider event as a duplicate", async () => {
    const db = new RecordingD1Database();
    db.queueFirst(null, paddleRow("evt_2", timestamp));

    const result = await setSubscriptionEntitlement(db, paddleInput);

    expect(result.outcome).toBe("duplicate");
    expect(result.entitlement.lastProviderEventId).toBe("evt_2");
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain(
      "excluded.last_provider_event_id <> subscriptions.last_provider_event_id",
    );
    expect(db.prepared[1]?.bindings).toEqual(["account-1"]);
  });

  it("classifies an older different event as stale", async () => {
    const db = new RecordingD1Database();
    db.queueFirst(null, paddleRow("evt_3", "2026-08-11T00:00:00.000Z"));

    const result = await setSubscriptionEntitlement(db, {
      ...paddleInput,
      lastProviderEventId: "evt_1",
      lastProviderEventAt: "2026-08-10T21:00:00.000Z",
    });

    expect(result.outcome).toBe("stale");
    expect(result.entitlement.lastProviderEventId).toBe("evt_3");
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain(
      "excluded.last_provider_event_at > subscriptions.last_provider_event_at",
    );
  });

  it("looks up Paddle state by provider subscription ID", async () => {
    const db = new RecordingD1Database();
    db.queueFirst(paddleRow("evt_2", timestamp));

    await expect(
      getSubscriptionEntitlementByProviderSubscriptionId(db, "sub_1"),
    ).resolves.toMatchObject({
      accountId: "account-1",
      providerSubscriptionId: "sub_1",
    });
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain(
      "WHERE source = 'paddle' AND provider_subscription_id = ?",
    );
  });
});
