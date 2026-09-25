import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { DbClient } from "../src/db/repository.js";
import { asAuthed, makeTestDb } from "./helpers/pgliteDb.js";
import { completedTradeBatches } from "../app/lib/tradeUndo.js";
import type { TradeRow } from "../app/lib/squad.js";

const season = "19000000-0000-4000-8000-000000000001";
const owner = "19000000-0000-4000-8000-000000000002";
const stranger = "19000000-0000-4000-8000-000000000003";
const team = "19000000-0000-4000-8000-000000000004";
const round1 = "19000000-0000-4000-8000-000000000005";
const round2 = "19000000-0000-4000-8000-000000000006";
const player = (n: number) => `19000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pool: [number, string][] = [
  [1, "BAT"], [2, "BAT"], [3, "WK"], [4, "BWL"], [5, "BWL"], [6, "AR"],
  [7, "BAT"], [8, "BWL"],
];

async function seed(db: DbClient) {
  await db.query("INSERT INTO seasons(id,name,config) VALUES ($1,'Season',$2)", [season, JSON.stringify(FIXTURE_CONFIG)]);
  await db.query("INSERT INTO profiles(id,display_name) VALUES ($1,'Owner'),($2,'Stranger')", [owner, stranger]);
  await db.query("INSERT INTO fantasy_teams(id,season_id,owner_profile_id,name) VALUES ($1,$2,$3,'Team')", [team, season, owner]);
  for (const [n, role] of pool) {
    await db.query("INSERT INTO players(id,season_id,registry_key,display_name,role,starting_price) VALUES ($1,$2,$3,$3,$4,20000)", [player(n), season, `P${n}`, role]);
  }
  await db.query("INSERT INTO rounds(id,season_id,seq,name,lock_at) VALUES ($1,$3,1,'R1',now()+interval '1 day'),($2,$3,2,'R2',now()+interval '2 days')", [round1, round2, season]);
  await db.query("INSERT INTO trades(fantasy_team_id,round_id,kind,player_id,price,created_at) SELECT $1,$2,'buy',p,20000,'2026-01-01'::timestamptz FROM unnest($3::uuid[]) p", [team, round1, Array.from({ length: 6 }, (_, i) => player(i + 1))]);
  await db.query("UPDATE rounds SET lock_at=now()-interval '1 minute' WHERE id=$1", [round1]);
}

async function makeBatch(db: DbClient, outgoing: number, incoming: number, at: string) {
  const { rows } = await asAuthed(db, { role: "authenticated", sub: owner }, () =>
    db.query<{ id: string }>(
      `INSERT INTO trades(fantasy_team_id,round_id,kind,player_id,price,created_at)
       VALUES ($1,$2,'sell',$3,20000,$5),($1,$2,'buy',$4,20000,$5)
       RETURNING id,kind`,
      [team, round2, player(outgoing), player(incoming), at],
    ),
  );
  const buy = await db.query<{ id: string }>("SELECT id FROM trades WHERE fantasy_team_id=$1 AND round_id=$2 AND player_id=$3 AND kind='buy'", [team, round2, player(incoming)]);
  expect(rows).toHaveLength(2);
  return buy.rows[0]!.id;
}

async function held(db: DbClient) {
  const { rows } = await db.query<{ player_id: string }>("SELECT player_id FROM selections WHERE fantasy_team_id=$1 AND round_id=$2 ORDER BY player_id", [team, round2]);
  return rows.map((r) => r.player_id);
}

describe("pre-lock trade undo", () => {
  let db: DbClient;
  beforeEach(async () => {
    db = await makeTestDb();
    await seed(db);
  }, 120_000);

  it("undoes the latest trade atomically, restores the side and trade slot, and keeps an audit copy", async () => {
    const buyId = await makeBatch(db, 1, 7, "2026-02-01");
    expect(await held(db)).toContain(player(7));
    const { rows } = await asAuthed(db, { role: "authenticated", sub: owner }, () =>
      db.query<{ undo_latest_trades: number }>("SELECT public.undo_latest_trades($1,$2)", [team, buyId]),
    );
    expect(rows[0]?.undo_latest_trades).toBe(1);
    expect(await held(db)).toEqual(Array.from({ length: 6 }, (_, i) => player(i + 1)));
    expect((await db.query("SELECT id FROM trades WHERE fantasy_team_id=$1 AND round_id=$2", [team, round2])).rows).toHaveLength(0);
    const audit = await db.query<{ rows_before: unknown[] }>("SELECT rows_before FROM trade_undo_log WHERE fantasy_team_id=$1", [team]);
    expect(audit.rows[0]?.rows_before).toHaveLength(2);
  }, 120_000);

  it("refuses a stranger and an older batch", async () => {
    const first = await makeBatch(db, 1, 7, "2026-02-01");
    const second = await makeBatch(db, 4, 8, "2026-02-02");
    await expect(asAuthed(db, { role: "authenticated", sub: stranger }, () =>
      db.query("SELECT public.undo_latest_trades($1,$2)", [team, second]),
    )).rejects.toThrow(/Only the team owner/i);
    await expect(asAuthed(db, { role: "authenticated", sub: owner }, () =>
      db.query("SELECT public.undo_latest_trades($1,$2)", [team, first]),
    )).rejects.toThrow(/most recent/i);
    expect((await held(db))).toContain(player(8));
  }, 120_000);

  it("undoes a two-player submission together and refuses direct ledger deletion", async () => {
    const { rows } = await asAuthed(db, { role: "authenticated", sub: owner }, () =>
      db.query<{ id: string; kind: string }>(
        `INSERT INTO trades(fantasy_team_id,round_id,kind,player_id,price,created_at)
         VALUES ($1,$2,'sell',$3,20000,'2026-02-01'),
                ($1,$2,'sell',$4,20000,'2026-02-01'),
                ($1,$2,'buy',$5,20000,'2026-02-01'),
                ($1,$2,'buy',$6,20000,'2026-02-01')
         RETURNING id,kind`,
        [team, round2, player(1), player(4), player(7), player(8)],
      ),
    );
    await expect(asAuthed(db, { role: "authenticated", sub: owner }, () =>
      db.query("DELETE FROM trades WHERE id=$1", [rows[0]!.id]),
    )).rejects.toThrow(/permission denied/i);
    const buyId = rows.find((row) => row.kind === "buy")!.id;
    const result = await asAuthed(db, { role: "authenticated", sub: owner }, () =>
      db.query<{ undo_latest_trades: number }>("SELECT public.undo_latest_trades($1,$2)", [team, buyId]),
    );
    expect(result.rows[0]?.undo_latest_trades).toBe(2);
    expect(await held(db)).toEqual(Array.from({ length: 6 }, (_, i) => player(i + 1)));
  }, 120_000);

  it("refuses undo after round lock", async () => {
    const buyId = await makeBatch(db, 1, 7, "2026-02-01");
    await db.query("UPDATE rounds SET lock_at=now()-interval '1 minute' WHERE id=$1", [round2]);
    await expect(asAuthed(db, { role: "authenticated", sub: owner }, () =>
      db.query("SELECT public.undo_latest_trades($1,$2)", [team, buyId]),
    )).rejects.toThrow(/has locked/i);
  }, 120_000);
});

it("groups existing trade pairs and excludes the initial squad from undo history", () => {
  const row = (id: string, kind: "buy" | "sell", round_id: string, created_at: string): TradeRow => ({
    id, kind, round_id, created_at, fantasy_team_id: team, player_id: player(1), price: 20000,
  });
  const history = completedTradeBatches([
    row("1", "buy", round1, "2026-01-01"),
    row("2", "sell", round2, "2026-02-01"), row("3", "buy", round2, "2026-02-01"),
    row("4", "sell", round2, "2026-02-02"), row("5", "buy", round2, "2026-02-02"),
  ], round2);
  expect(history.map((batch) => [batch.createdAt, batch.isLatest])).toEqual([
    ["2026-02-02", true], ["2026-02-01", false],
  ]);
});
