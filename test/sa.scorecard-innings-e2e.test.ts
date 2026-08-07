import { describe, it, expect, beforeAll } from "vitest";
import { makeTestDb } from "./helpers/pgliteDb.js";
import { loadRawSeason, writeDerived, readDerived } from "../src/db/repository.js";
import type { DbClient } from "../src/db/repository.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";

/**
 * MANAGER-CORE END-TO-END, on a scratch season (S-A slice definition of done):
 * a round is created, a full multi-innings scorecard is entered the way the admin
 * form writes it, recompute runs, and prices + ladder move.
 *
 * It pins three things this slice changed:
 *
 *  1. TWO-INNINGS SCORECARDS (D5, migration 0006). A player who bats and bowls in
 *     both innings gets one line per innings, and the engine sums them into one
 *     match figure. Before 0006 the schema physically could not hold the second
 *     innings — (scorecard_id, player_id) was the primary key.
 *
 *  2. FIELDING CREDITS ACTUALLY LAND through the DATABASE path. scoreMatch credits
 *     a fielder only when the token parsed out of the dismissal string is a member
 *     of the lineup — and the lineup is a set of player IDS. G1 verified fielding
 *     against the ENGINE with in-memory fixtures, so nothing ever exercised the DB
 *     path end-to-end; the committed demo seed wrote registry keys and produced
 *     fielding 0 for every player, unnoticed. `dismissals.resolved_text` is now
 *     named for what it must contain, and this test fails if it stops containing it.
 *
 *  3. G3 IDEMPOTENCE IS NOT REGRESSED by any of it: recompute twice, byte-identical;
 *     correct a line, recompute, and the derived state is what correct-first-time
 *     entry would have produced, with no orphans.
 *
 * All names invented (D17/Law 11).
 */

const SEASON = "5ea50000-0000-4000-8000-00005a000001";
const ROUND = "40110000-0000-4000-8000-00005a000001";
const MATCH = "3a7c0000-0000-4000-8000-00005a000001";
const CARD = "5cad0000-0000-4000-8000-00005a000001";
const OWNER_A = "0000a000-0000-4000-8000-00005a000001";
const OWNER_B = "0000a000-0000-4000-8000-00005a000002";
const TEAM_A = "7ea70000-0000-4000-8000-00005a000001";
const TEAM_B = "7ea70000-0000-4000-8000-00005a000002";

const p = (n: number) => `71a70000-0000-4000-8000-00005a0000${n.toString().padStart(2, "0")}`;
// Pool: 3 BAT, 2 WK, 3 BWL, 2 AR — enough for two legal fixture squads
// (size 6: BAT >= 2, WK >= 1, BWL >= 2, AR >= 1, flex 0).
const POOL: [string, string, string, number][] = [
  [p(1), "Jo Whitlam", "BAT", 60_000],
  [p(2), "Priya Raman", "BAT", 55_000],
  [p(3), "Dev Anand", "BAT", 50_000],
  [p(4), "Sam Hollis", "WK", 45_000],
  [p(5), "Renée Dufort", "WK", 40_000],
  [p(6), "Tomas Reiner", "BWL", 65_000],
  [p(7), "Mika Larsen", "BWL", 35_000],
  [p(8), "Ana Ferreira", "BWL", 30_000],
  [p(9), "Adam O'Callaghan", "AR", 70_000],
  [p(10), "Brett Kowalczyk", "AR", 25_000],
];
const SQUAD_A = [p(1), p(2), p(4), p(6), p(7), p(9)];
const SQUAD_B = [p(2), p(3), p(5), p(7), p(8), p(10)];

async function seedScratchSeason(db: DbClient): Promise<void> {
  await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
    SEASON,
    "scratch season",
    JSON.stringify(FIXTURE_CONFIG),
  ]);
  for (const [id, name] of [
    [OWNER_A, "Owner A"],
    [OWNER_B, "Owner B"],
  ] as const) {
    await db.query(
      "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,$2,false)",
      [id, name],
    );
  }
  for (const [id, name, role, price] of POOL) {
    await db.query(
      `INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
       VALUES ($1,$2,$3,$3,$4,false,$5,true)`,
      [id, SEASON, name, role, price],
    );
  }
  // Lock far in the future so selections/trades are legal writes (G4).
  await db.query(
    "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,1,'Round 1','2099-10-10T00:30:00Z')",
    [ROUND, SEASON],
  );
  await db.query(
    `INSERT INTO matches (id, round_id, grade, opponent, status, final_day_date, finalised_at)
     VALUES ($1,$2,'A Grade','Invented District CC','finalised','2026-10-11','2026-10-11T06:30:00Z')`,
    [MATCH, ROUND],
  );

  for (const [team, owner, name, squad] of [
    [TEAM_A, OWNER_A, "Team A", SQUAD_A],
    [TEAM_B, OWNER_B, "Team B", SQUAD_B],
  ] as const) {
    await db.query(
      "INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,$4)",
      [team, SEASON, owner, name],
    );
    for (const [i, pid] of squad.entries()) {
      await db.query(
        `INSERT INTO selections (fantasy_team_id, round_id, player_id, is_captain, is_vice_captain)
         VALUES ($1,$2,$3,$4,$5)`,
        [team, ROUND, pid, i === 0, i === 1],
      );
      // Initial squad construction: buy at price entering round 1 = starting price
      // (recompute's Rider-2 price-integrity assert checks exactly this).
      await db.query(
        "INSERT INTO trades (fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,'buy',$2,$3,$4)",
        [team, pid, POOL.find((x) => x[0] === pid)![3], ROUND],
      );
    }
  }
}

