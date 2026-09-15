import { asAuthed, type AuthCtx } from "./pgliteDb.js";
import type { DbClient } from "../../src/db/repository.js";

/**
 * A POSTGREST-SHAPED CLIENT OVER PGLITE (TEST-ONLY).
 *
 * WHY THIS EXISTS. C16 (the registration blocker) lived in the seam between the
 * PostgREST client's return shape and the app's own unwrapping of it. Every
 * existing team/trade test replays the app's write SHAPES as hand-written SQL,
 * which is the right tool for "does the database refuse this" — but it cannot
 * see a defect whose entire substance is what `supabase-js` hands back and what
 * `app/lib` then does with it. A test that re-implemented the query in SQL would
 * have passed on the broken code, which is exactly how C16 survived.
 *
 * So this object stands in for `app/lib/supabase.ts`: the app's REAL
 * `registerTeam`, `renameTeam`, `fetchMyTeam` and `fetchLeagueConfig` run
 * unmodified against it, and every request is served the way PostgREST serves
 * one — as ONE transaction, under `SET LOCAL ROLE` + a JWT `sub`, so RLS (0004)
 * and the trigger stack (0002/0003/0010) apply as they would in production.
 *
 * ── FIDELITY OF THE ONE THING UNDER TEST ────────────────────────────────────
 * `maybeSingle()` / `single()` semantics below are not guessed. They were read
 * out of the installed `@supabase/postgrest-js`:
 *
 *   maybeSingle()  PostgrestTransformBuilder.ts sets `isMaybeSingle`, and
 *                  PostgrestBuilder.ts then resolves a LIST response:
 *                    0 rows  -> data = null,    error = null
 *                    1 row   -> data = rows[0], error = null
 *                    >1 rows -> data = null,    error = PGRST116
 *   single()       sets `Accept: application/vnd.pgrst.object+json` and applies
 *                  NO client-side cardinality fix-up — the SERVER errors on 0 or
 *                  >1 rows (PGRST116).
 *
 * `test/c16.registration-path.test.ts` asserts these three cardinalities against
 * this shim directly, so the harness is pinned as well as the app: if a future
 * supabase-js changes the contract, that block fails rather than the suite
 * quietly proving the wrong thing.
 *
 * ── DELIBERATE LIMITS ───────────────────────────────────────────────────────
 * This supports exactly the verb/filter surface the registration and identity
 * paths use. Anything else — embedded resource selects (`players(...)`),
 * `.in()`, `.upsert()`, `.rpc()` — THROWS rather than silently doing something
 * approximate. A shim that guesses is worse than no shim: it produces green
 * tests about behaviour nobody implemented.
 */

export type ShimSession = AuthCtx;

/** `exactOptionalPropertyTypes` is on, so the optional fields say `| undefined`
 *  explicitly — a PostgREST error carries `code` only sometimes. */
interface PgError {
  message: string;
  code?: string | undefined;
  details?: string | null | undefined;
  hint?: string | null | undefined;
}

export interface ShimResult<T> {
  data: T | null;
  error: PgError | null;
}

