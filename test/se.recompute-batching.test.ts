import { describe, expect, it } from "vitest";
import { readDerived, writeDerived, type DbClient } from "../src/db/repository.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import { buildOddSeason, SEASON } from "../scripts/oddSeasonScenario.js";

/**
 * C9 — RECOMPUTE LATENCY. The first live recompute ran up against the serverless
 * function's timeout. The cause was not the engine, which is pure and fast: it
 * was `writeDerived` issuing ONE INSERT ROUND-TRIP PER DERIVED ROW — every
 * player-match score, every price point, every cap snapshot, one at a time.
 *
 * That cost is invisible in this suite by construction: pglite runs in-process,
 * so a thousand round-trips are a thousand function calls and cost nothing. In
 * production the same thousand statements are a thousand network round-trips
 * from a serverless function to a pooler in another region, and THAT is what ran
 * out of time. A test that measured only wall-clock here would have stayed green
 * through the entire defect, so this one counts STATEMENTS instead — the quantity
 * that actually maps to latency in the place it hurts.
 *
 * What must not change is what gets written. Every assertion below pairs the
 * statement count with a row-for-row comparison, and G3 idempotence
 * (test/recompute.idempotence.test.ts) remains the real proof that batching
 * changed nothing about the derived state.
 */

/**
 * The scenario carries `__OWNER_A__`-style tokens the operator find-replaces in
 * the emitted SQL; seeding it directly needs real uuids in their place.
 */
function withRealOwners<T extends { fantasyTeams: { ownerProfileId: string }[] }>(raw: T): T {
  return {
    ...raw,
    fantasyTeams: raw.fantasyTeams.map((t, i) => ({
      ...t,
      ownerProfileId: `00000000-0000-0000-0000-0000000c9${i.toString().padStart(3, "0")}`,
    })),
  };
}

/** Records every statement so the write can be measured, not just believed. */
function counting(db: DbClient): { db: DbClient; log: string[] } {
  const log: string[] = [];
  return {
    log,
    db: {
      async query<T>(sql: string, params?: unknown[]) {
        log.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
        return db.query<T>(sql, params);
      },
    },
  };
}

const inserts = (log: string[]) => log.filter((s) => /^INSERT/i.test(s));

describe("C9 writeDerived batches its inserts", () => {
  it("writes a whole season in a handful of statements, not one per row", async () => {
    const db = await makeTestDb();
    const { raw, derived } = buildOddSeason();
    await seedSeason(db, withRealOwners(raw));

    const rowCount =
      derived.playerMatchScores.length +
      derived.priceHistory.length +
      derived.teamCapSnapshots.length +
      derived.teamRoundScores.length +
      derived.h2hResults.length +
      derived.ladder.length +
      derived.overallLeaderboard.length;

    // A scenario worth measuring: if this ever collapses to a handful of rows the
    // test would pass vacuously.
    expect(rowCount).toBeGreaterThan(50);

    const { db: counted, log } = counting(db);
    await writeDerived(counted, SEASON, derived);

    // Seven derived families, so seven INSERTs at this size — one per family.
    // The bound is stated as "at most one per family" rather than an exact number
    // so a family that legitimately has no rows (which emits nothing) does not
    // make this brittle.
    expect(inserts(log).length).toBeLessThanOrEqual(7);
    expect(inserts(log).length).toBeLessThan(rowCount / 5);
  }, 60_000);

  it("writes exactly the rows recompute produced, unchanged and in order", async () => {
    const db = await makeTestDb();
    const { raw, derived } = buildOddSeason();
    await seedSeason(db, withRealOwners(raw));

    await writeDerived(db, SEASON, derived);
    const back = await readDerived(db, SEASON);

    // The whole derived contract, byte-for-byte through the batched write.
    expect(back.playerMatchScores).toEqual(derived.playerMatchScores);
    expect(back.priceHistory).toEqual(derived.priceHistory);
    expect(back.teamCapSnapshots).toEqual(derived.teamCapSnapshots);
    expect(back.teamRoundScores).toEqual(derived.teamRoundScores);
    expect(back.h2hResults).toEqual(derived.h2hResults);
    expect(back.ladder).toEqual(derived.ladder);
    expect(back.overallLeaderboard).toEqual(derived.overallLeaderboard);
  }, 60_000);

  it("stays a clean replace: writing twice leaves one copy, not two", async () => {
    const db = await makeTestDb();
    const { raw, derived } = buildOddSeason();
    await seedSeason(db, withRealOwners(raw));

    await writeDerived(db, SEASON, derived);
    await writeDerived(db, SEASON, derived);
    const back = await readDerived(db, SEASON);

    expect(back.playerMatchScores).toEqual(derived.playerMatchScores);
    expect(back.priceHistory).toEqual(derived.priceHistory);
    expect(back.ladder).toEqual(derived.ladder);
  }, 60_000);

  it("an empty family writes no statement at all", async () => {
    const db = await makeTestDb();
    const { raw } = buildOddSeason();
    await seedSeason(db, withRealOwners(raw));

    const { db: counted, log } = counting(db);
    await writeDerived(counted, SEASON, {
      playerMatchScores: [],
      priceHistory: [],
      teamCapSnapshots: [],
      teamRoundScores: [],
      h2hResults: [],
      ladder: [],
      overallLeaderboard: [],
    });

    expect(inserts(log)).toEqual([]);
    // ...and the season is genuinely emptied, so "no statements" is not "no work".
    const back = await readDerived(db, SEASON);
    expect(back.playerMatchScores).toEqual([]);
    expect(back.ladder).toEqual([]);
  }, 60_000);
});
