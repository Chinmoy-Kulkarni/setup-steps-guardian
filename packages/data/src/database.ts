export type SqlValue = string | number | null;

export interface D1ResultLike<T = unknown> {
  readonly success: true;
  readonly results: T[];
  readonly meta: {
    readonly changes: number;
    readonly [key: string]: unknown;
  };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]>;
}

export class DataInvariantError extends Error {
  override readonly name = "DataInvariantError";
}

export function bindStatement(
  db: D1DatabaseLike,
  sql: string,
  values: readonly SqlValue[],
): D1PreparedStatementLike {
  return db.prepare(sql).bind(...values);
}

export function changedRows(result: D1ResultLike<unknown>): number {
  return result.meta.changes;
}
