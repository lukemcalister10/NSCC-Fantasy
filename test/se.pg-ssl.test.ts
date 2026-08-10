import { describe, it, expect } from "vitest";
import { resolveSslPolicy } from "../src/db/pgClient.js";

/**
 * C8 — POSTGRES SSL. MANAGER_VERIFY told the operator to use `?sslmode=require`;
 * against the Supabase pooler that fails with "self-signed certificate in
 * certificate chain", and the working live setting turned out to be
 * `?sslmode=no-verify`. Both facts are surprising, and both have the same root:
 *
 *   • `sslmode=require` does NOT mean "require encryption" here. It parses to
 *     `ssl: {}`, which this driver treats as verify-full.
 *   • an explicit `ssl` option cannot fix that, because node-postgres merges the
 *     URL's parsed values ON TOP of the config object — the URL wins.
 *
 * So TLS can only be configured properly by removing `sslmode` from the URL
 * first. That is the property these tests exist to hold: every policy branch, and
 * above all the stripping, since forgetting it would silently restore the defect
 * while every other assertion still passed.
 */

const URL_BASE = "postgresql://postgres.abc:s3cr3t@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres";
const CA = "-----BEGIN CERTIFICATE-----\nnot-a-real-cert\n-----END CERTIFICATE-----\n";

describe("C8 resolveSslPolicy — sslmode never reaches the driver", () => {
  it("strips sslmode=require, so it cannot override the explicit ssl config", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=require`, {});
    expect(policy.connectionString).not.toContain("sslmode");
    expect(policy.connectionString).toContain("pooler.supabase.com");
  });

  it("strips sslmode while preserving every other query parameter", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=require&pgbouncer=true`, {});
    expect(policy.connectionString).not.toContain("sslmode");
    expect(policy.connectionString).toContain("pgbouncer=true");
  });

  it("keeps the credentials and the target intact", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=no-verify`, {});
    expect(policy.connectionString).toContain("postgres.abc:s3cr3t@");
    expect(policy.connectionString).toContain(":6543/postgres");
  });
});

describe("C8 resolveSslPolicy — the policy itself", () => {
  it("a supplied CA verifies the chain (the correct configuration)", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=require`, {
      POSTGRES_CA_CERT: CA,
    });
    expect(policy.mode).toBe("verify-ca");
    expect(policy.ssl).toMatchObject({ ca: CA, rejectUnauthorized: true });
  });

  it("a supplied CA beats sslmode=no-verify — the stronger setting wins", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=no-verify`, {
      POSTGRES_CA_CERT: CA,
    });
    expect(policy.mode).toBe("verify-ca");
  });

  it("sslmode=no-verify encrypts without verifying, and SAYS so", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=no-verify`, {});
    expect(policy.mode).toBe("no-verify");
    expect(policy.ssl).toMatchObject({ rejectUnauthorized: false });
    expect(policy.note).toMatch(/not verified/i);
  });

  it("POSTGRES_SSL_NO_VERIFY is an equivalent lever for a URL nobody wants to edit", () => {
    expect(resolveSslPolicy(URL_BASE, { POSTGRES_SSL_NO_VERIFY: "1" }).mode).toBe("no-verify");
    // ...and is not tripped by the strings that mean "off".
    expect(resolveSslPolicy(URL_BASE, { POSTGRES_SSL_NO_VERIFY: "0" }).mode).toBe("system-default");
    expect(resolveSslPolicy(URL_BASE, { POSTGRES_SSL_NO_VERIFY: "false" }).mode).toBe(
      "system-default",
    );
    expect(resolveSslPolicy(URL_BASE, { POSTGRES_SSL_NO_VERIFY: "" }).mode).toBe("system-default");
  });

  it("sslmode=disable turns TLS off entirely, and names that consequence", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=disable`, {});
    expect(policy.mode).toBe("disabled");
    expect(policy.ssl).toBe(false);
    expect(policy.note).toMatch(/NOT encrypted/i);
  });

  it("saying nothing verifies against Node's trust store", () => {
    const policy = resolveSslPolicy(URL_BASE, {});
    expect(policy.mode).toBe("system-default");
    expect(policy.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("pins servername to the URL host, so SNI survives the rewrite", () => {
    const policy = resolveSslPolicy(`${URL_BASE}?sslmode=require`, { POSTGRES_CA_CERT: CA });
    expect(policy.ssl).toMatchObject({ servername: "aws-0-ap-southeast-2.pooler.supabase.com" });
  });

  it("a non-URL DSN is left alone rather than half-rewritten, and says why", () => {
    const dsn = "host=localhost port=5432 dbname=postgres sslmode=require";
    const policy = resolveSslPolicy(dsn, {});
    expect(policy.connectionString).toBe(dsn);
    expect(policy.note).toMatch(/not a URL/i);
  });
});
