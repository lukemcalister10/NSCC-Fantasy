import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/pgliteDb";

const SEASON = "00000000-0000-0000-0000-0000000014a0";
const OTHER_SEASON = "00000000-0000-0000-0000-0000000014a1";
const PLAYER = "00000000-0000-0000-0000-0000000014b0";
const ROUND = "00000000-0000-0000-0000-0000000014c0";
const LOCKED_ROUND = "00000000-0000-0000-0000-0000000014c1";
const OTHER_ROUND = "00000000-0000-0000-0000-0000000014c2";

describe("per-round player availability", () => {
  it("stores only explicit states, enforces season matching, and closes at lockout", async () => {
    const db = await makeTestDb();
    await db.query("INSERT INTO seasons (id,name,config) VALUES ($1,'current','{}'),($2,'other','{}')", [SEASON, OTHER_SEASON]);
    await db.query(
      `INSERT INTO players (id,season_id,registry_key,display_name,role,wk_eligible,starting_price)
       VALUES ($1,$2,'player','Player','BAT',false,10000)`,
      [PLAYER, SEASON],
    );
    await db.query(
      `INSERT INTO rounds (id,season_id,seq,name,lock_at) VALUES
       ($1,$2,1,'Round 1',now() + interval '1 day'),
       ($3,$2,2,'Locked',now() - interval '1 day'),
       ($4,$5,1,'Other',now() + interval '1 day')`,
      [ROUND, SEASON, LOCKED_ROUND, OTHER_ROUND, OTHER_SEASON],
    );

    await db.query(
      "INSERT INTO player_availability (round_id,player_id,status) VALUES ($1,$2,'available')",
      [ROUND, PLAYER],
    );
    const stored = await db.query<{ status: string }>(
      "SELECT status FROM player_availability WHERE round_id=$1 AND player_id=$2",
      [ROUND, PLAYER],
    );
    expect(stored.rows).toEqual([{ status: "available" }]);

    await expect(
      db.query(
        "INSERT INTO player_availability (round_id,player_id,status) VALUES ($1,$2,'unavailable')",
        [OTHER_ROUND, PLAYER],
      ),
    ).rejects.toThrow(/same season/i);

    await expect(
      db.query(
        "INSERT INTO player_availability (round_id,player_id,status) VALUES ($1,$2,'unavailable')",
        [LOCKED_ROUND, PLAYER],
      ),
    ).rejects.toThrow(/locked/i);
  }, 30_000);
});
