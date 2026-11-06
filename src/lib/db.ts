import postgres from "postgres";

// Versioned key: bump it when the options change, so a running dev server drops its old pool on hot reload.
const cache = globalThis as { __accelSqlV4?: postgres.Sql };

/**
 * DATABASE_URL is Supabase's transaction pooler (port 6543), which suits serverless.
 * It doesn't support prepared statements, and each instance only needs one connection.
 *
 * max_pipeline: 1 works around a postgres.js 4.1.0 bug: when two queries are pipelined on one connection
 * and the second fails (any error, e.g. a missing table or a statement timeout), that query never settles
 * and the connection hangs forever. With max: 1 that froze every later request (pages "stuck" ~95 s
 * until the browser gave up). Remove it once a fixed postgres.js release is out and re-tested.
 *
 * The timeouts recycle connections the pooler may have dropped while idle, and make a stalled connect give up.
 */
export function db(): postgres.Sql {
  if (!cache.__accelSqlV4) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cache.__accelSqlV4 = postgres(url, {
      prepare: false,
      max: 1,
      max_pipeline: 1,
      ssl: "require",
      connect_timeout: 10, // seconds
      idle_timeout: 20,
      max_lifetime: 60 * 10,
    });
  }
  return cache.__accelSqlV4;
}
