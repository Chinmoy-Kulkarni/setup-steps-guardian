import { describe, expect, it } from "vitest";
import {
  claimScanJob,
  completeScanJob,
  enqueueScanJob,
  failScanJob,
  requeueExpiredScanJobs,
  retryScanJob,
} from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

const timestamp = "2026-08-10T22:00:00.000Z";
const later = "2026-08-10T22:05:00.000Z";

function scanJobRow(status: "queued" | "running" | "succeeded" | "failed") {
  return {
    account_id: "account-1",
    id: "job-1",
    repository_id: "repository-1",
    reason: "webhook",
    status,
    priority: 10,
    dedupe_key: "delivery-1",
    attempt_count: status === "queued" ? 0 : 1,
    max_attempts: 3,
    available_at: timestamp,
    lease_owner: status === "running" ? "worker-1" : null,
    lease_expires_at: status === "running" ? later : null,
    last_error_code: null,
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
  };
}

describe("scan jobs", () => {
  it("represents idempotent enqueue conflicts and reads the tenant-owned job", async () => {
    const db = new RecordingD1Database();
    db.queueFirst(null, scanJobRow("queued"));

    const result = await enqueueScanJob(db, {
      accountId: "account-1",
      jobId: "new-job-id",
      repositoryId: "repository-1",
      reason: "webhook",
      dedupeKey: "delivery-1",
      priority: 10,
      availableAt: timestamp,
      createdAt: timestamp,
    });

    expect(result.created).toBe(false);
    expect(result.job.id).toBe("job-1");
    expect(normalizeSql(db.prepared[0]?.sql ?? "")).toContain(
      "ON CONFLICT (account_id, dedupe_key) DO NOTHING",
    );
    expect(normalizeSql(db.prepared[1]?.sql ?? "")).toContain(
      "WHERE account_id = ? AND dedupe_key = ?",
    );
    expect(db.prepared[1]?.bindings).toEqual(["account-1", "delivery-1"]);
  });

  it("claims only due work for the requested tenant", async () => {
    const db = new RecordingD1Database();
    db.queueFirst(scanJobRow("running"));

    const job = await claimScanJob(db, {
      accountId: "account-1",
      workerId: "worker-1",
      claimedAt: timestamp,
      leaseExpiresAt: later,
    });

    const sql = normalizeSql(db.prepared[0]?.sql ?? "");
    expect(job?.status).toBe("running");
    expect(sql).toContain("WHERE account_id = ?");
    expect(sql).toContain("FROM scan_jobs WHERE account_id = ?");
    expect(db.prepared[0]?.bindings.filter((value) => value === "account-1")).toHaveLength(2);
  });

  it("requires the tenant and lease owner when completing or retrying", async () => {
    const db = new RecordingD1Database();
    db.queueFirst({ id: "job-1" }, scanJobRow("queued"));

    await expect(
      completeScanJob(db, {
        accountId: "account-1",
        jobId: "job-1",
        workerId: "worker-1",
        completedAt: later,
      }),
    ).resolves.toBe(true);
    await expect(
      retryScanJob(db, {
        accountId: "account-1",
        jobId: "job-1",
        workerId: "worker-1",
        errorCode: "GITHUB_RATE_LIMITED",
        retryAt: later,
        updatedAt: timestamp,
      }),
    ).resolves.toMatchObject({ status: "queued" });

    for (const statement of db.prepared) {
      const sql = normalizeSql(statement.sql);
      expect(sql).toContain("account_id = ?");
      expect(sql).toContain("lease_owner = ?");
      expect(statement.bindings).toContain("account-1");
      expect(statement.bindings).toContain("worker-1");
    }
  });

  it("can fail a non-retryable claimed job immediately", async () => {
    const db = new RecordingD1Database();
    db.queueFirst({ id: "job-1" });

    await expect(
      failScanJob(db, {
        accountId: "account-1",
        jobId: "job-1",
        workerId: "worker-1",
        errorCode: "GITHUB_AUTHORIZATION",
        failedAt: later,
      }),
    ).resolves.toBe(true);

    const statement = db.prepared[0];
    expect(normalizeSql(statement?.sql ?? "")).toContain("status = 'failed'");
    expect(statement?.bindings).toEqual([
      "GITHUB_AUTHORIZATION",
      later,
      later,
      "account-1",
      "job-1",
      "worker-1",
    ]);
  });

  it("requeues or fails abandoned jobs after their leases expire", async () => {
    const db = new RecordingD1Database();
    db.queueRunChanges(4);

    await expect(
      requeueExpiredScanJobs(db, "2026-08-10T17:00:00-05:00", "2026-08-10T17:05:00-05:00"),
    ).resolves.toBe(4);

    const statement = db.prepared[0];
    const sql = normalizeSql(statement?.sql ?? "");
    expect(sql).toContain(
      "status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END",
    );
    expect(sql).toContain("WHERE status = 'running'");
    expect(sql).toContain("julianday(lease_expires_at) <= julianday(?)");
    expect(statement?.bindings).toEqual([later, timestamp, timestamp, timestamp]);
  });
});
