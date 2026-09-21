import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { makeTestDb } from "./helpers/pgliteDb.js";

const season = "00000000-0000-0000-0000-000000001801";
const owner = "00000000-0000-0000-0000-000000001802";
const team = "00000000-0000-0000-0000-000000001803";
const player = "00000000-0000-0000-0000-000000001804";
const first = "00000000-0000-0000-0000-000000001805";
const second = "00000000-0000-0000-0000-000000001806";
const match = "00000000-0000-0000-0000-000000001807";

describe("trading while prior-round results are pending", () => {
  it("refuses a future-round trade until the locked match is finalised and scored", async () => {
    const db = await makeTestDb();
    await db.query("INSERT INTO seasons(id,name,config) VALUES ($1,'Season',$2)", [season, JSON.stringify(FIXTURE_CONFIG)]);
    await db.query("INSERT INTO profiles(id,display_name) VALUES ($1,'Owner')", [owner]);
    await db.query("INSERT INTO fantasy_teams(id,season_id,owner_profile_id,name) VALUES ($1,$2,$3,'Team')", [team, season, owner]);
    await db.query("INSERT INTO players(id,season_id,registry_key,display_name,role,starting_price) VALUES ($1,$2,'P','P','BAT',20000)", [player, season]);
    await db.query("INSERT INTO rounds(id,season_id,seq,name,lock_at) VALUES ($1,$3,1,'First',now()-interval '1 day'),($2,$3,2,'Second',now()+interval '7 days')", [first, second, season]);
    await db.query("INSERT INTO matches(id,round_id,grade,opponent,status) VALUES ($1,$2,'1st XI','Opp','scheduled')", [match, first]);

    const insert = () => db.query("INSERT INTO trades(fantasy_team_id,kind,player_id,price,round_id) VALUES ($1,'buy',$2,20000,$3)", [team, player, second]);
    await expect(insert()).rejects.toThrow(/trades are closed until/);
    await db.query("UPDATE matches SET status='finalised',finalised_at=now() WHERE id=$1", [match]);
    await expect(insert()).rejects.toThrow(/trades are closed until/);
    await db.query("INSERT INTO player_match_scores(match_id,player_id,played,batting,bowling,fielding,bonuses,base) VALUES ($1,$2,true,0,0,0,0,0)", [match, player]);
    await db.query("BEGIN");
    try {
      await expect(insert()).resolves.toBeDefined();
    } finally {
      await db.query("ROLLBACK");
    }
  });
});
