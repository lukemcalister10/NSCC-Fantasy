import { describe, expect, it } from "vitest";
import { asAuthed, makeTestDb } from "./helpers/pgliteDb.js";

const SEASON = "00000000-0000-4000-8000-000000000001";
const PLAYER = "00000000-0000-4000-8000-000000000002";
const MANAGER = "00000000-0000-4000-8000-000000000003";
const MEMBER = "00000000-0000-4000-8000-000000000004";

describe("player headshots", () => {
  it("stores an optional path that remains editable after season lock", async () => {
    const db = await makeTestDb();
    await db.query(
      "INSERT INTO seasons (id,name,config,locked_at) VALUES ($1,'season',$2,now())",
      [SEASON, JSON.stringify({ squad: { teamSize: 1, roleMinimums: {}, cap: 1, tradesPerRound: 1 }, pricing: { floor: 1, roundingIncrement: 1, alpha: 0.2, dollarsPerPoint: 1, startingPriceGamesCap: 1 }, scoring: {} })],
    );
    await db.query(
      "INSERT INTO players (id,season_id,registry_key,display_name,role,starting_price) VALUES ($1,$2,'Player','Player','BAT',1)",
      [PLAYER, SEASON],
    );
    await db.query(
      "INSERT INTO profiles (id,display_name,is_league_manager) VALUES ($1,'Manager',true),($2,'Member',false)",
      [MANAGER, MEMBER],
    );

    await asAuthed(db, { role: "authenticated", sub: MANAGER }, () =>
      db.query("UPDATE players SET photo_path = 'season/player/headshot.jpg' WHERE id = $1", [PLAYER]),
    );

    const visible = await asAuthed(db, { role: "authenticated", sub: MEMBER }, () =>
      db.query<{ photo_path: string | null }>("SELECT photo_path FROM players WHERE id = $1", [PLAYER]),
    );
    expect(visible.rows[0]?.photo_path).toBe("season/player/headshot.jpg");
  });

  it("still refuses a non-manager player update", async () => {
    const db = await makeTestDb();
    await db.query("INSERT INTO seasons (id,name,config) VALUES ($1,'season','{}')", [SEASON]);
    await db.query(
      "INSERT INTO players (id,season_id,registry_key,display_name,role) VALUES ($1,$2,'Player','Player','BAT')",
      [PLAYER, SEASON],
    );
    await db.query(
      "INSERT INTO profiles (id,display_name,is_league_manager) VALUES ($1,'Member',false)",
      [MEMBER],
    );

    const attempted = await asAuthed(db, { role: "authenticated", sub: MEMBER }, () =>
      db.query("UPDATE players SET photo_path = 'forbidden.jpg' WHERE id = $1 RETURNING id", [PLAYER]),
    );
    expect(attempted.rows).toEqual([]);

    const stored = await db.query<{ photo_path: string | null }>(
      "SELECT photo_path FROM players WHERE id = $1",
      [PLAYER],
    );
    expect(stored.rows[0]?.photo_path).toBeNull();
  });
});
