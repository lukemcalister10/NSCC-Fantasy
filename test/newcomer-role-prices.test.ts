import { beforeAll, describe, expect, it } from "vitest";
import { makeTestDb, asAuthed } from "./helpers/pgliteDb.js";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { DbClient } from "../src/db/repository.js";

const season = "5ea50000-0000-4000-8000-000000900001";
const manager = "0000a000-0000-4000-8000-000000900001";
const prices = { BAT: 29100, BWL: 28800, AR: 38600, WK: 21900 };
describe("D33 mid-season newcomer pricing", () => {
  let db: DbClient;
  beforeAll(async () => {
    db = await makeTestDb();
    await db.query("INSERT INTO seasons(id,name,config,newcomer_role_prices) VALUES ($1,'Newcomer test',$2,$3)", [season, JSON.stringify(FIXTURE_CONFIG), JSON.stringify(prices)]);
    await db.query("INSERT INTO profiles(id,display_name,is_league_manager) VALUES ($1,'Manager',true)", [manager]);
  }, 120000);

  it("preserves blank pre-lock prices", async () => {
    await db.query("INSERT INTO players(season_id,registry_key,display_name,role) VALUES ($1,'Prelock','Prelock','BAT')", [season]);
    const result = await db.query<{ starting_price: number | null }>("SELECT starting_price FROM players WHERE season_id=$1", [season]);
    expect(result.rows[0]!.starting_price).toBeNull();
    await db.query("UPDATE players SET starting_price=29100 WHERE season_id=$1", [season]);
    await db.query("UPDATE seasons SET locked_at=now() WHERE id=$1", [season]);
  });

  it.each(Object.entries(prices))("defaults %s to its original role benchmark %s", async (role, price) => {
    await asAuthed(db, { role: "authenticated", sub: manager }, async () => {
      await db.query("INSERT INTO players(season_id,registry_key,display_name,role,wk_eligible) VALUES ($1,$2,$2,$3,true)", [season, `New ${role}`, role]);
    });
    const result = await db.query<{ starting_price: number }>("SELECT starting_price FROM players WHERE season_id=$1 AND registry_key=$2", [season, `New ${role}`]);
    expect(result.rows[0]!.starting_price).toBe(price);
  });

  it("does not let new arrivals move the benchmark or the salary cap", async () => {
    const before = await db.query("SELECT config,newcomer_role_prices FROM seasons WHERE id=$1", [season]);
    await db.query("INSERT INTO players(season_id,registry_key,display_name,role,starting_price) VALUES ($1,'Expensive','Expensive','BWL',999900)", [season]);
    await db.query("INSERT INTO players(season_id,registry_key,display_name,role) VALUES ($1,'Next bowler','Next bowler','BWL')", [season]);
    const row = await db.query<{ starting_price: number }>("SELECT starting_price FROM players WHERE registry_key='Next bowler'");
    expect(row.rows[0]!.starting_price).toBe(28800);
    expect((await db.query("SELECT config,newcomer_role_prices FROM seasons WHERE id=$1", [season])).rows).toEqual(before.rows);
  });

  it("freezes the benchmarks after lock", async () => {
    await expect(db.query("UPDATE seasons SET newcomer_role_prices=$2 WHERE id=$1", [season, JSON.stringify({ ...prices, BWL: 9000 })])).rejects.toThrow(/frozen/);
  });

  it("fails closed rather than assigning the floor if a season has no benchmark", async () => {
    const other = "5ea50000-0000-4000-8000-000000900002";
    await db.query("INSERT INTO seasons(id,name,config) VALUES ($1,'Unconfigured',$2)", [other, JSON.stringify(FIXTURE_CONFIG)]);
    await db.query("INSERT INTO players(season_id,registry_key,display_name,role,starting_price) VALUES ($1,'Seed','Seed','BAT',29100)", [other]);
    await db.query("UPDATE seasons SET locked_at=now() WHERE id=$1", [other]);
    await expect(db.query("INSERT INTO players(season_id,registry_key,display_name,role) VALUES ($1,'No benchmark','No benchmark','BAT')", [other])).rejects.toThrow(/no pre-season newcomer benchmark/);
  });
});
