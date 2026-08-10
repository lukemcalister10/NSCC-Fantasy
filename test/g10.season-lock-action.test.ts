import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason, asAuthed } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";
import {
  LOCK_CATEGORIES,
  isConfigEditable,
  isPlayerEconomyEditable,
  isRegistrationOpen,
} from "../app/lib/seasonLock.js";

/**
 * G10 SEASON LOCK, AS AN OPERATOR ACTION — ONE PROOF PER FROZEN CATEGORY.
 *
 * The existing G10 files prove the lock's enforcement as the SUPERUSER. This one
 * proves it for the role that actually fires it: a signed-in league manager, via
 * `asAuthed` (SET LOCAL ROLE authenticated + a JWT `sub`, exactly how PostgREST
 * serves a request), with no UI in the loop and no bypass GUC set. A manager is
 * the most privileged client that exists — if the freeze holds against them it
 * holds against everyone.
 *
 * EACH CATEGORY IS PROVED TWICE OVER, and both halves matter:
 *
 *   PRE-LOCK the same write must SUCCEED. A "post-lock rejection" proves nothing
 *   if the write was impossible all along — it would pass just as well against a
 *   typo in the SQL. So every case writes, succeeds, locks, writes again, and is
 *   refused.
 *
 *   THE UI PREDICATE must agree. `app/lib/seasonLock.ts` exports the predicates
 *   that grey out each control; they are asserted here beside the database's
 *   answer. The UI is not the boundary (D16) and this test does not pretend it
 *   is — it checks that the chrome and the gatekeeper say the same thing, so the
 *   operator is never told "yes" by a screen the database will then refuse.
 *
 * The case table is driven from LOCK_CATEGORIES, so a category added to the
 * settings page without a proof here fails the coverage assertion at the bottom.
 * The rendering itself has no test — this repo has no DOM harness — and that is
 * stated rather than implied: the screens are operator-verified per
 * MANAGER_VERIFY.md §Season lock.
 */

const SEASON = "00000000-0000-0000-0000-00000000e000";
const MANAGER = "00000000-0000-0000-0000-00000000e0a0";
const OWNER = "00000000-0000-0000-0000-00000000e0a1";
const NEWOWNER = "00000000-0000-0000-0000-00000000e0a2";
const FT = "00000000-0000-0000-0000-00000000e0b0";
const NEWFT = "00000000-0000-0000-0000-00000000e0b1";
const P1 = "00000000-0000-0000-0000-00000000e0d1"; // BAT, not wk_eligible
const P2 = "00000000-0000-0000-0000-00000000e0d2";

function buildRaw(): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: P1, registryKey: "p1", displayName: "P1", role: "BAT", wkEligible: false, startingPrice: 50_000, active: true },
      { id: P2, registryKey: "p2", displayName: "P2", role: "BWL", wkEligible: false, startingPrice: 30_000, active: true },
    ],
    rounds: [],
    matches: [],
    scorecards: [],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: [],
    trades: [],
  };
}

/** A season seeded with a real league-manager profile to act as. */
async function seededDb(): Promise<DbClient> {
  const db = await makeTestDb();
  await seedSeason(db, buildRaw());
  await db.query(
    "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'manager',true)",
    [MANAGER],
  );
  await db.query(
    "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'newcomer',false)",
    [NEWOWNER],
  );
  return db;
}

/** Do this as the signed-in league manager, in one transaction, under RLS. */
const asManager = <T>(db: DbClient, fn: () => Promise<T>) =>
  asAuthed(db, { role: "authenticated", sub: MANAGER }, fn);

interface Case {
  /** Must match a LOCK_CATEGORIES key. */
  key: string;
  /** The UI predicate that greys this control out, given the lock state. */
  uiEditable: (lockedAt: string | null) => boolean;
  /** A legal pre-lock write. */
  before: (db: DbClient) => Promise<unknown>;
  /** The same kind of write, attempted after the lock. */
  after: (db: DbClient) => Promise<unknown>;
}

const setConfig = (path: string, value: string) => (db: DbClient) =>
  db.query(`UPDATE seasons SET config = jsonb_set(config, '${path}', '${value}') WHERE id = $1`, [
    SEASON,
  ]);

