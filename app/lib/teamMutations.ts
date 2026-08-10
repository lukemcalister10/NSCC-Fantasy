import { supabase } from "./supabase";
import type { SelectionRow } from "./teamQueries";
import type { Holding } from "./squad";

/**
 * WRITE LAYER. Every write below goes through the anon-key client as the signed-in
 * user, so RLS (0004) decides WHO may write and the 0002/0003 triggers decide
 * WHEN and WHETHER. Nothing here bypasses anything: there is no service role in
 * the app, and G15 has no bypass GUC at all.
 *
 * ── ATOMICITY, STATED PLAINLY (operator decision 1, accepted gap) ────────────
 * PostgREST gives ONE transaction per request, and this slice may add no
 * migration — so an RPC that wraps "ledger write + selection write" in a single
 * transaction does not exist. Consequences, handled rather than hidden:
 *
 *   • The LEDGER IS AUTHORITATIVE. Holdings determine cap remaining, trade
 *     counts and the round's selection set. Reconciliation always rewrites
 *     selections to match the ledger, NEVER the reverse.
 *   • Writes are LEDGER-FIRST. The cap is the binding constraint, so a refusal
 *     lands before any selection row is touched.
 *   • A crash between the two halves is DETECTABLE (holdings ≠ selection set)
 *     and is surfaced on /team as a reconciliation banner with one-click repair.
 *
 * ── WHY SELECTIONS ARE NEVER PARTIALLY EDITED ───────────────────────────────
 * G15(a) judges the COMPLETE (team, round) set at COMMIT, so a bare DELETE of
 * one row from a full squad is itself a violation (size short). Every selection
 * write below therefore moves the set from one legal state to another in a
 * single request, or empties it entirely first (n = 0 is skipped by both
 * deferred triggers — "the team didn't field").
 */

// ---------------------------------------------------------------------------
// Server refusals, translated (never swallowed)
// ---------------------------------------------------------------------------

export interface Refusal {
  /** Plain-English reason naming the failing constraint. */
  reason: string;
  /** The decision / gate the refusal came from, for the report trail. */
  authority: string;
  /** The database's own message, shown verbatim so the refusal is provably server-side. */
  serverMessage: string;
}

/**
 * Map a Postgres error to a named constraint. The trigger messages are stable
 * (they carry their gate id), so this is a lookup, not a guess — and the raw
 * text is always kept alongside.
 */
