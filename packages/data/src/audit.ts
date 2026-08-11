import { bindStatement, type D1DatabaseLike } from "./database.js";
import { type DatabaseRow, readEnum, readNullableString, readString } from "./rows.js";
import { assertIntegerBetween, assertNonEmpty, assertTimestamp } from "./validation.js";

const AUDIT_ACTOR_TYPES = ["github", "user", "system"] as const;
const AUDIT_OUTCOMES = ["success", "denied", "failure"] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface AuditEvent {
  readonly accountId: string;
  readonly id: string;
  readonly actorType: AuditActorType;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly outcome: AuditOutcome;
  readonly reasonCode: string | null;
  readonly occurredAt: string;
}

export interface AppendAuditEventInput extends AuditEvent {}

export interface ListAuditEventsInput {
  readonly accountId: string;
  readonly before?: string;
  readonly limit?: number;
}

function mapAuditEvent(row: DatabaseRow): AuditEvent {
  return {
    accountId: readString(row, "account_id"),
    id: readString(row, "id"),
    actorType: readEnum(row, "actor_type", AUDIT_ACTOR_TYPES),
    actorId: readNullableString(row, "actor_id"),
    action: readString(row, "action"),
    targetType: readString(row, "target_type"),
    targetId: readNullableString(row, "target_id"),
    outcome: readEnum(row, "outcome", AUDIT_OUTCOMES),
    reasonCode: readNullableString(row, "reason_code"),
    occurredAt: readString(row, "occurred_at"),
  };
}

export async function appendAuditEvent(
  db: D1DatabaseLike,
  input: AppendAuditEventInput,
): Promise<void> {
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.action, "action");
  assertNonEmpty(input.targetType, "targetType");
  assertTimestamp(input.occurredAt, "occurredAt");

  await bindStatement(
    db,
    `
      INSERT INTO audit_events (
        account_id,
        id,
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        outcome,
        reason_code,
        occurred_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.accountId,
      input.id,
      input.actorType,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      input.outcome,
      input.reasonCode,
      input.occurredAt,
    ],
  ).run();
}

export async function listAuditEvents(
  db: D1DatabaseLike,
  input: ListAuditEventsInput,
): Promise<readonly AuditEvent[]> {
  assertNonEmpty(input.accountId, "accountId");
  const limit = input.limit ?? 50;
  assertIntegerBetween(limit, 1, 100, "limit");
  if (input.before !== undefined) {
    assertTimestamp(input.before, "before");
  }

  const statement =
    input.before === undefined
      ? bindStatement(
          db,
          `
            SELECT
              account_id,
              id,
              actor_type,
              actor_id,
              action,
              target_type,
              target_id,
              outcome,
              reason_code,
              occurred_at
            FROM audit_events
            WHERE account_id = ?
            ORDER BY occurred_at DESC, id DESC
            LIMIT ?
          `,
          [input.accountId, limit],
        )
      : bindStatement(
          db,
          `
            SELECT
              account_id,
              id,
              actor_type,
              actor_id,
              action,
              target_type,
              target_id,
              outcome,
              reason_code,
              occurred_at
            FROM audit_events
            WHERE account_id = ?
              AND occurred_at < ?
            ORDER BY occurred_at DESC, id DESC
            LIMIT ?
          `,
          [input.accountId, input.before, limit],
        );

  const result = await statement.all<DatabaseRow>();
  return result.results.map(mapAuditEvent);
}
