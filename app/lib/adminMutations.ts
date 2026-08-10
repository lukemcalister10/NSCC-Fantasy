import { supabase } from "./supabase";
import { normaliseName } from "../../src/registry/nameNormalisation";
import type { PlayerRole } from "../../src/config/types";
import type {
  ScorecardBattingLine,
  ScorecardBowlingLine,
  ScorecardDismissal,
} from "./adminQueries";

/**
 * MANAGER-BACKEND WRITES. Every one goes through the anon client, so every one is
 * authorised by RLS + the trigger stack (D16) — this file can only ever ASK. The
 * refusals it surfaces (post-lock price/role edits per G10, frozen scorecards per
 * D24) are the database's answers, reworded for a human; none of them is
 * reimplemented here, because a rule that lives in two places drifts.
 *
 * WHY `.select()` ON EVERY WRITE: under RLS an UPDATE the policy excludes is a
 * silent no-op — zero rows, no error. Asking for the affected rows back turns
 * "not permitted" into a visible failure instead of a false success.
 *
 * Names are normalised here too (D22). The database normalises on write
 * regardless; doing it client-side as well means the operator SEES the canonical
 * form in the form they are filling, rather than discovering it after saving.
 */

function ok<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: the database returned nothing`);
  return res.data;
}

/** Rewrite a Postgres trigger message into something an operator can act on. */
export function explainWriteError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/frozen/i.test(message) && /D24/.test(message)) {
    return "This round's scorecards are frozen. Ending lockout is final — use the logged override if this is genuinely catastrophic.";
  }
  if (/starting_price\/role\/wk_eligible are frozen/.test(message)) {
    return "The season is locked: role, WK eligibility and starting price are frozen (D4/D9/G10). Names can still be corrected.";
  }
  if (/players_one_entry_per_name_per_season/.test(message)) {
    return "Another player in this season already has that name. Registry names must be unique so inbound scorecards can match them (D22).";
  }
  if (/row-level security/i.test(message)) {
    return "The database refused this write for your account. Only the league manager can change registry, rounds and scorecards.";
  }
  return message;
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface PlayerInput {
  displayName: string;
  role: PlayerRole;
  wkEligible: boolean;
  /** Omitted/NULL pre-lock is legal (prices materialise at lock, Rider 3); after
   *  lock the database defaults it to the config floor (C4 mid-season add). */
  startingPrice: number | null;
  active: boolean;
}

export async function createPlayer(seasonId: string, input: PlayerInput) {
  const name = normaliseName(input.displayName);
  return ok(
    await supabase
      .from("players")
      .insert({
        season_id: seasonId,
        registry_key: name,
        display_name: name,
        role: input.role,
        wk_eligible: input.wkEligible,
        starting_price: input.startingPrice,
        active: input.active,
      })
      .select("id")
      .single(),
    "add player",
  );
}

export async function updatePlayer(playerId: string, patch: Partial<PlayerInput>) {
  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    row["display_name"] = normaliseName(patch.displayName);
    row["registry_key"] = normaliseName(patch.displayName);
  }
  if (patch.role !== undefined) row["role"] = patch.role;
  if (patch.wkEligible !== undefined) row["wk_eligible"] = patch.wkEligible;
  if (patch.startingPrice !== undefined) row["starting_price"] = patch.startingPrice;
  if (patch.active !== undefined) row["active"] = patch.active;

  const rows = ok(
    await supabase.from("players").update(row).eq("id", playerId).select("id"),
    "save player",
  );
  if (rows.length === 0) {
    throw new Error("save player: the database changed nothing — you may not have permission");
  }
  return rows;
}

/** Bulk registry seed commit (D23). One insert; the whole batch lands or none does. */
export async function importPlayers(
  seasonId: string,
  rows: { name: string; role: PlayerRole; wkEligible: boolean; price: number }[],
) {
  return ok(
    await supabase
      .from("players")
      .insert(
        rows.map((r) => ({
          season_id: seasonId,
          registry_key: normaliseName(r.name),
          display_name: normaliseName(r.name),
          role: r.role,
          wk_eligible: r.wkEligible,
          starting_price: r.price,
          active: true,
        })),
      )
      .select("id"),
    "import registry",
  );
}

// ── Rounds and matches ──────────────────────────────────────────────────────

export interface RoundInput {
  seq: number;
  name: string;
  /** ISO instant. The UI proposes Sat 11:00 Adelaide; the value is STORED per
   *  round and never hardcoded anywhere (D6). */
  lockAt: string;
}

export async function createRound(seasonId: string, input: RoundInput) {
  return ok(
    await supabase
      .from("rounds")
      .insert({ season_id: seasonId, seq: input.seq, name: input.name, lock_at: input.lockAt })
      .select("id")
      .single(),
    "create round",
  );
}

export async function updateRound(roundId: string, patch: Partial<RoundInput>) {
  const row: Record<string, unknown> = {};
  if (patch.seq !== undefined) row["seq"] = patch.seq;
  if (patch.name !== undefined) row["name"] = patch.name;
  if (patch.lockAt !== undefined) row["lock_at"] = patch.lockAt;
  const rows = ok(
    await supabase.from("rounds").update(row).eq("id", roundId).select("id"),
    "save round",
  );
  if (rows.length === 0) throw new Error("save round: the database changed nothing");
  return rows;
}

/**
 * D24: end scorecard lockout for a round. One-way — the database refuses to clear
 * or move the mark afterwards, so the confirmation in the UI is the last chance.
 */
export async function freezeRoundScorecards(roundId: string) {
  const rows = ok(
    await supabase
      .from("rounds")
      .update({ scorecards_frozen_at: new Date().toISOString() })
      .eq("id", roundId)
      .select("id,scorecards_frozen_at"),
    "end lockout",
  );
  if (rows.length === 0) throw new Error("end lockout: the database changed nothing");
  return rows;
}

export interface MatchInput {
  roundId: string;
  grade: string;
  opponent: string;
  status: "scheduled" | "in_progress" | "finalised" | "abandoned";
  /** The match lands in the round containing its FINAL day (D5). */
  finalDayDate: string | null;
}

export async function createMatch(input: MatchInput) {
  return ok(
    await supabase
      .from("matches")
      .insert({
        round_id: input.roundId,
        grade: input.grade,
        opponent: input.opponent,
        status: input.status,
        final_day_date: input.finalDayDate,
        finalised_at: input.status === "finalised" ? new Date().toISOString() : null,
      })
      .select("id")
      .single(),
    "add match",
  );
}

export async function updateMatch(matchId: string, patch: Partial<MatchInput>) {
  const row: Record<string, unknown> = {};
  if (patch.roundId !== undefined) row["round_id"] = patch.roundId;
  if (patch.grade !== undefined) row["grade"] = patch.grade;
  if (patch.opponent !== undefined) row["opponent"] = patch.opponent;
  if (patch.finalDayDate !== undefined) row["final_day_date"] = patch.finalDayDate;
  if (patch.status !== undefined) {
    row["status"] = patch.status;
    // finalised_at is what the recompute orchestrator orders matches by within a
    // round, so it is stamped when the status says the match is done and cleared
    // when it is not — never left stale.
    row["finalised_at"] = patch.status === "finalised" ? new Date().toISOString() : null;
  }
  const rows = ok(
    await supabase.from("matches").update(row).eq("id", matchId).select("id"),
    "save match",
  );
  if (rows.length === 0) throw new Error("save match: the database changed nothing");
  return rows;
}

// ── Scorecard ───────────────────────────────────────────────────────────────

export interface ScorecardInput {
  matchId: string;
  wicketKeeperPlayerId: string | null;
  /** The named XI. Membership is what makes DNP a DECISION rather than an
   *  inference (D2/D3): a player in the lineup with no stats scored 0 and
   *  reprices; a player absent from it did not play and his price freezes. */
  lineup: string[];
  batting: ScorecardBattingLine[];
  bowling: ScorecardBowlingLine[];
  dismissals: ScorecardDismissal[];
}

/**
 * Save a whole scorecard: upsert the card, then replace each family.
 *
 * NOT ATOMIC, and honestly so — PostgREST gives a browser no transaction. The
 * consequence is bounded by design: a match only contributes to scores once its
 * status is `finalised`, so the intended order of work is enter-then-finalise,
 * and a half-saved card on a scheduled/in-progress match affects no derived
 * state. The form says as much, and the CLI/serverless recompute is the thing
 * that reads it afterwards.
 */
export async function saveScorecard(input: ScorecardInput) {
  const existing = await supabase
    .from("scorecards")
    .select("id")
    .eq("match_id", input.matchId)
    .limit(1);
  if (existing.error) throw new Error(`save scorecard: ${existing.error.message}`);

  const existingRows = (existing.data ?? []) as { id: string }[];
  let cardId = existingRows[0]?.id;
  if (cardId) {
    ok(
      await supabase
        .from("scorecards")
        .update({ wicket_keeper_player_id: input.wicketKeeperPlayerId })
        .eq("id", cardId)
        .select("id"),
      "save scorecard",
    );
  } else {
    const created = ok(
      await supabase
        .from("scorecards")
        .insert({
          match_id: input.matchId,
          wicket_keeper_player_id: input.wicketKeeperPlayerId,
          review_state: "committed",
        })
        .select("id")
        .single(),
      "create scorecard",
    );
    cardId = (created as unknown as { id: string }).id;
  }

  if (!cardId) throw new Error("save scorecard: the scorecard row could not be identified");
  const card = cardId;
  const wipe = async (table: string) => {
    const res = await supabase.from(table).delete().eq("scorecard_id", card);
    if (res.error) throw new Error(`save scorecard (${table}): ${res.error.message}`);
  };
  const put = async (table: string, rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return;
    const res = await supabase.from(table).insert(rows.map((r) => ({ ...r, scorecard_id: card })));
    if (res.error) throw new Error(`save scorecard (${table}): ${res.error.message}`);
  };

  await wipe("batting_lines");
  await wipe("bowling_lines");
  await wipe("dismissals");
  await wipe("scorecard_lineup");

  await put(
    "scorecard_lineup",
    input.lineup.map((player_id) => ({ player_id })),
  );
  await put("batting_lines", input.batting as unknown as Record<string, unknown>[]);
  await put("bowling_lines", input.bowling as unknown as Record<string, unknown>[]);
  await put("dismissals", input.dismissals as unknown as Record<string, unknown>[]);
}

// ── Recompute (server-side; see api/recompute.ts for why) ───────────────────

export interface RecomputeResult {
  changed: boolean;
  changedFamilies: string[];
  priceMovementsChanged: number;
  rounds: {
    roundId: string;
    name: string;
    seq: number;
    teamScores: { fantasyTeamId: string; before: number | null; after: number | null }[];
  }[];
  written: Record<string, number>;
}

/**
 * How a recompute failed, as a KIND rather than a string to be regex-matched by
 * the screen (C9). The first live run died silently against the function timeout
 * and the button simply sat there: a frozen control tells the operator nothing
 * about whether to wait, press again, or go and read a runbook. Each kind below
 * exists because it implies a DIFFERENT next action.
 */
export type RecomputeFailureKind =
  | "session" // the browser's own session went stale — sign in again
  | "refused" // the database says this account is not the league manager
  | "not-configured" // the deployment has no server credentials at all
  | "timeout" // no answer within the client's own budget
  | "gateway-timeout" // the platform killed the function mid-run
  | "network" // the request never completed
  | "engine" // the recompute itself threw — the message is the finding
  | "unknown";

export class RecomputeError extends Error {
  readonly kind: RecomputeFailureKind;
  /** What the operator should do next. Never "try again later" alone. */
  readonly guidance: string;
  /** True when the server may still be mid-write — see `guidance`. */
  readonly serverMayStillBeRunning: boolean;

  constructor(
    kind: RecomputeFailureKind,
    message: string,
    guidance: string,
    serverMayStillBeRunning = false,
  ) {
    super(message);
    this.name = "RecomputeError";
    this.kind = kind;
    this.guidance = guidance;
    this.serverMayStillBeRunning = serverMayStillBeRunning;
  }
}

/**
 * Client-side budget. The hosted function is capped at 60s (vercel.json), so a
 * platform 504 normally lands first and names the cause precisely; this is the
 * backstop for the case where nothing comes back at all, and it exists so the
 * button can never hang indefinitely.
 */
const RECOMPUTE_TIMEOUT_MS = 75_000;

/**
 * Ask the server to run a FULL-SEASON recompute. There is no partial pass: prices
 * are a chain, so no round can be rebuilt alone without re-deriving everything
 * after it, and writing a round-scoped engine entry point would fork the verified
 * recompute path. What is round-scoped is the SUMMARY that comes back.
 *
 * SAFE TO RETRY, ALWAYS. Recompute is a pure function of raw scorecards plus
 * frozen config (D15/G3) and `writeDerived` is one transaction, so a run that was
 * cut off either committed or left the previous derived state untouched. There is
 * no half-written outcome to repair, which is why the UI can offer Retry without
 * qualification.
 */
export async function requestRecompute(
  seasonId: string,
  opts: { timeoutMs?: number } = {},
): Promise<RecomputeResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new RecomputeError(
      "session",
      "your session has expired — sign in again",
      "Sign out and back in, then press Recompute again. Nothing was sent to the server.",
    );
  }

  const controller = new AbortController();
  const budget = opts.timeoutMs ?? RECOMPUTE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), budget);

  let res: Response;
  try {
    res = await fetch("/api/recompute", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ seasonId }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new RecomputeError(
        "timeout",
        `no answer from the server within ${Math.round(budget / 1000)}s`,
        "The run may still be finishing on the server. Wait a minute, reload this page, and check whether the derived data moved before pressing Retry — a second run is harmless either way (G3).",
        true,
      );
    }
    throw new RecomputeError(
      "network",
      err instanceof Error ? err.message : String(err),
      "The request did not reach the server. Check the connection and press Retry.",
    );
  } finally {
    clearTimeout(timer);
  }

  const payload: unknown = await res.json().catch(() => null);
  const serverMessage =
    payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : null;

  if (res.ok) return payload as RecomputeResult;

  switch (res.status) {
    case 401:
      throw new RecomputeError(
        "session",
        serverMessage ?? "session is not valid",
        "Sign out and back in, then press Retry.",
      );
    case 403:
      throw new RecomputeError(
        "refused",
        serverMessage ?? "league manager only",
        "The database refused this account (D16 — the manager role is enforced in Postgres, not here). Ask for the league-manager flag on your profile.",
      );
    case 503:
      throw new RecomputeError(
        "not-configured",
        serverMessage ?? "recompute is not configured on this deployment",
        "The deployment has no server credentials. Set them per MANAGER_VERIFY.md step 2 and redeploy — or run the recompute from the CLI, which uses the same runner.",
      );
    case 502:
    case 504:
      throw new RecomputeError(
        "gateway-timeout",
        serverMessage ?? `the recompute function was cut off (HTTP ${res.status})`,
        "The hosted function ran out of time before finishing. Nothing was half-written — the write is one transaction, so the previous derived state stands. Press Retry; if it times out repeatedly, run it from the CLI (MANAGER_VERIFY.md), which has no time limit.",
        true,
      );
    default:
      throw new RecomputeError(
        res.status === 500 ? "engine" : "unknown",
        serverMessage ?? `recompute failed (HTTP ${res.status})`,
        "The message above is the server's own, verbatim. Recompute refuses rather than writing a state it cannot justify, so the previous derived state is intact.",
      );
  }
}
