import { describe, expect, it } from "vitest";
import { cleanupExpiredOperationalData } from "../src/index.js";
import { normalizeSql, RecordingD1Database } from "./fake-d1.js";

describe("operational retention cleanup", () => {
  it("deletes bounded terminal records in one ordered batch", async () => {
    const db = new RecordingD1Database();
    db.queueBatchChanges(7, 5);

    const result = await cleanupExpiredOperationalData(db, "2026-08-10T17:00:00-05:00", 100);

    expect(result).toEqual({
      scanJobsDeleted: 7,
      webhookDeliveriesDeleted: 5,
    });
    expect(db.batches).toHaveLength(1);
    const scanJobs = db.batches[0]?.[0];
    const webhooks = db.batches[0]?.[1];
    expect(normalizeSql(scanJobs?.sql ?? "")).toContain("WHERE status IN ('succeeded', 'failed')");
    expect(normalizeSql(scanJobs?.sql ?? "")).toContain("LIMIT ?");
    expect(normalizeSql(webhooks?.sql ?? "")).toContain("WHERE status IN ('processed', 'failed')");
    expect(normalizeSql(webhooks?.sql ?? "")).toContain("LIMIT ?");
    expect(scanJobs?.bindings).toEqual(["2026-08-10T22:00:00.000Z", 100]);
    expect(webhooks?.bindings).toEqual(["2026-08-10T22:00:00.000Z", 100]);
  });

  it("rejects an unbounded cleanup request before preparing SQL", async () => {
    const db = new RecordingD1Database();

    await expect(
      cleanupExpiredOperationalData(db, "2026-08-10T22:00:00.000Z", 1_001),
    ).rejects.toThrow("limitPerTable");
    expect(db.prepared).toEqual([]);
  });
});
