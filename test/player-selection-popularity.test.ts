import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/pgliteDb";

describe("player selection popularity", () => {
  it("reports an aggregate percentage numerator and denominator for the round", async () => {
    const db = await makeTestDb();
    const season = "00000000-0000-0000-0000-0000000015a0";
    const round = "00000000-0000-0000-0000-0000000015b0";
    const player = "00000000-0000-0000-0000-0000000015c0";
    const owner1 = "00000000-0000-0000-0000-0000000015d0";
    const owner2 = "00000000-0000-0000-0000-0000000015d1";
    const team1 = "00000000-0000-0000-0000-0000000015e0";
    const team2 = "00000000-0000-0000-0000-0000000015e1";

    await db.query("INSERT INTO seasons (id,name,config) VALUES ($1,'current','{}')", [season]);
    await db.query(
      "INSERT INTO profiles (id,display_name) VALUES ($1,'One'),($2,'Two')",
      [owner1, owner2],
    );
    await db.query(
      "INSERT INTO fantasy_teams (id,season_id,owner_profile_id,name) VALUES ($1,$2,$3,'One'),($4,$2,$5,'Two')",
      [team1, season, owner1, team2, owner2],
    );
    await db.query(
      "INSERT INTO rounds (id,season_id,seq,name,lock_at) VALUES ($1,$2,1,'Round 1',now() + interval '1 day')",
      [round, season],
    );
    await db.query(
      `INSERT INTO players (id,season_id,registry_key,display_name,role,wk_eligible,starting_price)
       VALUES ($1,$2,'player','Player','BAT',false,10000)`,
      [player, season],
    );

    await db.query("ALTER TABLE selections DISABLE TRIGGER USER");
    await db.query(
      "INSERT INTO selections (fantasy_team_id,round_id,player_id,is_captain) VALUES ($1,$2,$3,true)",
      [team1, round, player],
    );
    await db.query("ALTER TABLE selections ENABLE TRIGGER USER");

    const result = await db.query<{ selected_count: number; team_count: number }>(
      "SELECT selected_count,team_count FROM player_selection_popularity WHERE round_id=$1 AND player_id=$2",
      [round, player],
    );
    expect(result.rows).toEqual([{ selected_count: 1, team_count: 2 }]);
  }, 30_000);
});
