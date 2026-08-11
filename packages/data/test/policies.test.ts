import { describe, expect, it } from "vitest";
import { deleteAccountPolicy, getAccountPolicy, upsertAccountPolicy } from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

const timestamp = "2026-08-10T22:00:00.000Z";
const policyHash = "a".repeat(64);

describe("account policies", () => {
  it("stores only normalized effective policy fields", async () => {
    const db = new RecordingD1Database();

    await upsertAccountPolicy(db, {
      accountId: "account-1",
      schemaVersion: 1,
      policyHash,
      allowedRunners: ["ubuntu-latest", "windows-latest"],
      maxTimeoutMinutes: 30,
      requireTimeout: true,
      requireExplicitPermissions: true,
      requireWorkflowDispatch: true,
      actionPinning: "error",
      secretUsage: "warning",
      unsupportedJobKeys: "warning",
      updatedAt: timestamp,
    });

    const statement = db.prepared[0];
    expect(normalizeSql(statement?.sql ?? "")).toContain(
      "VALUES (?, ?, 'account', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    expect(statement?.bindings).toContain(JSON.stringify(["ubuntu-latest", "windows-latest"]));
    expect(statement?.sql.toLowerCase()).not.toContain("yaml");
    expect(statement?.bindings).toContain(policyHash);
  });

  it("gets and deletes the tenant account policy", async () => {
    const db = new RecordingD1Database();
    db.queueFirst({
      account_id: "account-1",
      schema_version: 1,
      policy_hash: policyHash,
      allowed_runners_json: JSON.stringify(["ubuntu-latest"]),
      max_timeout_minutes: 30,
      require_timeout: 1,
      require_explicit_permissions: 1,
      require_workflow_dispatch: 1,
      action_pinning: "error",
      secret_usage: "warning",
      unsupported_job_keys: "warning",
      created_at: timestamp,
      updated_at: timestamp,
    });
    db.queueRunChanges(1);

    await expect(getAccountPolicy(db, "account-1")).resolves.toMatchObject({
      accountId: "account-1",
      policyHash,
      allowedRunners: ["ubuntu-latest"],
      requireTimeout: true,
    });
    await expect(deleteAccountPolicy(db, "account-1")).resolves.toBe(true);

    for (const statement of db.prepared) {
      const sql = normalizeSql(statement.sql);
      expect(sql).toContain("account_id = ?");
      expect(sql).toContain("scope = 'account'");
      expect(statement.bindings).toEqual(["account-1"]);
    }
  });
});