const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`postgrestShim: refusing unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
};

/** `"id,name,owner_profile_id"` -> a column list. `*` stays `*`. */
function columnList(select: string): string {
  const cols = select
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (cols.length === 0 || (cols.length === 1 && cols[0] === "*")) return "*";
  for (const c of cols) {
    if (c.includes("(")) {
      throw new Error(
        `postgrestShim: embedded select ${JSON.stringify(c)} is not supported — ` +
          "add it explicitly rather than letting the shim approximate a join",
      );
    }
  }
  return cols.map(ident).join(", ");
}

type Cardinality = "many" | "maybeSingle" | "single";

/**
 * One PostgREST request, built up by chaining and issued when awaited. Mirrors
 * `supabase-js`: the builder IS the promise, so `await client.from(...)...` works
 * and a chain that is never awaited never touches the database.
 */
class ShimBuilder<T> implements PromiseLike<ShimResult<T>> {
  private verb: "select" | "insert" | "update" | "delete" = "select";
  private selectCols = "*";
  private returning: string | null = null;
  private rows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private filters: { col: string; value: unknown }[] = [];
  private orderBy: { col: string; ascending: boolean }[] = [];
  private limitN: number | null = null;
  private cardinality: Cardinality = "many";

  constructor(
    private readonly db: DbClient,
    private readonly sessionOf: () => ShimSession,
    private readonly table: string,
  ) {}

  select(cols = "*"): this {
    if (this.verb === "select") this.selectCols = cols;
    // `.insert(...).select(...)` / `.update(...).select(...)`: a RETURNING clause.
    else this.returning = cols;
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.verb = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    if (this.rows.length === 0) throw new Error("postgrestShim: insert with no rows");
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.verb = "update";
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.verb = "delete";
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push({ col, value });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  maybeSingle(): this {
    this.cardinality = "maybeSingle";
    return this;
  }

  single(): this {
    this.cardinality = "single";
    return this;
  }

  // ── unsupported surface: fail loudly rather than approximately ────────────
  in(): never {
    throw new Error("postgrestShim: .in() is not implemented");
  }
  upsert(): never {
    throw new Error("postgrestShim: .upsert() is not implemented");
  }

  private build(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const p = (v: unknown) => `$${params.push(v)}`;
    const t = ident(this.table);

    const where = () =>
      this.filters.length === 0
        ? ""
        : " WHERE " + this.filters.map((f) => `${ident(f.col)} = ${p(f.value)}`).join(" AND ");

    if (this.verb === "select") {
      let sql = `SELECT ${columnList(this.selectCols)} FROM ${t}${where()}`;
      if (this.orderBy.length > 0) {
        sql +=
          " ORDER BY " +
          this.orderBy.map((o) => `${ident(o.col)} ${o.ascending ? "ASC" : "DESC"}`).join(", ");
      }
      if (this.limitN !== null) sql += ` LIMIT ${p(this.limitN)}`;
      return { sql, params };
    }

    if (this.verb === "insert") {
      // Union of keys across rows, so a heterogeneous multi-row insert still
      // produces one well-formed statement (missing keys become DEFAULT).
      const cols = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      const tuples = this.rows.map(
        (r) => `(${cols.map((c) => (c in r ? p(r[c]) : "DEFAULT")).join(", ")})`,
      );
      let sql = `INSERT INTO ${t} (${cols.map(ident).join(", ")}) VALUES ${tuples.join(", ")}`;
      if (this.returning) sql += ` RETURNING ${columnList(this.returning)}`;
      return { sql, params };
    }

    if (this.verb === "update") {
      const cols = Object.keys(this.patch);
      if (cols.length === 0) throw new Error("postgrestShim: update with no columns");
      let sql = `UPDATE ${t} SET ${cols.map((c) => `${ident(c)} = ${p(this.patch[c])}`).join(", ")}`;
      sql += where();
      if (this.returning) sql += ` RETURNING ${columnList(this.returning)}`;
      return { sql, params };
    }

    let sql = `DELETE FROM ${t}${where()}`;
    if (this.returning) sql += ` RETURNING ${columnList(this.returning)}`;
    return { sql, params };
  }

  /**
   * Issue the request. ONE transaction under the acting role — the shape
   * PostgREST gives a single call, so DEFERRABLE guards fire at COMMIT and RLS
   * is evaluated as the signed-in user rather than the bootstrap superuser.
   */
  private async run(): Promise<ShimResult<T>> {
    const { sql, params } = this.build();
    let rows: Record<string, unknown>[];
    try {
      rows = await asAuthed(this.db, this.sessionOf(), async () => {
        const r = await this.db.query<Record<string, unknown>>(sql, params);
        return r.rows ?? [];
      });
    } catch (err) {
      const e = err as { message?: string; code?: string; detail?: string; hint?: string };
      return {
        data: null,
        error: {
          message: e?.message ?? String(err),
          code: e?.code,
          details: e?.detail ?? null,
          hint: e?.hint ?? null,
        },
      };
    }

    // A write with no `.select()` returns no body, exactly like PostgREST's
    // default `Prefer: return=minimal`.
    if (this.verb !== "select" && !this.returning) {
      return { data: null, error: null };
    }

    if (this.cardinality === "many") return { data: rows as unknown as T, error: null };

    // Cardinality collapse — see the fidelity note at the top of this file.
    if (rows.length === 1) return { data: rows[0] as unknown as T, error: null };

    if (this.cardinality === "maybeSingle") {
      if (rows.length === 0) return { data: null, error: null };
      return {
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
          hint: null,
        },
      };
    }

    return {
      data: null,
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
        hint: null,
      },
    };
  }

  then<R1 = ShimResult<T>, R2 = never>(
    onfulfilled?: ((value: ShimResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/**
 * The stand-in for `app/lib/supabase.ts`'s exported `supabase`. `signInAs` is the
 * test's "a real person signs in": it changes whose JWT `sub` every subsequent
 * request carries, so "no team in THIS season for THIS user" is a genuine RLS-era
 * query rather than a filter the test wrote for itself.
 */
export class PostgrestShim {
  private session: ShimSession = { role: "anon" };

  constructor(private readonly db: DbClient) {}

  from<T = unknown>(table: string): ShimBuilder<T> {
    return new ShimBuilder<T>(this.db, () => this.session, table);
  }

  rpc(): never {
    throw new Error("postgrestShim: .rpc() is not implemented");
  }

  signInAs(sub: string): void {
    this.session = { role: "authenticated", sub };
  }

  signOut(): void {
    this.session = { role: "anon" };
  }

  get currentSub(): string | undefined {
    return this.session.sub;
  }
}
