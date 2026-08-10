import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { DbClient } from "../src/db/repository.js";
import { asAuthed, makeTestDb } from "./helpers/pgliteDb.js";

/**
 * D26 — SELECTIONS ARE MATERIALISED SERVER-SIDE, FOR PARTICIPANTS WHO NEVER OPEN
 * THE APP.
 *
 * Operator ruling: "You shouldn't need to open the app. Your team can be set and
 * forget and the trades are a choice. If you have a valid team at round 0, it's
 * submitted; and carries over." The only way to score zero is to hold nobody.
 *
 * THE DISCIPLINE OF THIS FILE: nothing below ever writes to `selections`. Every
 * write is a TRADE, made as the signed-in participant under RLS — never as the
 * superuser, because a SECURITY DEFINER function that only works for a superuser
 * would prove nothing about the live system. Selection rows appear because the
 * database put them there. That is the whole claim: the participant in these
 * tests does not have a client at all, let alone an open one.
 *
 * Migration: 0010_selection_materialisation.sql.
 */

const SEASON = "d2600000-0000-4000-8000-000000000001";
const OWNER = "d2600000-0000-4000-8000-000000000a01";
const TEAM = "d2600000-0000-4000-8000-000000000f01";
const R1 = "d2600000-0000-4000-8000-000000000c01";
const R2 = "d2600000-0000-4000-8000-000000000c02";
const R3 = "d2600000-0000-4000-8000-000000000c03";

const p = (n: number) => `d2600000-0000-4000-8000-00000000000${n}`;

/** A legal fixture squad (size 6: BAT ≥2, WK ≥1, BWL ≥2, AR ≥1, flex 0), plus
 *  two spares to trade in. Prices are what the "dearest holding" fallback reads. */
const POOL: [string, string, string, number][] = [
  [p(1), "Bat One", "BAT", 90_000],
  [p(2), "Bat Two", "BAT", 55_000],
  [p(3), "Keeper", "WK", 45_000],
  [p(4), "Bowl One", "BWL", 65_000],
  [p(5), "Bowl Two", "BWL", 35_000],
  [p(6), "Allrounder", "AR", 70_000],
  [p(7), "Bat Spare", "BAT", 25_000],
  [p(8), "Bowl Spare", "BWL", 20_000],
];
const SQUAD = [p(1), p(2), p(3), p(4), p(5), p(6)];

const FUTURE = "2099-10-10T00:30:00Z";

async function seed(db: DbClient): Promise<void> {
  await db.query("BEGIN");
  await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
    SEASON,
    "d26 season",
    JSON.stringify(FIXTURE_CONFIG),
  ]);
  await db.query(
    "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'Participant',false)",
    [OWNER],
  );
  for (const [id, name, role, price] of POOL) {
    await db.query(
      `INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
       VALUES ($1,$2,$3,$3,$4,false,$5,true)`,
      [id, SEASON, name, role, price],
    );
  }
  await db.query(
    "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,1,'Round 1',$3)",
    [R1, SEASON, FUTURE],
  );
  await db.query(
    "INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'Never Opens')",
    [TEAM, SEASON, OWNER],
  );
  await db.query("COMMIT");
}

/**
 * The participant's ONLY action: buy a squad. ONE multi-row insert in ONE
 * transaction — the exact shape buildInitialSquad() writes, so the deferred cap
 * and composition guards judge the finished ledger, and the materialisation
 * trigger (which fires per STATEMENT) sees it complete rather than half-built.
 */
async function buildSquad(db: DbClient, roundId: string): Promise<void> {
  const values = SQUAD.map((_, i) => `($1,'buy',$${i * 2 + 2},$${i * 2 + 3},$${SQUAD.length * 2 + 2})`);
  const params: unknown[] = [TEAM];
  for (const pid of SQUAD) params.push(pid, POOL.find((x) => x[0] === pid)![3]);
  params.push(roundId);
  await asAuthed(db, { role: "authenticated", sub: OWNER }, () =>
    db.query(
      `INSERT INTO trades (fantasy_team_id, kind, player_id, price, round_id) VALUES ${values.join(",")}`,
      params,
    ),
  );
}

async function selectionsFor(db: DbClient, roundId: string) {
  const { rows } = await db.query<{
    player_id: string;
    is_captain: boolean;
    is_vice_captain: boolean;
  }>(
    `SELECT player_id, is_captain, is_vice_captain FROM selections
      WHERE fantasy_team_id = $1 AND round_id = $2 ORDER BY player_id`,
    [TEAM, roundId],
  );
  return rows;
}

const captainOf = async (db: DbClient, roundId: string) =>
  (await selectionsFor(db, roundId)).find((r) => r.is_captain)?.player_id ?? null;
