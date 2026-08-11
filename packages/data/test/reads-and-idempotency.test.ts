import { describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  completeWebhookDelivery,
  getFleetSummary,
  getSubscriptionEntitlement,
  listAuditEvents,
  recordWebhookDelivery,
  setSubscriptionEntitlement,
} from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

const timestamp = "2026-08-10T22:00:00.000Z";

describe("fleet and entitlement reads", () => {
  it("builds a validated fleet summary from a tenant-filtered query", async () => {
    const db = new RecordingD1Database();
    db.queueAll([
      {
        repository_id: "repository-1",
        owner: "example",
        name: "dashboard",
        is_private: 1,
        default_branch: "main",
        setup_status: "failing",
        last_evidence_at: timestamp,
        error_count: 1,
        warning_count: 0,
      },
    ]);

    const summary = await getFleetSummary(db, "account-1");

    expect(summary.totals).toEqual({ selected: 1, passing: 0, attention: 1 });
    expect(summary.repositories[0]?.isPrivate).toBe(true);
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain("WHERE repositories.account_id = ?");
    expect(db.prepared[0]?.bindings).toEqual(["account-1"]);
  });

  it("sets and reads only entitlement state, scoped by account", async () => {
    const db = new RecordingD1Database();
    const entitlementRow = {
      account_id: "account-1",
      plan_key: "team",
      entitlement_status: "active",
      repository_limit: 100,
      source: "github_marketplace",
      provider_customer_id: null,
      provider_subscription_id: null,
      last_provider_event_id: null,
      last_provider_event_at: null,
      effective_at: timestamp,
      expires_at: null,
      updated_at: timestamp,
    };
    db.queueFirst(entitlementRow);
    await expect(
      setSubscriptionEntitlement(db, {
        accountId: "account-1",
        planKey: "team",
        status: "active",
        repositoryLimit: 100,
        source: "github_marketplace",
        effectiveAt: timestamp,
        expiresAt: null,
        updatedAt: timestamp,
      }),
    ).resolves.toMatchObject({ outcome: "applied" });
    db.queueFirst(entitlementRow);

    await expect(getSubscriptionEntitlement(db, "account-1")).resolves.toMatchObject({
      accountId: "account-1",
      status: "active",
      repositoryLimit: 100,
      providerSubscriptionId: null,
    });
    expect(normalizeSql(db.prepared[1]?.sql ?? "")).toContain("WHERE account_id = ?");
    expect(db.prepared[1]?.bindings).toEqual(["account-1"]);
  });
});

describe("delivery and audit persistence", () => {
  it("uses an atomic delivery insert as the idempotency boundary", async () => {
    const db = new RecordingD1Database();
    db.queueFirst({ delivery_id: "delivery-1" }, null, { delivery_id: "delivery-1" });

    const input = {
      accountId: "account-1",
      deliveryId: "delivery-1",
      eventName: "workflow_run",
      receivedAt: timestamp,
    } as const;

    await expect(recordWebhookDelivery(db, input)).resolves.toBe(true);
    await expect(recordWebhookDelivery(db, input)).resolves.toBe(false);
    await expect(
      completeWebhookDelivery(db, {
        accountId: "account-1",
        deliveryId: "delivery-1",
        finishedAt: timestamp,
      }),
    ).resolves.toBe(true);

    for (const statement of db.prepared.slice(0, 2)) {
      expect(normalizeSql(statement.sql)).toContain(
        "ON CONFLICT (account_id, delivery_id) DO UPDATE SET status = 'received'",
      );
      expect(normalizeSql(statement.sql)).toContain("WHERE webhook_deliveries.status = 'failed'");
      expect(statement.bindings).toEqual(["account-1", "delivery-1", "workflow_run", timestamp]);
    }
    expect(normalizeSql(db.prepared[2]?.sql ?? "")).toContain(
      "WHERE account_id = ? AND delivery_id = ?",
    );
  });

  it("appends and lists minimal audit events for one tenant", async () => {
    const db = new RecordingD1Database();
    await appendAuditEvent(db, {
      accountId: "account-1",
      id: "audit-1",
      actorType: "system",
      actorId: null,
      action: "scan.completed",
      targetType: "repository",
      targetId: "repository-1",
      outcome: "success",
      reasonCode: null,
      occurredAt: timestamp,
    });
    db.queueAll([
      {
        account_id: "account-1",
        id: "audit-1",
        actor_type: "system",
        actor_id: null,
        action: "scan.completed",
        target_type: "repository",
        target_id: "repository-1",
        outcome: "success",
        reason_code: null,
        occurred_at: timestamp,
      },
    ]);

    const events = await listAuditEvents(db, {
      accountId: "account-1",
      limit: 10,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("scan.completed");
    expect(normalizeSql(db.prepared[1]?.sql ?? "")).toContain(
      "FROM audit_events WHERE account_id = ?",
    );
    expect(db.prepared[1]?.bindings).toEqual(["account-1", 10]);
  });
});