export function translateRefusal(err: unknown): Refusal {
  const serverMessage =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  const m = serverMessage;

  if (/is locked \(lock_at/.test(m) || /\(G4\)/.test(m)) {
    return {
      reason:
        "That round has locked. Team changes and trades are refused once the round's lock time passes.",
      authority: "D6 / G4 round lock",
      serverMessage,
    };
  }
  if (/match in progress/i.test(m) || /\(D7\/G6\)/.test(m)) {
    return {
      reason:
        "That player's match has started and is not finalised — he can be neither bought nor sold until the match is finalised or abandoned.",
      authority: "D7 / G6 mid-match trade lock (both directions)",
      serverMessage,
    };
  }
  if (/team size must be/.test(m)) {
    return {
      reason: "Squad size is wrong — the selection must hold exactly the configured team size.",
      authority: "G15 selection validation (size)",
      serverMessage,
    };
  }
  if (/role minimum not met/.test(m)) {
    return {
      reason: "A role minimum is not met. Roles count strictly — a player fills only his own role's minimum.",
      authority: "G15 selection validation (role minimums, strict counting)",
      serverMessage,
    };
  }
  if (/WK minimum/.test(m)) {
    return {
      reason:
        "The wicket-keeper minimum is not satisfiable. A wk-eligible player who is needed to meet his own role's minimum cannot also keep wicket.",
      authority: "G15 / D9 (WK via wk_eligible, no double count)",
      serverMessage,
    };
  }
  if (/exceeds tradesPerRound/.test(m)) {
    return {
      reason: "That would exceed this round's trade limit.",
      authority: "G15 / O1 trades per round",
      serverMessage,
    };
  }
  if (/cap exceeded/.test(m)) {
    return {
      reason: "That would take the squad over the salary cap.",
      authority: "G15 / D8 cap ledger",
      serverMessage,
    };
  }
  if (/exactly one captain/.test(m)) {
    return {
      reason: "Every fielded squad must name exactly one captain.",
      authority: "Rider 1 (mandatory captain) / D10",
      serverMessage,
    };
  }
  if (/season .* is locked; fantasy-team registration is frozen/.test(m)) {
    return {
      reason: "The season is locked — fantasy-team registration is frozen.",
      authority: "D21 / G10 season lock",
      serverMessage,
    };
  }
  if (/config missing/.test(m)) {
    return {
      reason:
        "The season config is incomplete, so the database cannot validate this write. This is a setup problem, not a squad problem.",
      authority: "G15 partial-config guard",
      serverMessage,
    };
  }
  if (/violates foreign key constraint .*owner_profile/.test(m) || /profiles/.test(m)) {
    return {
      reason:
        "Your profile has not been provisioned yet, so a team cannot be registered against it. Ask the league manager.",
      authority: "0001 schema (fantasy_teams.owner_profile_id → profiles.id)",
      serverMessage,
    };
  }
  if (/permission denied|row-level security/i.test(m)) {
    return {
      reason: "The database refused this write for your account.",
      authority: "G13 / RLS (0004)",
      serverMessage,
    };
  }
  return {
    reason: "The database refused this write.",
    authority: "server-side enforcement",
    serverMessage,
  };
}

function throwOn(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/**
 * "These rows already exist" — Postgres 23505 against
 * `selections UNIQUE (fantasy_team_id, round_id, player_id)` (0001:162).
 *
 * This is a BENIGN outcome for carry-forward specifically, and only there. The
 * database is right to refuse a second copy of a selection set; what was wrong
 * was asking. When it happens the correct response is to re-read and carry on —
 * the round already holds exactly what the attempt was going to write — not to
 * accuse the participant of a refusal they did not cause (C7).
 *
 * It stays a REFUSAL everywhere else: an explicit captaincy change or a repair
 * that hits this has genuinely lost a race, and the participant needs to know.
 */
export function isAlreadyMaterialised(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /duplicate key value violates unique constraint/i.test(message);
}

// ---------------------------------------------------------------------------
// Team registration (pre-lock only — D21/G10 freezes the team set at lock)
// ---------------------------------------------------------------------------

export async function registerTeam(args: {
  seasonId: string;
  ownerProfileId: string;
  name: string;
}): Promise<void> {
  const { error } = await supabase.from("fantasy_teams").insert({
    season_id: args.seasonId,
    owner_profile_id: args.ownerProfileId,
    name: args.name.trim(),
  });
  throwOn(error);
}

// ---------------------------------------------------------------------------
// Ledger writes
// ---------------------------------------------------------------------------

export interface BuyIntent {
  playerId: string;
  /** MUST be the price entering `roundId` (Rider 2), not the latest price. */
  price: number;
}

/**
 * INITIAL SQUAD CONSTRUCTION. All founding buys go in ONE request, so the
 * deferred cap guard judges the complete ledger at COMMIT and a same-transaction
 * set is accepted or refused as a unit. Founding buys consume ZERO trades
 * (G15) — but they are still bound by size, composition and cap.
 */
export async function buildInitialSquad(args: {
  teamId: string;
  roundId: string;
  buys: BuyIntent[];
}): Promise<void> {
  const { error } = await supabase.from("trades").insert(
    args.buys.map((b) => ({
      fantasy_team_id: args.teamId,
      kind: "buy" as const,
      player_id: b.playerId,
      price: b.price,
      round_id: args.roundId,
    })),
  );
  throwOn(error);
}

/**
 * ONE TRADE = ONE SELL + ONE BUY PAIR, written as a single two-row insert so the
 * pair is one transaction: the sale funds the purchase regardless of row order,
 * exactly as the deferred cap guard expects (0003:155-160). A half-trade is
 * therefore not reachable through this path.
 *
 * Both prices are prices-entering-the-round (Rider 2).
 */
export async function executeTradePair(args: {
  teamId: string;
  roundId: string;
  sell: BuyIntent;
  buy: BuyIntent;
}): Promise<void> {
  const { error } = await supabase.from("trades").insert([
    {
      fantasy_team_id: args.teamId,
      kind: "sell" as const,
      player_id: args.sell.playerId,
      price: args.sell.price,
      round_id: args.roundId,
    },
    {
      fantasy_team_id: args.teamId,
      kind: "buy" as const,
      player_id: args.buy.playerId,
      price: args.buy.price,
      round_id: args.roundId,
    },
  ]);
  throwOn(error);
}

// ---------------------------------------------------------------------------
// Selection materialisation (holdings → the round's selection set)
// ---------------------------------------------------------------------------

export interface Captaincy {
  captainId: string;
  viceCaptainId: string | null;
}

/**
 * Carry-forward captaincy (operator ruling: a participant who does nothing all
 * week fields their full squad with their existing captaincy).
 *
 * Preference order, each candidate filtered to CURRENT holdings:
 *   1. this round's existing captain / vice
 *   2. the most recent earlier round's captain / vice
 *   3. a deterministic fallback (dearest holding), so the mandatory-captain
 *      invariant (Rider 1) can always be satisfied without asking the participant.
 */
export function resolveCaptaincy(args: {
  holdings: Holding[];
  thisRound: SelectionRow[];
  priorRound: SelectionRow[];
  priceOf: (playerId: string) => number;
}): Captaincy | null {
  const held = new Set(args.holdings.map((h) => h.playerId));
  if (held.size === 0) return null;

  const pick = (rows: SelectionRow[], flag: "is_captain" | "is_vice_captain") =>
    rows.find((r) => r[flag] && held.has(r.player_id))?.player_id ?? null;

  const byPrice = [...held].sort(
    (a, b) => args.priceOf(b) - args.priceOf(a) || (a < b ? -1 : 1),
  );

  const captainId =
    pick(args.thisRound, "is_captain") ??
    pick(args.priorRound, "is_captain") ??
    pick(args.priorRound, "is_vice_captain") ??
    byPrice[0]!;

  const viceCandidate =
    pick(args.thisRound, "is_vice_captain") ?? pick(args.priorRound, "is_vice_captain");
  const viceCaptainId =
    viceCandidate && viceCandidate !== captainId
      ? viceCandidate
      : (byPrice.find((p) => p !== captainId) ?? null);

  return { captainId, viceCaptainId };
}

interface DesiredRow {
  id?: string;
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
}

/**
 * Bind desired players to existing selection rows WITHOUT ever letting two rows
 * hold the same player mid-statement. Rows whose player is still held keep their
 * identity; rows whose player was sold are re-pointed at newly bought players,
 * which by definition are not already in the set — so `UNIQUE (team, round,
 * player)` cannot trip part-way through a multi-row upsert.
 */
function bindRows(
  existing: SelectionRow[],
  desiredPlayers: string[],
  captaincy: Captaincy,
): DesiredRow[] {
  const desired = new Set(desiredPlayers);
  const kept = existing.filter((r) => desired.has(r.player_id));
  const free = existing.filter((r) => !desired.has(r.player_id));
  const keptPlayers = new Set(kept.map((r) => r.player_id));
  const incoming = desiredPlayers.filter((p) => !keptPlayers.has(p));

  const rows: DesiredRow[] = kept.map((r) => ({
    id: r.id,
    player_id: r.player_id,
    is_captain: r.player_id === captaincy.captainId,
    is_vice_captain: r.player_id === captaincy.viceCaptainId,
  }));
  incoming.forEach((playerId, i) => {
    const row = free[i];
    rows.push({
      ...(row ? { id: row.id } : {}),
      player_id: playerId,
      is_captain: playerId === captaincy.captainId,
      is_vice_captain: playerId === captaincy.viceCaptainId,
    });
  });
  return rows;
}

/**
 * Materialise / reconcile the round's selection set FROM HOLDINGS.
 *
 * There is no bench and no emergency mechanic (operator ruling): a participant's
 * round selection IS their holdings, always, with no per-round choice to make.
 * So this is never a prompt — it runs from the ledger.
 *
 * Three paths, each leaving a legal set at every COMMIT:
 *   • no rows yet  → one INSERT of the whole set
 *   • size differs → DELETE all (n = 0, skipped by both deferred triggers),
 *                    then INSERT the whole set
 *   • size matches → one UPSERT re-pointing changed slots
 *
 * CAPTAINCY TRANSITIONS need care: `one_captain_per_team_round` and
 * `one_vice_captain_per_team_round` are IMMEDIATE partial unique indexes, while
 * "exactly one captain" is a DEFERRED trigger. A straight captain↔vice swap
 * cannot be expressed in one multi-row statement in either order without
 * momentarily doubling a flag. It is therefore written in two steps whose
 * INTERMEDIATE state is legal: first the new captain with NO vice anywhere
 * (exactly one captain — the deferred guard is satisfied; a vice is optional),
 * then the vice. Clearing rows are ordered before setting rows so the immediate
 * indexes never see two captains.
 */
export async function syncSelectionsToHoldings(args: {
  teamId: string;
  roundId: string;
  holdings: Holding[];
  existing: SelectionRow[];
  captaincy: Captaincy;
}): Promise<void> {
  const { teamId, roundId, holdings, existing, captaincy } = args;
  const desiredPlayers = holdings.map((h) => h.playerId);

  if (desiredPlayers.length === 0) return; // holding nobody: nothing to field

  const base = { fantasy_team_id: teamId, round_id: roundId };

  // ---- no rows yet: one insert, flags final (no pre-existing captain) ----
  if (existing.length === 0) {
    const { error } = await supabase.from("selections").insert(
      desiredPlayers.map((playerId) => ({
        ...base,
        player_id: playerId,
        is_captain: playerId === captaincy.captainId,
        is_vice_captain: playerId === captaincy.viceCaptainId,
      })),
    );
    throwOn(error);
    return;
  }

  // ---- size differs: empty the set, then rebuild it ----
  if (existing.length !== desiredPlayers.length) {
    const del = await supabase
      .from("selections")
      .delete()
      .eq("fantasy_team_id", teamId)
      .eq("round_id", roundId);
    throwOn(del.error);
    const { error } = await supabase.from("selections").insert(
      desiredPlayers.map((playerId) => ({
        ...base,
        player_id: playerId,
        is_captain: playerId === captaincy.captainId,
        is_vice_captain: playerId === captaincy.viceCaptainId,
      })),
    );
    throwOn(error);
    return;
  }

  // ---- same size: re-point changed slots, and move captaincy safely ----
  const rows = bindRows(existing, desiredPlayers, captaincy);
  const unchangedFlags = rows.every((r) => {
    const prev = existing.find((e) => e.id === r.id);
    return (
      prev &&
      prev.is_captain === r.is_captain &&
      prev.is_vice_captain === r.is_vice_captain
    );
  });

  if (unchangedFlags) {
    const { error } = await supabase
      .from("selections")
      .upsert(rows.map((r) => ({ ...base, ...r })), { onConflict: "id" });
    throwOn(error);
    return;
  }

  // Phase 1 — final players, final captain, NO vice anywhere. Rows that CLEAR
  // the captain flag are written before the row that SETS it, so the immediate
  // unique index never sees two captains.
  const phase1 = rows
    .map((r) => ({ ...base, ...r, is_vice_captain: false }))
    .sort((a, b) => Number(a.is_captain) - Number(b.is_captain));
  const up1 = await supabase.from("selections").upsert(phase1, { onConflict: "id" });
  throwOn(up1.error);

  // Phase 2 — the vice (optional; no vice at all is legal).
  if (captaincy.viceCaptainId) {
    const viceRow = rows.find((r) => r.player_id === captaincy.viceCaptainId);
    if (viceRow?.id) {
      const up2 = await supabase
        .from("selections")
        .update({ is_vice_captain: true })
        .eq("id", viceRow.id);
      throwOn(up2.error);
    }
  }
}

/** Explicit captain / vice change (D10). Same two-phase safety as above. */
export async function setCaptaincy(args: {
  teamId: string;
  roundId: string;
  holdings: Holding[];
  existing: SelectionRow[];
  captaincy: Captaincy;
}): Promise<void> {
  return syncSelectionsToHoldings(args);
}
