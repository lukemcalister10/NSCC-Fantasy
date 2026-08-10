import { supabase } from "./supabase";
import type { LeagueConfig } from "../../src/config/types";

/**
 * THE TWO WRITES /admin/settings MAKES, and nothing else.
 *
 * Both go through the anon client, so both are authorised by RLS plus the trigger
 * stack (D16) — this file can only ever ASK. Every refusal it surfaces is the
 * database's answer reworded for a human; none is reimplemented here, because a
 * rule that lives in two places drifts.
 *
 * `.select()` on every write for the reason adminMutations.ts gives: under RLS an
 * UPDATE the policy excludes is a silent no-op, and asking for the affected rows
 * back turns "not permitted" into a visible failure instead of a false success.
 */

function rowsOrThrow(
  res: { data: unknown; error: { message: string } | null },
  what: string,
): unknown[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  const rows = (res.data ?? []) as unknown[];
  if (rows.length === 0) {
    throw new Error(`${what}: the database changed nothing — you may not have permission`);
  }
  return rows;
}

/** Turn a season-lock trigger message into something an operator can act on. */
export function explainLockError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/locking statement may not also change config/.test(message)) {
    return "Save your settings changes first, then lock. The locking statement is not allowed to change config as well, so that the cap you were shown in the preview is the cap that gets frozen.";
  }
  if (/is locked; config is immutable/.test(message)) {
    return "The season is locked. Settings, scoring rules and the computed cap are frozen and there is no unlock (G10).";
  }
  if (/is locked; locked_at cannot change/.test(message)) {
    return "The season is already locked. The lock is a one-way door — it cannot be moved or cleared (G10).";
  }
  if (/NULL starting_price|materialise/.test(message)) {
    return "One or more players have no starting price. Price every player in the registry first — an unpriced player would drop silently out of the mean the cap is computed from (Rider 3 / O3).";
  }
  if (/player pool is empty/.test(message)) {
    return "There are no players in the pool. The cap is team size × mean starting price, which is undefined over no players (O3).";
  }
  if (/cannot be removed from the pool/.test(message)) {
    return "The season is locked, so the pool cannot change — the cap was computed over the pool as it stood at lock. Set the player inactive instead.";
  }
  if (/cannot be removed:/.test(message)) {
    return message.replace(/^.*?cannot be removed:/, "This player cannot be removed:");
  }
  if (/row-level security/i.test(message)) {
    return "The database refused this write for your account. Only the league manager can change settings or lock the season.";
  }
  return message;
}

/**
 * Save the economy config. Pre-lock only — post-lock `trg_seasons_lock` refuses
 * it, which is the refusal that counts; the page also disables the inputs, which
 * is only chrome.
 *
 * The whole config object is written at once. It is a single jsonb column and the
 * engines load it verbatim (0001), so a partial write has no meaning: there is
 * one economy, saved or not saved.
 */
export async function saveSeasonConfig(seasonId: string, config: LeagueConfig) {
  return rowsOrThrow(
    await supabase.from("seasons").update({ config }).eq("id", seasonId).select("id"),
    "save settings",
  );
}

/**
 * FIRE THE SEASON LOCK. One statement, one column.
 *
 * It deliberately does NOT send config. Sending it would trip 0008's
 * same-statement guard — and that guard exists precisely so this function cannot
 * quietly freeze an economy different from the one the rehearsal preview showed.
 * The cap is not passed either: it is COMPUTED by the trigger from the pool at
 * this instant (O3/A7), which is the whole point of the action.
 *
 * There is no unlock, and no `unlockSeason` export. That absence is the feature.
 */
export async function fireSeasonLock(seasonId: string) {
  return rowsOrThrow(
    await supabase
      .from("seasons")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", seasonId)
      .select("id,locked_at,config"),
    "lock season",
  );
}

/**
 * Remove a registrant from the pool before lock (operator ruling, 10/08/2026).
 *
 * Why a DELETE rather than a flag: O3's cap is the mean over ALL players in the
 * pool, taken literally, so a withdrawn registrant sitting at the floor drags the
 * cap down. Rather than qualify O3's wording — which would change verified
 * arithmetic — the pool is made to contain only real registrants before locking.
 *
 * 0008 refuses this for any player with raw history (a lineup, a line, a
 * dismissal credit, a selection, a trade) and for any locked season, naming which
 * one blocks it. This function does not repeat those checks; it asks.
 */
export async function removePlayerFromPool(playerId: string) {
  return rowsOrThrow(
    await supabase.from("players").delete().eq("id", playerId).select("id"),
    "remove player",
  );
}
