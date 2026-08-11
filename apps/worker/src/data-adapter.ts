import type { D1DatabaseLike } from "@setup-fleet/data";

export function asDataDatabase(database: D1Database): D1DatabaseLike {
  return database;
}