/**
 * The scorecard exactly as the admin form writes it: an explicit lineup (which is
 * what makes DNP a decision rather than an inference, D2/D3), per-innings batting
 * and bowling lines, and dismissals carrying player ids in the fielder position
 * with the operator's typed string retained beside them.
 */
async function enterScorecard(db: DbClient): Promise<void> {
  await db.query(
    "INSERT INTO scorecards (id, match_id, wicket_keeper_player_id, review_state) VALUES ($1,$2,$3,'committed')",
    [CARD, MATCH, p(4)],
  );
  // Named XI: 6 of the 10. p(3), p(5), p(8), p(10) are DNP (D2: 0 points, price frozen).
  for (const pid of [p(1), p(2), p(4), p(6), p(7), p(9)]) {
    await db.query("INSERT INTO scorecard_lineup (scorecard_id, player_id) VALUES ($1,$2)", [
      CARD,
      pid,
    ]);
  }

  // Innings 1 batting.
  const bat: [number, string, number, number, number, number, boolean][] = [
    [1, p(1), 40, 30, 5, 0, false],
    [1, p(2), 12, 20, 1, 0, false],
    [1, p(4), 0, 3, 0, 0, false], // duck (captured via not_out=false; O4 scores it later)
    [1, p(9), 25, 14, 2, 1, true],
    // Innings 2 — the same players bat AGAIN. Impossible before 0006.
    [2, p(1), 18, 12, 2, 0, true],
    [2, p(2), 33, 22, 4, 1, false],
  ];
  for (const [innings, pid, runs, balls, fours, sixes, notOut] of bat) {
    await db.query(
      `INSERT INTO batting_lines (scorecard_id, innings, player_id, runs, balls_faced, fours, sixes, not_out)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [CARD, innings, pid, runs, balls, fours, sixes, notOut],
    );
  }

  // Bowling, both innings, with maidens captured for O4.
  const bowl: [number, string, number, number, number, number][] = [
    [1, p(6), 6, 15, 3, 2], // econ 2.5 -> fixture economy bonus
    [1, p(7), 4, 30, 0, 0],
    [2, p(6), 5, 40, 1, 0], // econ 8.0 -> no bonus
  ];
  for (const [innings, pid, overs, runs, wickets, maidens] of bowl) {
    await db.query(
      `INSERT INTO bowling_lines (scorecard_id, innings, player_id, overs, runs_conceded, wickets, maidens)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [CARD, innings, pid, overs, runs, wickets, maidens],
    );
  }

  // Opposition dismissals -> club fielding credits. resolved_text holds player ids
  // (canonical, engine-facing); source_text holds what the operator typed.
  const dis: [number, number, string, string][] = [
    [1, 0, `c ${p(4)} b ${p(6)}`, "c Sam Hollis b Tomas Reiner"],
    [1, 1, `run out (${p(9)})`, "run out (Adam O’Callaghan)"],
    [1, 2, `b ${p(6)}`, "b Tomas Reiner"], // no fielding credit
    [2, 0, `c ${p(1)} b ${p(6)}`, "c Jo Whitlam b Tomas Reiner"], // innings 2 credit
  ];
  for (const [innings, seq, resolved, source] of dis) {
    await db.query(
      "INSERT INTO dismissals (scorecard_id, innings, seq, resolved_text, source_text) VALUES ($1,$2,$3,$4,$5)",
      [CARD, innings, seq, resolved, source],
    );
  }
}