const viceOf = async (db: DbClient, roundId: string) =>
  (await selectionsFor(db, roundId)).find((r) => r.is_vice_captain)?.player_id ?? null;

describe("D26 — a team that never opens the app is still fielded", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await makeTestDb();
    await seed(db);
  }, 120_000);

  it("materialises the round's selection set from the trades ledger alone", async () => {
    expect(await selectionsFor(db, R1)).toEqual([]);

    await buildSquad(db, R1);

    // No client, no /team visit, no selection write — and the round is fielded.
    const rows = await selectionsFor(db, R1);
    expect(rows.map((r) => r.player_id)).toEqual([...SQUAD].sort());
  }, 120_000);

  it("appoints a captain and vice with nobody having chosen one (Rider 1)", async () => {
    await buildSquad(db, R1);

    // The deterministic fallback: the dearest holding captains, the next dearest
    // is vice. p(1) at $90,000 and p(6) at $70,000 are the two priciest.
    expect(await captainOf(db, R1)).toBe(p(1));
    expect(await viceOf(db, R1)).toBe(p(6));

    // And exactly one of each — the mandatory-captain invariant is satisfied by
    // the database's own writes, not by a participant remembering to act.
    const rows = await selectionsFor(db, R1);
    expect(rows.filter((r) => r.is_captain)).toHaveLength(1);
    expect(rows.filter((r) => r.is_vice_captain)).toHaveLength(1);
  }, 120_000);

  it("carries captaincy forward into a round created LATER (D26b)", async () => {
    await buildSquad(db, R1);

    // The participant does make one real decision — who captains — and then never
    // touches the app again.
    await asAuthed(db, { role: "authenticated", sub: OWNER }, async () => {
      await db.query(
        "UPDATE selections SET is_captain = false WHERE fantasy_team_id = $1 AND round_id = $2",
        [TEAM, R1],
      );
      await db.query(
        "UPDATE selections SET is_captain = true WHERE fantasy_team_id = $1 AND round_id = $2 AND player_id = $3",
        [TEAM, R1, p(4)],
      );
    });
    expect(await captainOf(db, R1)).toBe(p(4));

    // The MANAGER adds round 2 weeks later. The participant is not present.
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,2,'Round 2',$3)",
      [R2, SEASON, FUTURE],
    );

    const rows = await selectionsFor(db, R2);
    expect(rows.map((r) => r.player_id)).toEqual([...SQUAD].sort());
    // Their choice carried, rather than reverting to the dearest-holding default.
    expect(await captainOf(db, R2)).toBe(p(4));
  }, 120_000);

  it("re-materialises every OPEN round when a trade is made", async () => {
    await buildSquad(db, R1);
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,2,'Round 2',$3)",
      [R2, SEASON, FUTURE],
    );

    // A trade PAIR, in one transaction, exactly as executeTradePair writes it:
    // sell p(5) and buy p(8). The intermediate state after the sell is a
    // five-player squad, which the DEFERRED composition guard must not judge.
    await asAuthed(db, { role: "authenticated", sub: OWNER }, () =>
      db.query(
        `INSERT INTO trades (fantasy_team_id, kind, player_id, price, round_id)
         VALUES ($1,'sell',$2,$3,$5), ($1,'buy',$4,20000,$5)`,
        [TEAM, p(5), 35_000, p(8), R2],
      ),
    );

    const expected = [...SQUAD.filter((x) => x !== p(5)), p(8)].sort();
    // The trade lands in round 2 — and round 1 is open too, so it follows. That
    // is "carries over": a trade changes the team in every round still ahead.
    expect((await selectionsFor(db, R2)).map((r) => r.player_id)).toEqual(expected);
    expect((await selectionsFor(db, R1)).map((r) => r.player_id)).toEqual(expected);
  }, 120_000);

  it("does not touch a round that has already LOCKED (D26c/d)", async () => {
    await buildSquad(db, R1);
    const before = await selectionsFor(db, R1);

    // Round 1 locks. Its set is now history and must never move again.
    await db.query("UPDATE rounds SET lock_at = $2 WHERE id = $1", [
      R1,
      "2020-01-01T00:00:00Z",
    ]);
    // A later round, still open, where trading is legal.
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,2,'Round 2',$3)",
      [R2, SEASON, FUTURE],
    );
    await asAuthed(db, { role: "authenticated", sub: OWNER }, () =>
      db.query(
        `INSERT INTO trades (fantasy_team_id, kind, player_id, price, round_id)
         VALUES ($1,'sell',$2,$3,$5), ($1,'buy',$4,20000,$5)`,
        [TEAM, p(5), 35_000, p(8), R2],
      ),
    );

    // The locked round kept the team that played it; the open one has the new one.
    expect(await selectionsFor(db, R1)).toEqual(before);
    expect((await selectionsFor(db, R2)).map((r) => r.player_id)).toContain(p(8));
  }, 120_000);

  it("gives a participant who registers after the lock no selections (D26d)", async () => {
    // Round 1 locks with nobody holding anything.
    await db.query("UPDATE rounds SET lock_at = $2 WHERE id = $1", [
      R1,
      "2020-01-01T00:00:00Z",
    ]);
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,2,'Round 2',$3)",
      [R2, SEASON, FUTURE],
    );

    await buildSquad(db, R2);

    // "Registering after the lock means you miss the round" — accepted, operator
    // ruling. The missed round is empty; the next one is fielded.
    expect(await selectionsFor(db, R1)).toEqual([]);
    expect((await selectionsFor(db, R2)).map((r) => r.player_id)).toEqual([...SQUAD].sort());
  }, 120_000);

  it("is idempotent — re-running leaves exactly the same set", async () => {
    await buildSquad(db, R1);
    const first = await selectionsFor(db, R1);

    await db.query("SELECT app.materialise_selections($1, $2)", [TEAM, R1]);
    await db.query("SELECT app.materialise_selections($1, $2)", [TEAM, R1]);

    expect(await selectionsFor(db, R1)).toEqual(first);
  }, 120_000);

  it("empties the set for a team that holds nobody — the only way to score zero", async () => {
    await buildSquad(db, R1);
    expect(await selectionsFor(db, R1)).toHaveLength(6);

    // Sell everyone. The set empties rather than lingering, so the team scores
    // zero (D26e) — and the composition guard skips an empty set, so this is a
    // legal, if unwise, position to be in.
    await asAuthed(db, { role: "authenticated", sub: OWNER }, async () => {
      for (const pid of SQUAD) {
        await db.query(
          "INSERT INTO trades (fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,'sell',$2,$3,$4)",
          [TEAM, pid, POOL.find((x) => x[0] === pid)![3], R1],
        );
      }
    });

    expect(await selectionsFor(db, R1)).toEqual([]);
  }, 120_000);

  it("re-materialises a round whose lock is moved back into the future", async () => {
    await buildSquad(db, R1);

    // Round 1 locks with the founding squad. Round 2 opens, and a trade there
    // changes the holdings — round 1 correctly does NOT follow, because it is
    // history now.
    await db.query("UPDATE rounds SET lock_at = $2 WHERE id = $1", [
      R1,
      "2020-01-01T00:00:00Z",
    ]);
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,2,'Round 2',$3)",
      [R2, SEASON, FUTURE],
    );
    await asAuthed(db, { role: "authenticated", sub: OWNER }, () =>
      db.query(
        `INSERT INTO trades (fantasy_team_id, kind, player_id, price, round_id)
         VALUES ($1,'sell',$2,$3,$5), ($1,'buy',$4,20000,$5)`,
        [TEAM, p(5), 35_000, p(8), R2],
      ),
    );
    expect((await selectionsFor(db, R1)).map((r) => r.player_id)).toContain(p(5));

    // Now the MANAGER reopens round 1 — a deliberate act, e.g. a washed-out round
    // being replayed. It is a live round again, so it must field the team the
    // participant actually holds, not the one frozen at the old lock.
    await db.query("UPDATE rounds SET lock_at = $2 WHERE id = $1", [R1, FUTURE]);

    const expected = [...SQUAD.filter((x) => x !== p(5)), p(8)].sort();
    expect((await selectionsFor(db, R1)).map((r) => r.player_id)).toEqual(expected);
  }, 120_000);

  it("backfills rounds and teams that already existed when 0010 was applied", async () => {
    // The migration's DO block is what makes the fix reach the live scratch
    // season, where holdings and rounds predate the trigger. Re-running the same
    // statement here proves the catch-up path, not just the trigger path.
    await buildSquad(db, R1);
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,3,'Round 3',$3)",
      [R3, SEASON, FUTURE],
    );
    await db.query("DELETE FROM selections WHERE fantasy_team_id = $1", [TEAM]);

    await db.query(`
      DO $$
      DECLARE rec record;
      BEGIN
        FOR rec IN
          SELECT ft.id AS team_id, rd.id AS round_id
            FROM fantasy_teams ft
            JOIN rounds rd ON rd.season_id = ft.season_id
           WHERE rd.lock_at > now()
           ORDER BY ft.id, rd.seq
        LOOP
          PERFORM app.materialise_selections(rec.team_id, rec.round_id);
        END LOOP;
      END $$;
    `);

    expect((await selectionsFor(db, R1)).map((r) => r.player_id)).toEqual([...SQUAD].sort());
    expect((await selectionsFor(db, R3)).map((r) => r.player_id)).toEqual([...SQUAD].sort());
  }, 120_000);
});
