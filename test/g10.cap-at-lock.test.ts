import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * G10 salary-cap invariant: the cap advertised while teams are built is the cap
 * frozen at season lock. Exceptional late player prices must not move it.
 */

const SEASON = "00000000-0000-0000-0000-0000000010f0";
const P1 = "00000000-0000-0000-0000-0000000010f1"; // star, $50,000
const P2 = "00000000-0000-0000-0000-0000000010f2"; // basement, $9,000 (floor)
const P3 = "00000000-0000-0000-0000-0000000010f3"; // basement, $9,000 (floor)
const P4 = "00000000-0000-0000-0000-0000000010f4"; // basement, $9,100

const EXPECTED_CAP = FIXTURE_CONFIG.squad.cap;

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

describe("G10 CAP_AT_LOCK — the lock freezes the configured cap", () => {
  it("preserves the configured cap despite exceptional player prices", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());

    expect(await capOf(db)).toBe(EXPECTED_CAP);
    await expect(lock(db)).resolves.toBeDefined();
    expect(await capOf(db)).toBe(EXPECTED_CAP);
  });

  it("holds the configured cap as immutable as the rest of config post-lock", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await lock(db);
    expect(await capOf(db)).toBe(EXPECTED_CAP);

    // Post-lock, mutating the cap (a config field) is rejected exactly
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