describe("S-A end to end — round + multi-innings scorecard + recompute", () => {
  let db: DbClient;

  beforeAll(async () => {
    db = await makeTestDb();
    // ONE transaction: the composition / captain / trade-limit guards are
    // DEFERRABLE INITIALLY DEFERRED constraint triggers, so a squad must be judged
    // once, at COMMIT, over the completed row-set — exactly as the admin UI writes
    // it and as test/helpers/pgliteDb.ts seeds it.
    await db.query("BEGIN");
    await seedScratchSeason(db);
    await enterScorecard(db);
    await db.query("COMMIT");
  }, 120_000);

  it("sums a player's innings into one match figure (D5 / migration 0006)", async () => {
    const raw = await loadRawSeason(db, SEASON);
    const derived = recomputeSeason(raw);
    const score = (pid: string) =>
      derived.playerMatchScores.find((s) => s.playerId === pid)!;

    // p(1): innings 1 = 40 runs + 5 fours; innings 2 = 18 runs + 2 fours.
    // Fixture: run 1, four +1 -> (40+5) + (18+2) = 65.
    expect(score(p(1)).batting).toBe(65);
    // p(2): (12+1) + (33+4+2·1 six) = 13 + 39 = 52.
    expect(score(p(2)).batting).toBe(52);
    // p(6) bowled both innings: 3 wickets + 1 wicket = 4 × 25 = 100.
    expect(score(p(6)).bowling).toBe(100);
    // Bonuses are per LINE, not per match (recorded open sub-item under O4,
    // DECISION_LOG v1.9): only the 6-0-15-3 innings clears the fixture economy
    // threshold, so exactly one +10 lands.
    expect(score(p(6)).bonuses).toBe(10);
  });

  it("credits fielding through the DATABASE path, in every innings", async () => {
    const derived = recomputeSeason(await loadRawSeason(db, SEASON));
    const score = (pid: string) =>
      derived.playerMatchScores.find((s) => s.playerId === pid)!;

    expect(score(p(4)).fielding).toBe(8); // keeper catch (innings 1)
    expect(score(p(9)).fielding).toBe(10); // unassisted run-out (innings 1)
    expect(score(p(1)).fielding).toBe(8); // outfield catch in INNINGS 2
    expect(score(p(7)).fielding).toBe(0); // bowled dismissal credits no fielder
  });

  it("moves prices for players who played and freezes DNP prices (D2/D3)", async () => {
    const raw = await loadRawSeason(db, SEASON);
    const derived = recomputeSeason(raw);
    await writeDerived(db, SEASON, derived);

    const history = (pid: string) =>
      derived.priceHistory.filter((h) => h.playerId === pid).sort((a, b) => a.seq - b.seq);

    // Played: seed + one movement, at α 0.20 / $1,000 per point.
    const jo = history(p(1));
    expect(jo).toHaveLength(2);
    const joScore = derived.playerMatchScores.find((s) => s.playerId === p(1))!.base;
    expect(jo[1]!.price).toBe(Math.round((0.8 * 60_000 + 0.2 * joScore * 1_000) / 100) * 100);

    // DNP: seed only, price frozen, no movement row (D2).
    expect(history(p(3))).toHaveLength(1);
    expect(history(p(3))[0]!.price).toBe(50_000);

    // The ladder and leaderboard populated for both teams.
    const persisted = await readDerived(db, SEASON);
    expect(persisted.ladder).toHaveLength(2);
    expect(persisted.overallLeaderboard).toHaveLength(2);
    expect(persisted.teamRoundScores.every((t) => t.total > 0)).toBe(true);
    expect(persisted).toEqual(derived); // DB round-trip is faithful
  });

  it("recomputes byte-identically on a re-run (G3 not regressed)", async () => {
    const first = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, first);
    const second = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, second);
    expect(second).toEqual(first);
    expect(await readDerived(db, SEASON)).toEqual(first);
  });

  it("correct the scorecard, recompute, and derived state follows with no orphans (G3)", async () => {
    const before = recomputeSeason(await loadRawSeason(db, SEASON));

    // The operator mistyped the second-innings runs; fix the raw truth only.
    await db.query(
      "UPDATE batting_lines SET runs = 88 WHERE scorecard_id = $1 AND innings = 2 AND player_id = $2",
      [CARD, p(1)],
    );
    const after = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, after);

    const scoreOf = (d: typeof before, pid: string) =>
      d.playerMatchScores.find((s) => s.playerId === pid)!.batting;
    expect(scoreOf(after, p(1))).toBe(scoreOf(before, p(1)) + 70);

    // No orphaned derived rows: what is in the DB is exactly the new computation.
    expect(await readDerived(db, SEASON)).toEqual(after);
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM player_match_scores WHERE match_id = $1`,
      [MATCH],
    );
    expect(rows.rows[0]!.n).toBe(after.playerMatchScores.length);
  });
});