const CASES: Case[] = [
  {
    key: "league-settings",
    uiEditable: isConfigEditable,
    before: setConfig("{squad,teamSize}", "5"),
    after: setConfig("{squad,teamSize}", "9"),
  },
  {
    key: "scoring",
    uiEditable: isConfigEditable,
    before: setConfig("{scoring,perRun}", "2"),
    after: setConfig("{scoring,perRun}", "3"),
  },
  {
    key: "starting-prices",
    uiEditable: isPlayerEconomyEditable,
    before: (db) => db.query("UPDATE players SET starting_price = 51000 WHERE id = $1", [P1]),
    after: (db) => db.query("UPDATE players SET starting_price = 99000 WHERE id = $1", [P1]),
  },
  {
    key: "roles",
    uiEditable: isPlayerEconomyEditable,
    before: (db) => db.query("UPDATE players SET role = 'AR' WHERE id = $1", [P1]),
    after: (db) => db.query("UPDATE players SET role = 'WK' WHERE id = $1", [P1]),
  },
  {
    key: "wk-eligible",
    uiEditable: isPlayerEconomyEditable,
    before: (db) => db.query("UPDATE players SET wk_eligible = true WHERE id = $1", [P1]),
    after: (db) => db.query("UPDATE players SET wk_eligible = false WHERE id = $1", [P1]),
  },
  {
    key: "alpha",
    uiEditable: isConfigEditable,
    before: setConfig("{pricing,alpha}", "0.3"),
    after: setConfig("{pricing,alpha}", "0.5"),
  },
  {
    key: "floor",
    uiEditable: isConfigEditable,
    before: setConfig("{pricing,floor}", "8000"),
    after: setConfig("{pricing,floor}", "1000"),
  },
  {
    key: "dollars-per-point",
    uiEditable: isConfigEditable,
    before: setConfig("{pricing,dollarsPerPoint}", "1500"),
    after: setConfig("{pricing,dollarsPerPoint}", "2000"),
  },
  {
    key: "trades-per-round",
    uiEditable: isConfigEditable,
    before: setConfig("{squad,tradesPerRound}", "3"),
    after: setConfig("{squad,tradesPerRound}", "5"),
  },
  {
    key: "team-registration",
    uiEditable: isRegistrationOpen,
    before: (db) =>
      db.query(
        "INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'pre')",
        [NEWFT, SEASON, NEWOWNER],
      ),
    // Post-lock the row already exists, so registration is re-attempted as the
    // DELETE half of D21 — deregistration changes the team set just as much.
    after: (db) => db.query("DELETE FROM fantasy_teams WHERE id = $1", [NEWFT]),
  },
];

const labelOf = (key: string) =>
  LOCK_CATEGORIES.find((c) => c.key === key)?.label ?? `(unknown category ${key})`;

describe("G10 — every frozen category, as a signed-in league manager", () => {
  for (const c of CASES) {
    it(
      `${labelOf(c.key)}: editable pre-lock, refused post-lock`,
      async () => {
        const db = await seededDb();

        // The UI would offer this control before the lock…
        expect(c.uiEditable(null)).toBe(true);
        // …and the database agrees: the write lands.
        await expect(asManager(db, () => c.before(db))).resolves.toBeDefined();

        // Fire the lock the way the settings page does: one column, nothing else.
        await expect(
          asManager(db, () =>
            db.query("UPDATE seasons SET locked_at = now() WHERE id = $1", [SEASON]),
          ),
        ).resolves.toBeDefined();

        // The UI would now grey the control out…
        expect(c.uiEditable("2026-08-10T00:00:00Z")).toBe(false);
        // …and the refusal that counts is the database's, on a direct write.
        await expect(asManager(db, () => c.after(db))).rejects.toThrow(/locked|frozen/i);
      },
      60_000,
    );
  }

  it("covers every category the settings page claims the lock freezes", () => {
    expect(CASES.map((c) => c.key).sort()).toEqual(LOCK_CATEGORIES.map((c) => c.key).sort());
  });
});

describe("G10 — the lock action itself", () => {
  it("refuses a statement that locks AND edits config in one go", async () => {
    const db = await seededDb();
    // This would compute the cap from a team size the rehearsal preview never
    // showed, quietly breaking "what you rehearsed is what you locked".
    await expect(
      asManager(db, () =>
        db.query(
          "UPDATE seasons SET config = jsonb_set(config, '{squad,teamSize}', '11'), locked_at = now() WHERE id = $1",
          [SEASON],
        ),
      ),
    ).rejects.toThrow(/may not also change config/);

    // …and the season is still unlocked, so the operator can save then lock.
    const { rows } = await db.query<{ locked_at: string | null }>(
      "SELECT locked_at FROM seasons WHERE id = $1",
      [SEASON],
    );
    expect(rows[0]!.locked_at).toBeNull();
  }, 60_000);

  it("is one-way: a manager cannot clear or move locked_at", async () => {
    const db = await seededDb();
    await asManager(db, () =>
      db.query("UPDATE seasons SET locked_at = now() WHERE id = $1", [SEASON]),
    );
    await expect(
      asManager(db, () => db.query("UPDATE seasons SET locked_at = NULL WHERE id = $1", [SEASON])),
    ).rejects.toThrow(/locked_at cannot change/);
    await expect(
      asManager(db, () =>
        db.query("UPDATE seasons SET locked_at = now() + interval '1 day' WHERE id = $1", [SEASON]),
      ),
    ).rejects.toThrow(/locked_at cannot change/);
  }, 60_000);

  it("still allows a mid-season player addition, which does not move the frozen cap (C4/O3)", async () => {
    const db = await seededDb();
    await asManager(db, () =>
      db.query("UPDATE seasons SET locked_at = now() WHERE id = $1", [SEASON]),
    );
    const capBefore = await capOf(db);
    await expect(
      asManager(db, () =>
        db.query(
          `INSERT INTO players (season_id, registry_key, display_name, role, wk_eligible, active)
           VALUES ($1,'late','Late Joiner','BAT',false,true)`,
          [SEASON],
        ),
      ),
    ).resolves.toBeDefined();
    expect(await capOf(db)).toBe(capBefore);
  }, 60_000);
});

async function capOf(db: DbClient): Promise<number> {
  const { rows } = await db.query<{ cap: string }>(
    "SELECT (config #>> '{squad,cap}')::bigint AS cap FROM seasons WHERE id = $1",
    [SEASON],
  );
  return Number(rows[0]!.cap);
}
