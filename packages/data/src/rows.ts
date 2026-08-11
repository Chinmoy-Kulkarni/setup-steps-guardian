import { DataInvariantError } from "./database.js";

export type DatabaseRow = Record<string, unknown>;

export function readString(row: DatabaseRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new DataInvariantError(`Expected ${field} to be a string`);
  }
  return value;
}

export function readNullableString(row: DatabaseRow, field: string): string | null {
  const value = row[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new DataInvariantError(`Expected ${field} to be a string or null`);
  }
  return value;
}

export function readInteger(row: DatabaseRow, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DataInvariantError(`Expected ${field} to be an integer`);
  }
  return value;
}

export function readNullableInteger(row: DatabaseRow, field: string): number | null {
  if (row[field] === null) {
    return null;
  }
  return readInteger(row, field);
}

export function readBoolean(row: DatabaseRow, field: string): boolean {
  const value = readInteger(row, field);
  if (value !== 0 && value !== 1) {
    throw new DataInvariantError(`Expected ${field} to be 0 or 1`);
  }
  return value === 1;
}

export function readEnum<const Values extends readonly string[]>(
  row: DatabaseRow,
  field: string,
  values: Values,
): Values[number] {
  const value = readString(row, field);
  if (!values.includes(value)) {
    throw new DataInvariantError(`Unexpected ${field} value: ${value}`);
  }
  return value;
}
