import { bindStatement, type D1DatabaseLike } from "./database.js";
import type { DatabaseRow } from "./rows.js";
import { assertNonEmpty, assertTimestamp } from "./validation.js";

export interface RecordWebhookDeliveryInput {
  readonly accountId: string;
  readonly deliveryId: string;
  readonly eventName: string;
  readonly receivedAt: string;
}

export interface FinishWebhookDeliveryInput {
  readonly accountId: string;
  readonly deliveryId: string;
  readonly finishedAt: string;
}

export interface FailWebhookDeliveryInput extends FinishWebhookDeliveryInput {
  readonly errorCode: string;
}

export async function recordWebhookDelivery(
  db: D1DatabaseLike,
  input: RecordWebhookDeliveryInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.deliveryId, "deliveryId");
  assertNonEmpty(input.eventName, "eventName");
  assertTimestamp(input.receivedAt, "receivedAt");

  const row = await bindStatement(
    db,
    `
      INSERT INTO webhook_deliveries (
        account_id,
        delivery_id,
        event_name,
        status,
        received_at
      )
      VALUES (?, ?, ?, 'received', ?)
      ON CONFLICT (account_id, delivery_id) DO UPDATE SET
        status = 'received',
        processed_at = NULL,
        last_error_code = NULL
      WHERE webhook_deliveries.status = 'failed'
      RETURNING delivery_id
    `,
    [input.accountId, input.deliveryId, input.eventName, input.receivedAt],
  ).first<DatabaseRow>();

  return row !== null;
}

export async function completeWebhookDelivery(
  db: D1DatabaseLike,
  input: FinishWebhookDeliveryInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.deliveryId, "deliveryId");
  assertTimestamp(input.finishedAt, "finishedAt");

  const row = await bindStatement(
    db,
    `
      UPDATE webhook_deliveries
      SET
        status = 'processed',
        processed_at = ?,
        last_error_code = NULL
      WHERE account_id = ?
        AND delivery_id = ?
        AND status = 'received'
      RETURNING delivery_id
    `,
    [input.finishedAt, input.accountId, input.deliveryId],
  ).first<DatabaseRow>();

  return row !== null;
}

export async function failWebhookDelivery(
  db: D1DatabaseLike,
  input: FailWebhookDeliveryInput,
): Promise<boolean> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.deliveryId, "deliveryId");
  assertNonEmpty(input.errorCode, "errorCode");
  assertTimestamp(input.finishedAt, "finishedAt");

  const row = await bindStatement(
    db,
    `
      UPDATE webhook_deliveries
      SET
        status = 'failed',
        processed_at = ?,
        last_error_code = ?
      WHERE account_id = ?
        AND delivery_id = ?
        AND status = 'received'
      RETURNING delivery_id
    `,
    [input.finishedAt, input.errorCode, input.accountId, input.deliveryId],
  ).first<DatabaseRow>();

  return row !== null;
}
