import { Client } from "pg";
import type { DbClient } from "./repository.js";

/**
 * node-postgres adapter for the `DbClient` surface the repository speaks.
 *
 * SERVER-SIDE ONLY. Nothing under `app/` may import this file: it opens a direct
 * Postgres connection with credentials that must never reach a browser. The
 * browser talks to Supabase through the anon key and RLS, exactly as before; the
 * only privileged callers are the operator's CLI and the serverless recompute
 * route, both of which run where secrets legitimately live.
 * test/sa.server-secrets.test.ts fails the build if an app/ file ever imports it.
 *
 * The connection string is supplied by the environment (never by this repository,
 * never by a default in code) and carries its own sslmode — TLS policy stays the
 * operator's decision, not a hardcoded override.
 */
export async function withPgClient<T>(
  connectionString: string,
  fn: (db: DbClient) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const db: DbClient = {
      async query<R = Record<string, unknown>>(sql: string, params?: unknown[]) {
        const res = await client.query(sql, params as unknown[]);
        return { rows: res.rows as R[] };
      },
    };
    return await fn(db);
  } finally {
    await client.end();
  }
}
