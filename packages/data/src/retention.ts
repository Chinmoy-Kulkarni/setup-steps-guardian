import { bindStatement, changedRows, type D1DatabaseLike, DataInvariantError } from "./database.js";
import { assertIntegerBetween, normalizeTimestamp } from "./validation.js";

export interface OperationalCleanupResult {
  readonly scanJobsDeleted: number;
  readonly webhookDeliveriesDeleted: number;
}

export async function cleanupExpiredOperationalData(
  db: D1DatabaseLike,
  cutoff: string,
  limitPerTable: number,
): Promise<OperationalCleanupResult> {
  const normalizedCutoff = normalizeTimestamp(cutoff, "cutoff");
  assertIntegerBetween(limitPerTable, 1, 1_000, "limitPerTable");

  const results = await db.batch([
    bindStatement(
      db,
      `
        DELETE FROM scan_jobs
        WHERE rowid IN (
          SELECT rowid
          FROM scan_jobs
          WHERE status IN ('succeeded', 'failed')
            AND completed_at IS NOT NULL
            AND julianday(completed_at) < julianday(?)
          ORDER BY completed_at, account_id, id
          LIMIT ?
        )
      `,
      [normalizedCutoff, limitPerTable],
    ),
    bindStatement(
      db,
      `
        DELETE FROM webhook_deliveries
        WHERE rowid IN (
          SELECT rowid
          FROM webhook_deliveries
          WHERE status IN ('processed', 'failed')
            AND processed_at IS NOT NULL
            AND julianday(processed_at) < julianday(?)
          ORDER BY processed_at, account_id, delivery_id
          LIMIT ?
        )
      `,
      [normalizedCutoff, limitPerTable],
    ),
  ]);

  const scanJobsResult = results[0];
  const webhookDeliveriesResult = results[1];
  if (scanJobsResult === undefined || webhookDeliveriesResult === undefined) {
    throw new DataInvariantError("Retention cleanup returned an incomplete batch");
  }

  return {
    scanJobsDeleted: changedRows(scanJobsResult),
    webhookDeliveriesDeleted: changedRows(webhookDeliveriesResult),
  };
}
