import { createClient } from "@supabase/supabase-js";
import { withPgClient } from "../src/db/pgClient.js";
import { runRecompute } from "../src/db/runRecompute.js";

/**
 * MANAGER RECOMPUTE CONTROL — server half (Vercel serverless function).
 *
 * WHY A SERVER AT ALL: the app is a static SPA holding the anon key, and
 * migration 0004 grants `authenticated` SELECT-only on every derived table. A
 * browser therefore CANNOT write derived state — deliberately, since derived
 * state is the engine's output and nobody else's. Pressing "recompute" has to
 * land somewhere with real credentials, and this is that somewhere.
 *
 * WHAT IT DOES NOT DO: any scoring, pricing or partial rebuild. It calls
 * `runRecompute`, which calls the existing verified path unchanged (G3).
 *
 * FAILS CLOSED, twice over:
 *   1. the caller must present a valid Supabase access token (verified against
 *      Supabase, not decoded locally — an unsigned or expired token is refused);
 *   2. that user must carry profiles.is_league_manager in the database.
 *   Either check missing, unreadable or false -> refused. There is no path where
 *   an absent check means "allow".
 *
 * SECRETS: the Postgres connection string is read from the environment and is
 * NEVER prefixed VITE_, so Vite cannot inline it into a browser bundle even by
 * accident; it is set directly in the hosting dashboard and appears in no
 * committed file. See MANAGER_VERIFY.md for the operator's setup steps.
 */

interface Req {
  method?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

const bearer = (h: Req["headers"]): string | null => {
  const raw = h["authorization"] ?? h["Authorization"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.toLowerCase().startsWith("bearer ")) return null;
  const token = value.slice(7).trim();
  return token === "" ? null : token;
};

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const connectionString = process.env.POSTGRES_URL;
  if (!supabaseUrl || !anonKey || !connectionString) {
    // Not configured is not "allowed": say so plainly and refuse.
    res.status(503).json({
      error:
        "recompute is not configured on this deployment (SUPABASE_URL / SUPABASE_ANON_KEY / POSTGRES_URL). See MANAGER_VERIFY.md.",
    });
    return;
  }

  const token = bearer(req.headers);
  if (!token) {
    res.status(401).json({ error: "sign in as the league manager" });
    return;
  }

  // 1. Who is this, according to Supabase?
  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) {
    res.status(401).json({ error: "session is not valid" });
    return;
  }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as
    | { seasonId?: unknown }
    | undefined;
  const seasonId = typeof body?.seasonId === "string" ? body.seasonId : null;
  if (!seasonId) {
    res.status(400).json({ error: "seasonId is required" });
    return;
  }

  try {
    const summary = await withPgClient(connectionString, async (db) => {
      // 2. Is this user the league manager, per the database (D16)?
      const { rows } = await db.query<{ is_league_manager: boolean }>(
        "SELECT is_league_manager FROM profiles WHERE id = $1",
        [userId],
      );
      if (rows[0]?.is_league_manager !== true) {
        throw new NotManager();
      }
      return runRecompute(db, seasonId);
    });
    res.status(200).json(summary);
  } catch (err) {
    if (err instanceof NotManager) {
      res.status(403).json({ error: "league manager only" });
      return;
    }
    // Recompute's own assertions (e.g. the Rider-2 price-integrity check) surface
    // here verbatim: a failed recompute must be loud and readable, never a
    // half-written derived state. writeDerived is transactional, so a throw
    // leaves the previous derived state intact.
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

class NotManager extends Error {}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
