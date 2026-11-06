import postgres from "postgres";

const cache = globalThis as { __accelSql?: postgres.Sql };

/**
 * DATABASE_URL is Supabase's transaction pooler (port 6543), which suits serverless.
 * It doesn't support prepared statements, and each instance only needs one connection.
 */
export function db(): postgres.Sql {
  if (!cache.__accelSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cache.__accelSql = postgres(url, { prepare: false, max: 1, ssl: "require" });
  }
  return cache.__accelSql;
}
