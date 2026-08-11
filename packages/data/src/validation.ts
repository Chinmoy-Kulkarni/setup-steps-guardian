const ISO_TIMESTAMP_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;

export function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
}

export function assertTimestamp(value: string, field: string): void {
  if (!ISO_TIMESTAMP_WITH_OFFSET.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO 8601 timestamp with an offset`);
  }
}

export function normalizeTimestamp(value: string, field: string): string {
  assertTimestamp(value, field);
  return new Date(value).toISOString();
}

export function assertSha256(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new TypeError(`${field} must be a SHA-256 hex digest`);
  }
}

export function assertIntegerAtLeast(value: number, minimum: number, field: string): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be an integer greater than or equal to ${minimum}`);
  }
}

export function assertIntegerBetween(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
}

export function toSqlBoolean(value: boolean): number {
  return value ? 1 : 0;
}
