import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from "../src/database.js";

export interface RecordedStatement {
  readonly sql: string;
  bindings: readonly unknown[];
}

class RecordingStatement implements D1PreparedStatementLike {
  constructor(
    private readonly database: RecordingD1Database,
    readonly record: RecordedStatement,
  ) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    this.record.bindings = values;
    return this;
  }

  first<T = unknown>(columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = Record<string, unknown>>(_columnName?: string): Promise<T | null> {
    return Promise.resolve(this.database.takeFirst<T>());
  }

  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return Promise.resolve(this.database.takeRunResult<T>());
  }

  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return Promise.resolve(this.database.takeAllResult<T>());
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    return Promise.reject(new Error("raw() is not implemented by the query recorder"));
  }
}

export class RecordingD1Database implements D1DatabaseLike {
  readonly prepared: RecordedStatement[] = [];
  readonly batches: RecordedStatement[][] = [];
  private readonly firstResults: unknown[] = [];
  private readonly allResults: unknown[][] = [];
  private readonly runChanges: number[] = [];
  private readonly batchChanges: number[][] = [];
  private readonly batchResults: unknown[][][] = [];

  prepare(query: string): D1PreparedStatementLike {
    const record: RecordedStatement = { sql: query, bindings: [] };
    this.prepared.push(record);
    return new RecordingStatement(this, record);
  }

  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> {
    const records = statements.map((statement) => {
      if (!(statement instanceof RecordingStatement)) {
        throw new TypeError("The query recorder received an unknown prepared statement");
      }
      return statement.record;
    });
    this.batches.push(records);
    const changes = this.batchChanges.shift() ?? records.map(() => 1);
    const resultSet = this.batchResults.shift() ?? records.map(() => []);
    return Promise.resolve(
      records.map((_, index) =>
        this.result<T>((resultSet[index] ?? []) as T[], changes[index] ?? 1),
      ),
    );
  }

  queueFirst(...results: unknown[]): void {
    this.firstResults.push(...results);
  }

  queueAll(...results: unknown[][]): void {
    this.allResults.push(...results);
  }

  queueRunChanges(...changes: number[]): void {
    this.runChanges.push(...changes);
  }

  queueBatchChanges(...changes: number[]): void {
    this.batchChanges.push(changes);
  }

  queueBatchResults(...results: unknown[][]): void {
    this.batchResults.push(results);
  }

  takeFirst<T>(): T | null {
    if (this.firstResults.length === 0) {
      return null;
    }
    return this.firstResults.shift() as T | null;
  }

  takeRunResult<T>(): D1ResultLike<T> {
    return this.result([], this.runChanges.shift() ?? 1);
  }

  takeAllResult<T>(): D1ResultLike<T> {
    return this.result((this.allResults.shift() ?? []) as T[], 0);
  }

  private result<T>(results: T[], changes: number): D1ResultLike<T> {
    return {
      success: true,
      results,
      meta: { changes },
    };
  }
}

export function normalizeSql(sql: string): string {
  return sql.replaceAll(/\s+/g, " ").trim();
}
