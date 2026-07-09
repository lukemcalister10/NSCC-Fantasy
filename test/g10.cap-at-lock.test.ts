import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * G10-family (O3 / A7) — SALARY CAP COMPUTED AT SEASON LOCK. The season-lock
 * action (setting seasons.locked_at) does more than freeze the economy: once the
 * starting-price materialisation-completeness check passes (Rider 3, so the mean
 * is well-defined), the SAME action computes
 *
 *     cap = team_size × mean(starting_price over ALL players in the pool)
 *
 * rounded to nearest $100 (D4/G14, halves up), 1.0× with no headroom (O3 — stars
 * funded by basement filler, a knowing choice), and writes it into the season's
 * config jsonb. Enforced in enforce_season_lock() (0002_locks.sql).
 *
 * HAND-WORKED ARITHMETIC (the assertion below):
 *   Pool = 4 players, starting prices $50,000 / $9,000 / $9,000 / $9,100
 *     (one "star" plus three at/near the $9,000 floor — basement filler pulling
 *      the mean down, exactly the O3 dynamic).
 *     Σ starting_price = 50,000 + 9,000 + 9,000 + 9,100 = 77,100
 *     mean             = 77,100 / 4                       = 19,275
 *     team_size (fixture)                                 =      6
 *     raw cap          = 6 × 19,275                       = 115,650
 *     round to nearest $100, halves UP (D4/G14): 115,650 sits exactly on the
 *       $x50 boundary between 115,600 and 115,700 → rounds UP    = 115,700
 *   So the lock action must overwrite config.squad.cap with $115,700.
 */

const SEASON = "00000000-0000-0000-0000-0000000010f0";
const P1 = "00000000-0000-0000-0000-0000000010f1"; // star, $50,000
const P2 = "00000000-0000-0000-0000-0000000010f2"; // basement, $9,000 (floor)
const P3 = "00000000-0000-0000-0000-0000000010f3"; // basement, $9,000 (floor)
const P4 = "00000000-0000-0000-0000-0000000010f4"; // basement, $9,100

const EXPECTED_CAP = 115_700;
const PLACEHOLDER_CAP = FIXTURE_CONFIG.squad.cap; // $1,000,000 — clearly not 115,700

function buildRaw(): RawSeason {
  return {
    seasonId: SEASON,
    // Fixture config supplies team_size 6; its squad.cap ($1,000,000) is the
    // pre-lock PLACEHOLDER we prove the lock action overwrites.
    config: FIXTURE_CONFIG,
    players: [
      { id: P1, registryKey: "p1", displayName: "P1", role: "BAT", wkEligible: false, startingPrice: 50_000, active: true },
      { id: P2, registryKey: "p2", displayName: "P2", role: "BWL", wkEligible: false, startingPrice: 9_000, active: true },
      { id: P3, registryKey: "p3", displayName: "P3", role: "AR", wkEligible: false, startingPrice: 9_000, active: true },
      { id: P4, registryKey: "p4", displayName: "P4", role: "WK", wkEligible: true, startingPrice: 9_100, active: true },
    ],
    rounds: [],
    matches: [],
    scorecards: [],
    fantasyTeams: [],
    selections: [],
    trades: [],
  };
}

const capOf = async (db: DbClient): Promise<number> => {
  const { rows } = await db.query<{ cap: string }>(
    "SELECT (config #>> '{squad,cap}')::bigint AS cap FROM seasons WHERE id = $1",
    [SEASON],
  );
  return Number(rows[0]!.cap);
};

const lock = (db: DbClient) =>
  db.query("UPDATE seasons SET locked_at = now() WHERE id = $1", [SEASON]);

describe("G10 CAP_AT_LOCK — the lock action computes and writes the O3 cap", () => {
  it("writes cap = team_size × mean(starting_price), rounded nearest $100 (halves up)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());

    // Pre-lock: config still carries the tunable placeholder, not the computed cap.
    expect(await capOf(db)).toBe(PLACEHOLDER_CAP);
    expect(await capOf(db)).not.toBe(EXPECTED_CAP);

    // The lock action itself computes and writes the cap (same transition).
    await expect(lock(db)).resolves.toBeDefined();
    expect(await capOf(db)).toBe(EXPECTED_CAP); // $115,700 — see hand-worked arithmetic above
  });

  it("holds the computed cap as immutable as the rest of config post-lock", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await lock(db);
    expect(await capOf(db)).toBe(EXPECTED_CAP);

    // Post-lock, mutating the computed cap (a config field) is rejected exactly
    // like any other config mutation — it lives inside the frozen config jsonb.
    await expect(
      db.query(
        "UPDATE seasons SET config = jsonb_set(config, '{squad,cap}', '999999') WHERE id = $1",
        [SEASON],
      ),
    ).rejects.toThrow(/locked/);
    expect(await capOf(db)).toBe(EXPECTED_CAP); // unchanged
  });
});
