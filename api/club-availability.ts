import { createClient } from "@supabase/supabase-js";

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

const allowedStatuses = new Set([
  "not-asked", "silent", "maybe", "available", "unavailable", "selected",
]);
const cacheMs = 5 * 60_000;
let cachedFeed: { matches: unknown[]; until: number } | null = null;

function bearer(headers: Req["headers"]): string | null {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : null;
}

/** Read-only, authenticated proxy. The club key never reaches the browser. */
export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "GET") return void res.status(405).json({ error: "GET only" });

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const clubKey = process.env.CLUB_API_KEY;
  if (!supabaseUrl || !anonKey || !clubKey) {
    return void res.status(503).json({ error: "Club availability is not configured" });
  }

  const token = bearer(req.headers);
  if (!token) return void res.status(401).json({ error: "Sign in required" });
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return void res.status(401).json({ error: "Invalid session" });

  try {
    if (cachedFeed && cachedFeed.until > Date.now()) {
      return void res.status(200).json({ matches: cachedFeed.matches });
    }
    const upstream = await fetch("https://www.northshorecc.org.au/_functions/availability?days=30", {
      headers: { "x-app-key": clubKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) throw new Error(`Club endpoint returned ${upstream.status}`);
    const raw: unknown = await upstream.json();
    if (!Array.isArray(raw)) throw new Error("Club endpoint returned an invalid list");

    // Return only the fields needed by the app; never forward unrelated club data.
    const matches = raw.slice(0, 100).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.team !== "string" || typeof row.round !== "string" ||
          typeof row.opponent !== "string" || !Array.isArray(row.players)) return [];
      return [{
        team: row.team,
        round: row.round,
        opponent: row.opponent,
        players: row.players.slice(0, 100).flatMap((rawPlayer: unknown) => {
          if (!rawPlayer || typeof rawPlayer !== "object") return [];
          const player = rawPlayer as Record<string, unknown>;
          if (typeof player.playerId !== "string" || typeof player.name !== "string" ||
              typeof player.status !== "string" || !allowedStatuses.has(player.status)) return [];
          return [{
            playerId: player.playerId,
            name: player.name,
            status: player.status,
            role: typeof player.role === "string" ? player.role : null,
          }];
        }),
      }];
    });
    cachedFeed = { matches, until: Date.now() + cacheMs };
    res.status(200).json({ matches });
  } catch {
    res.status(502).json({ error: "Club availability is temporarily unavailable" });
  }
}
