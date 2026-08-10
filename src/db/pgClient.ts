import { readFileSync } from "node:fs";
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
 * ── TLS IS CONFIGURED HERE, NOT IN THE URL (C8) ─────────────────────────────
 * It used to be the other way round: the connection string carried its own
 * `sslmode` and this file passed it through untouched, on the reasoning that TLS
 * policy is the operator's decision. That reasoning was sound and the mechanism
 * was wrong, for two compounding reasons found in the live MANAGER_VERIFY run:
 *
 *   1. `?sslmode=require` does NOT mean "require encryption" to this driver.
 *      `pg-connection-string` maps it to `ssl: {}`, which node-postgres treats
 *      as verify-full (the driver now emits a deprecation warning saying exactly
 *      that). Against the Supabase pooler, whose chain Node's default store does
 *      not carry, it fails with "self-signed certificate in certificate chain" —
 *      which reads like a broken database and is actually a missing CA.
 *   2. A caller could not fix it by passing `ssl` to the Client either, because
 *      `ConnectionParameters` does `Object.assign({}, config, parse(config.connectionString))`:
 *      the URL's `sslmode` OVERRIDES an explicit ssl object. So the only way to
 *      configure TLS properly is to take `sslmode` OUT of the URL first, which is
 *      what `resolveSslPolicy` below does.
 *
 * The resulting policy, in precedence order, is stated rather than implied:
 *   • a CA supplied (POSTGRES_CA_CERT inline PEM, or POSTGRES_CA_CERT_PATH) →
 *     the chain is VERIFIED against it. This is the correct configuration and the
 *     one MANAGER_VERIFY.md now walks the operator through.
 *   • `sslmode=no-verify` in the URL, or POSTGRES_SSL_NO_VERIFY=1 → encrypted but
 *     UNAUTHENTICATED. The operator's current live setting; it works, and what it
 *     gives up is named here and in the runbook rather than glossed.
 *   • `sslmode=disable` → no TLS at all. Only sane for a local socket.
 *   • nothing said → verify against Node's own trust store.
 */

export type SslMode = "verify-ca" | "no-verify" | "disabled" | "system-default";

export interface SslPolicy {
  /** The connection string with `sslmode` REMOVED, so `ssl` below actually wins. */
  connectionString: string;
  /** Exactly what is handed to `new Client({ ssl })`. */
  ssl: false | { ca?: string; rejectUnauthorized: boolean; servername?: string };
  mode: SslMode;
  /** One line an operator can act on, used in logs and in connection errors. */
  note: string;
}

interface SslEnv {
  POSTGRES_CA_CERT?: string | undefined;
  POSTGRES_CA_CERT_PATH?: string | undefined;
  POSTGRES_SSL_NO_VERIFY?: string | undefined;
}

const truthy = (v: string | undefined): boolean =>
  v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";

/**
 * Decide the TLS policy and hand back a connection string that cannot override
 * it. Pure and exported so C8 is covered by tests that need no database:
 * test/se.pg-ssl.test.ts pins every branch, including the URL-overrides-config
 * trap that caused the defect.
 */
export function resolveSslPolicy(
  connectionString: string,
  env: SslEnv = process.env,
): SslPolicy {
  let url: URL | null = null;
  try {
    url = new URL(connectionString);
  } catch {
    // Not a URL (e.g. a libpq key=value DSN). We cannot safely rewrite it, so we
    // leave it alone and say so — better than silently applying half a policy.
    return {
      connectionString,
      ssl: { rejectUnauthorized: true },
      mode: "system-default",
      note: "connection string is not a URL; sslmode (if any) was left in place and may override this policy",
    };
  }

  const sslmode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  url.searchParams.delete("sslmode");
  const stripped = url.toString();
  const servername = url.hostname;

  const ca = env.POSTGRES_CA_CERT?.trim()
    ? env.POSTGRES_CA_CERT
    : env.POSTGRES_CA_CERT_PATH
      ? readFileSync(env.POSTGRES_CA_CERT_PATH, "utf8")
      : undefined;

  if (ca) {
    return {
      connectionString: stripped,
      ssl: { ca, rejectUnauthorized: true, servername },
      mode: "verify-ca",
      note: "TLS chain verified against the supplied Supabase CA certificate",
    };
  }

  if (sslmode === "disable") {
    return {
      connectionString: stripped,
      ssl: false,
      mode: "disabled",
      note: "TLS disabled by sslmode=disable — traffic is NOT encrypted",
    };
  }

  if (sslmode === "no-verify" || truthy(env.POSTGRES_SSL_NO_VERIFY)) {
    return {
      connectionString: stripped,
      ssl: { rejectUnauthorized: false, servername },
      mode: "no-verify",
      note: "TLS encrypted but the certificate chain is NOT verified (sslmode=no-verify). Supply POSTGRES_CA_CERT to verify it",
    };
  }

  return {
    connectionString: stripped,
    ssl: { rejectUnauthorized: true, servername },
    mode: "system-default",
    note: "TLS chain verified against Node's trust store; supply POSTGRES_CA_CERT if the host presents a private CA",
  };
}

/** Node's TLS error codes for "the chain did not verify" — the C8 symptom. */
const CHAIN_ERRORS = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
]);

/**
 * Turn a TLS chain failure into the sentence that ends the investigation. The
 * raw driver error names a certificate; it does not name the two settings that
 * fix it, and the last operator to hit this lost an afternoon to that gap.
 */
function explainConnectError(err: unknown, policy: SslPolicy): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || !CHAIN_ERRORS.has(code)) return err;
  const original = err instanceof Error ? err.message : String(err);
  return new Error(
    `Postgres TLS verification failed (${code}): ${original}. ` +
      `Current policy: ${policy.mode} — ${policy.note}. ` +
      `Fix it by setting POSTGRES_CA_CERT to the project's certificate ` +
      `(Supabase → Settings → Database → SSL Configuration), or accept an ` +
      `unverified chain with sslmode=no-verify. See MANAGER_VERIFY.md step 2.`,
    { cause: err },
  );
}

/** Milliseconds. Bounds a query that would otherwise outlive its caller — a
 *  serverless invocation Vercel has already killed leaves the transaction behind
 *  it. Above the 60s function budget by design, so it never truncates a
 *  legitimate run; override with POSTGRES_STATEMENT_TIMEOUT_MS. */
const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000;

export async function withPgClient<T>(
  connectionString: string,
  fn: (db: DbClient) => Promise<T>,
): Promise<T> {
  const policy = resolveSslPolicy(connectionString);

  const client = new Client({
    connectionString: policy.connectionString,
    ssl: policy.ssl,
    // A serverless caller crossing a region boundary is the worst case for every
    // one of these (C9): a cold TCP+TLS handshake, then a write pass whose gaps
    // between statements are long enough for an idle middlebox to drop the
    // socket. keepAlive holds it open; the connect timeout turns an unreachable
    // host into a named failure in 15s rather than a hang.
    keepAlive: true,
    connectionTimeoutMillis: 15_000,
    application_name: "nscc-fantasy-recompute",
  });

  try {
    await client.connect();
  } catch (err) {
    throw explainConnectError(err, policy);
  }

  try {
    const timeout = Number(
      process.env["POSTGRES_STATEMENT_TIMEOUT_MS"] ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    );
    if (Number.isFinite(timeout) && timeout > 0) {
      await client.query(`SET statement_timeout = ${Math.floor(timeout)}`);
    }
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
