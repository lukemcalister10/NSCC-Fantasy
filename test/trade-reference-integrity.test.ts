import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { DbClient } from "../src/db/repository.js";
import { asAuthed, makeTestDb } from "./helpers/pgliteDb.js";

const S1 = "16000000-0000-4000-8000-000000000001";
const S2 = "16000000-0000-4000-8000-000000000002";
const OWNER = "16000000-0000-4000-8000-000000000003";
const TEAM = "16000000-0000-4000-8000-000000000004";
const R1 = "16000000-0000-4000-8000-000000000005";
const R2 = "16000000-0000-4000-8000-000000000006";
const P1 = "16000000-0000-4000-8000-000000000007";
const FOREIGN = "16000000-0000-4000-8000-000000000008";

async function seed(db: DbClient) {
  await db.query("INSERT INTO seasons (id,name,config) VALUES ($1,'one',$3),($2,'two',$3)", [
    S1,
    S2,
    JSON.stringify(FIXTURE_CONFIG),
  ]);
  await db.query("INSERT INTO profiles (id,display_name) VALUES ($1,'Owner')", [OWNER]);
  await db.query(
    "INSERT INTO fantasy_teams (id,season_id,owner_profile_id,name) VALUES ($1,$2,$3,'Team')",
    [TEAM, S1, OWNER],
  );
  await db.query(
    `INSERT INTO rounds (id,season_id,seq,name,lock_at) VALUES
      ($1,$3,1,'Round 1','2099-01-01'),($2,$4,1,'Other round','2099-01-01')`,
    [R1, R2, S1, S2],
  );
  await db.query(
    `INSERT INTO players (id,season_id,registry_key,display_name,role,starting_price)
     VALUES ($1,$3,'p1','P1','BAT',50000),($2,$4,'foreign','Foreign','BAT',50000)`,
    [P1, FOREIGN, S1, S2],
  );
}

describe("trade and selection reference integrity", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await makeTestDb();
    await seed(db);
  }, 120_000);

  it("rejects a client-forged trade price", async () => {
    await expect(
      asAuthed(db, { role: "authenticated", sub: OWNER }, () =>
        db.query(
          "INSERT INTO trades (fantasy_team_id,kind,player_id,price,round_id) VALUES ($1,'buy',$2,1,$3)",
          [TEAM, P1, R1],
        ),
      ),
    ).rejects.toThrow(/price entering round/i);
  }, 120_000);

  it("rejects a player from another season in a trade", async () => {
    await expect(
      asAuthed(db, { role: "authenticated", sub: OWNER }, () =>
        db.query(
          "INSERT INTO trades (fantasy_team_id,kind,player_id,price,round_id) VALUES ($1,'buy',$2,50000,$3)",
          [TEAM, FOREIGN, R1],
        ),
      ),
    ).rejects.toThrow(/same season/i);
  }, 120_000);

  it("rejects a round from another season in a selection", async () => {
    await expect(
      asAuthed(db, { role: "authenticated", sub: OWNER }, () =>
        db.query(
          "INSERT INTO selections (fantasy_team_id,round_id,player_id,is_captain) VALUES ($1,$2,$3,true)",
          [TEAM, R2, P1],
        ),
      ),
    ).rejects.toThrow(/same season/i);
  }, 120_000);
});
