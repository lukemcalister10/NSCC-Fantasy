import { describe, it, expect, beforeAll } from "vitest";
import { makeTestDb, asAuthed } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";

/**
 * PLAYER REGISTRY under season lock (D4 / D9 / D13, gate G10) and MID-SEASON
 * ADDITION (C4), proven by DIRECT database writes as an authenticated league
 * manager — the "via direct API call" half of this slice's definition of done.
 * The admin UI surfaces these same refusals as disabled controls and a plain
 * message; the database is what makes them true (D16).
 *
 * G10 is already VERIFIED and is NOT re-earned here: these are non-regression
 * probes over the registry paths this slice newly exposes to a UI, plus the C4
 * behaviour that had no surface before.
 *
 * Names invented (D17/Law 11).
 */

const SEASON = "5ea50000-0000-4000-8000-000000100001";
const MANAGER = "0000a000-0000-4000-8000-000000100001";
const PARTICIPANT = "0000a000-0000-4000-8000-000000100002";
const JO = "71a70000-0000-4000-8000-000000100001";
const PRIYA = "71a70000-0000-4000-8000-000000100002";

const managerCtx = { role: "authenticated", sub: MANAGER } as const;
const participantCtx = { role: "authenticated", sub: PARTICIPANT } as const;

describe("registry — pre-lock edits, post-lock refusals, mid-season adds", () => {
  let db: DbClient;

  beforeAll(async () => {
    db = await makeTestDb();
    await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
      SEASON,
      "registry season",
      JSON.stringify(FIXTURE_CONFIG),
    ]);
    await db.query(
      "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'The Manager',true), ($2,'A Participant',false)",
      [MANAGER, PARTICIPANT],
    );
    for (const [id, name, role, price] of [
      [JO, "Jo Whitlam", "BAT", 60_000],
      [PRIYA, "Priya Raman", "BWL", 35_000],
    ] as const) {
      await db.query(
        `INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
         VALUES ($1,$2,$3,$3,$4,false,$5,true)`,
        [id, SEASON, name, role, price],
      );
    }
  }, 120_000);

  it("PRE-lock: the manager may edit role and price, and every edit is logged", async () => {
    await asAuthed(db, managerCtx, async () => {
      await db.query(
        "UPDATE players SET role = 'AR', starting_price = 72000 WHERE id = $1",
        [JO],
      );
    });

    const { rows } = await db.query<{ role: string; starting_price: number }>(
      "SELECT role, starting_price FROM players WHERE id = $1",
      [JO],
    );
    expect(rows[0]).toEqual({ role: "AR", starting_price: 72_000 });

    const log = await db.query<{ event: string; actor: string; detail: Record<string, unknown> }>(
      "SELECT event, actor, detail FROM player_registry_events WHERE player_id = $1 AND event = 'update'",
      [JO],
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]!.actor).toBe(MANAGER);
    expect(log.rows[0]!.detail).toEqual({
      role: { from: "BAT", to: "AR" },
      starting_price: { from: 60_000, to: 72_000 },
    });
  });

  it("a participant cannot touch the registry at all (RLS, not the UI)", async () => {
    // NOTE the asymmetry, which is Postgres behaviour and not a weakness: an
    // UPDATE the RLS policy excludes is a silent NO-OP (the row is simply not
    // visible to update), whereas a disallowed INSERT raises. The row is
    // unchanged either way — but a client must therefore confirm an update by
    // what came back, never by the absence of an error. The admin mutations do
    // exactly that (`.select()` on every write).
    await asAuthed(db, participantCtx, () =>
      db.query("UPDATE players SET starting_price = 1 WHERE id = $1", [JO]),
    );
    const untouched = await db.query<{ starting_price: number }>(
      "SELECT starting_price FROM players WHERE id = $1",
      [JO],
    );
    expect(untouched.rows[0]!.starting_price).toBe(72_000);

    await expect(
      asAuthed(db, participantCtx, () =>
        db.query(
          `INSERT INTO players (season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
           VALUES ($1,'Sneaky Entry','Sneaky Entry','BAT',false,9000,true)`,
          [SEASON],
        ),
      ),
    ).rejects.toThrow();

    // ...and cannot read the edit history either.
    const seen = await asAuthed(db, participantCtx, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM player_registry_events"),
    );
    expect(seen.rows[0]!.n).toBe(0);
  });

  it("the season locks, computing the cap over the pool (O3, unchanged behaviour)", async () => {
    await asAuthed(db, managerCtx, async () => {
      await db.query("UPDATE seasons SET locked_at = now() WHERE id = $1", [SEASON]);
    });
    const { rows } = await db.query<{ cap: string; locked: string }>(
      "SELECT config #>> '{squad,cap}' AS cap, locked_at AS locked FROM seasons WHERE id = $1",
      [SEASON],
    );
    // teamSize 6 × mean(72,000, 35,000) = 6 × 53,500 = $321,000.
    expect(rows[0]!.cap).toBe("321000");
    expect(rows[0]!.locked).toBeTruthy();
  });

  it("POST-lock: price, role and wk_eligible edits are refused — direct to the database", async () => {
    for (const [what, sql, params] of [
      ["price", "UPDATE players SET starting_price = 1 WHERE id = $1", [JO]],
      ["role", "UPDATE players SET role = 'WK' WHERE id = $1", [JO]],
      ["wk_eligible", "UPDATE players SET wk_eligible = true WHERE id = $1", [JO]],
    ] as const) {
      await expect(
        asAuthed(db, managerCtx, () => db.query(sql, [...params])),
        `expected refusal: ${what}`,
      ).rejects.toThrow(/frozen/);
    }

    const { rows } = await db.query<{ role: string; starting_price: number; wk: boolean }>(
      "SELECT role, starting_price, wk_eligible AS wk FROM players WHERE id = $1",
      [JO],
    );
    expect(rows[0]).toEqual({ role: "AR", starting_price: 72_000, wk: false });
  });

  it("POST-lock: a name correction is still allowed (D22 is not economy config)", async () => {
    await asAuthed(db, managerCtx, async () => {
      await db.query("UPDATE players SET display_name = 'Jo Whitlam-Reid' WHERE id = $1", [JO]);
    });
    const { rows } = await db.query<{ display_name: string }>(
      "SELECT display_name FROM players WHERE id = $1",
      [JO],
    );
    expect(rows[0]!.display_name).toBe("Jo Whitlam-Reid");
  });

  it("MID-SEASON ADD (C4): priced at the config floor by default, logged, cap untouched", async () => {
    const capBefore = await db.query<{ cap: string }>(
      "SELECT config #>> '{squad,cap}' AS cap FROM seasons WHERE id = $1",
      [SEASON],
    );

    await asAuthed(db, managerCtx, async () => {
      await db.query(
        `INSERT INTO players (season_id, registry_key, display_name, role, wk_eligible, active)
         VALUES ($1,'Tomas Reiner','Tomas Reiner','BWL',false,true)`,
        [SEASON],
      );
    });

    const added = await db.query<{ id: string; starting_price: number }>(
      "SELECT id, starting_price FROM players WHERE season_id = $1 AND display_name = 'Tomas Reiner'",
      [SEASON],
    );
    // The FIXTURE floor ($9,000 here); the season economy's O6 floor in production.
    // Read from the frozen config, never a constant in the migration (G11).
    expect(added.rows[0]!.starting_price).toBe(FIXTURE_CONFIG.pricing.floor);

    const log = await db.query<{ event: string; actor: string; detail: { mid_season: boolean } }>(
      "SELECT event, actor, detail FROM player_registry_events WHERE player_id = $1",
      [added.rows[0]!.id],
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]!.event).toBe("create");
    expect(log.rows[0]!.actor).toBe(MANAGER);
    expect(log.rows[0]!.detail.mid_season).toBe(true);

    // O3: the cap was computed BY the lock action over the pool as it then stood,
    // and is frozen inside the locked config. A mid-season arrival never moves it.
    const capAfter = await db.query<{ cap: string }>(
      "SELECT config #>> '{squad,cap}' AS cap FROM seasons WHERE id = $1",
      [SEASON],
    );
    expect(capAfter.rows[0]!.cap).toBe(capBefore.rows[0]!.cap);
  });

  it("a mid-season add may still be priced by the manager rather than defaulted", async () => {
    await asAuthed(db, managerCtx, async () => {
      await db.query(
        `INSERT INTO players (season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
         VALUES ($1,'Renée Dufort','Renée Dufort','WK',true,21000,true)`,
        [SEASON],
      );
    });
    const { rows } = await db.query<{ starting_price: number }>(
      "SELECT starting_price FROM players WHERE season_id = $1 AND display_name = 'Renée Dufort'",
      [SEASON],
    );
    expect(rows[0]!.starting_price).toBe(21_000);
  });
});
