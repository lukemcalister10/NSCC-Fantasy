import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { LeagueConfig } from "../src/config/types.js";
import { loadRawSeason, readDerived, writeDerived } from "../src/db/repository.js";
import type { DbClient } from "../src/db/repository.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import { O4_CONFIG } from "./fixtures/o4-config.js";
import { makeTestDb } from "./helpers/pgliteDb.js";

/**
 * D28 THROUGH THE DATABASE PATH — the seam, not the engine.
 *
 * test/o4.scoring-shape.test.ts hand-scores the multiplier against the engine.
 * This file proves the other three things that engine test cannot:
 *
 *   1. THE INNINGS DIMENSION SURVIVES THE SEAM. Before this slice, `innings`,
 *      `not_out` and `maidens` existed in the database (0006) and were dropped in
 *      transit by repository.ts — so a two-innings scorecard reached the engine as
 *      an undifferentiated pile of lines and the multiplier had nothing to act on.
 *      D25 is the precedent for why this deserves its own test: G1 verified
 *      fielding against the ENGINE, and the DATABASE path silently scored zero.
 *
 *   2. G3 SURVIVES IT. Recompute twice on a two-innings card with a multiplier
 *      below 1: byte-identical, and identical again after the round-trip through
 *      storage, with the new second_innings_adjustment column carried faithfully.
 *
 *   3. G11 COVERS THE NEW KEYS. Changing one of the O4 values added by this slice
 *      — in the config, with no code change — changes what the match scores.
 */

const SEASON = "d2800000-0000-4000-8000-000000000001";
const ROUND = "d2800000-0000-4000-8000-000000000010";
const MATCH = "d2800000-0000-4000-8000-000000000020";
const CARD = "d2800000-0000-4000-8000-000000000030";
const SKIP = "d2800000-0000-4000-8000-000000000041";
const KEEP = "d2800000-0000-4000-8000-000000000042";

/**
 * THE HAND-WORKED CASE FROM THE SLICE REPORT, entered as the admin form writes it.
 *
 *   INNINGS 1  bat 62 off 40 (7×4, 1×6), out   62 + 10 (fifty) + 7 + 3 = 82
 *              bowl 8 ov (48 balls) 22 runs 2 wkt 1 maiden  38 + 1     = 39
 *              field 1 outfield catch                                  = 10
 *              econ floor(0.25 × (48 − 22)) = floor(6.5)               =  6
 *                                                        innings 1     = 137
 *   INNINGS 2  bat 16 off 12 (2×4), NOT OUT     16 + 2 + 5             = 23
 *              bowl 5 ov (30 balls) 19 runs 1 wkt                      = 19
 *              field 1 run-out                                         = 15
 *              econ floor(0.25 × (30 − 19)) = floor(2.75)              =  2
 *                                                        innings 2     =  59
 *
 *   59 × 0.5 = 29.5 → 30 (half up) · adjustment −29 · base 137 + 30 = 167
 */
async function enterMatch(db: DbClient, config: LeagueConfig): Promise<void> {
  await db.query("BEGIN");
  await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
    SEASON,
    "d28 season",
    JSON.stringify(config),
  ]);
  for (const [id, name, role] of [
    [SKIP, "Skipper", "AR"],
    [KEEP, "Keeper", "WK"],
  ] as const) {
    await db.query(
      `INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
       VALUES ($1,$2,$3,$3,$4,false,60000,true)`,
      [id, SEASON, name, role],
    );
  }
  await db.query(
    "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,1,'R1','2099-01-01T00:00:00Z')",
    [ROUND, SEASON],
  );
  await db.query(
    `INSERT INTO matches (id, round_id, grade, opponent, status, final_day_date, finalised_at)
     VALUES ($1,$2,'A Grade','Two-Day Opponent','finalised','2026-10-11','2026-10-11T06:30:00Z')`,
    [MATCH, ROUND],
  );
  await db.query(
    "INSERT INTO scorecards (id, match_id, wicket_keeper_player_id, review_state) VALUES ($1,$2,$3,'committed')",
    [CARD, MATCH, KEEP],
  );
  for (const pid of [SKIP, KEEP]) {
    await db.query(
      "INSERT INTO scorecard_lineup (scorecard_id, player_id) VALUES ($1,$2)",
      [CARD, pid],
    );
  }

  const bat: [number, string, number, number, number, number, boolean][] = [
    [1, SKIP, 62, 40, 7, 1, false],
    [2, SKIP, 16, 12, 2, 0, true],
  ];
  for (const [innings, pid, runs, balls, fours, sixes, notOut] of bat) {
    await db.query(
      `INSERT INTO batting_lines (scorecard_id, innings, player_id, runs, balls_faced, fours, sixes, not_out)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [CARD, innings, pid, runs, balls, fours, sixes, notOut],
    );
  }
  const bowl: [number, string, number, number, number, number][] = [
    [1, SKIP, 8, 22, 2, 1],
    [2, SKIP, 5, 19, 1, 0],
  ];
  for (const [innings, pid, overs, runs, wickets, maidens] of bowl) {
    await db.query(
      `INSERT INTO bowling_lines (scorecard_id, innings, player_id, overs, runs_conceded, wickets, maidens)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [CARD, innings, pid, overs, runs, wickets, maidens],
    );
  }
  // A catch in innings 1 and a run-out in innings 2: the fielding credit has to
  // land in the RIGHT innings, or the multiplier scales the wrong one.
  for (const [innings, seq, text] of [
    [1, 0, `c ${SKIP} b ${KEEP}`],
    [2, 0, `run out (${SKIP})`],
  ] as const) {
    await db.query(
      "INSERT INTO dismissals (scorecard_id, innings, seq, resolved_text) VALUES ($1,$2,$3,$4)",
      [CARD, innings, seq, text],
    );
  }
  await db.query("COMMIT");
}

const scoreOf = async (db: DbClient) =>
  recomputeSeason(await loadRawSeason(db, SEASON)).playerMatchScores.find(
    (s) => s.playerId === SKIP,
  )!;

describe("D28 through the database path — a real two-innings scorecard", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await makeTestDb();
    await enterMatch(db, O4_CONFIG);
  }, 120_000);

  it("reproduces the hand-worked figures from stored raw truth", async () => {
    const s = await scoreOf(db);
    expect(s.batting).toBe(105); // 82 + 23, face value
    expect(s.bowling).toBe(58); // 39 + 19
    expect(s.fielding).toBe(25); // 10 + 15
    expect(s.bonuses).toBe(8); // 6 + 2, economy per innings
    expect(s.secondInningsAdjustment).toBe(-29);
    expect(s.base).toBe(167);
  }, 120_000);

  it("keeps base equal to its own components after the round trip (0009)", async () => {
    const derived = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, derived);

    const { rows } = await db.query<Record<string, string>>(
      `SELECT batting, bowling, fielding, bonuses, second_innings_adjustment, base
         FROM player_match_scores WHERE player_id = $1`,
      [SKIP],
    );
    const r = rows[0]!;
    const n = (k: string) => Number(r[k]);
    expect(n("second_innings_adjustment")).toBe(-29);
    expect(
      n("batting") + n("bowling") + n("fielding") + n("bonuses") + n("second_innings_adjustment"),
    ).toBe(n("base"));
  }, 120_000);

  it("recomputes byte-identically on a re-run — G3, two-innings case", async () => {
    const first = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, first);
    const second = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, second);

    expect(second).toEqual(first);
    expect(await readDerived(db, SEASON)).toEqual(first);
  }, 120_000);

  it("prices off the POST-multiplier base (D1 reads base, D28a)", async () => {
    const derived = recomputeSeason(await loadRawSeason(db, SEASON));
    const move = derived.priceHistory.filter((h) => h.playerId === SKIP).sort((a, b) => a.seq - b.seq);
    // 0.8 × 60,000 + 0.2 × 167 × 1,000 = 48,000 + 33,400 = 81,400.
    expect(move[1]!.price).toBe(81_400);
  }, 120_000);

  it("drops nothing at the seam: not_out and maidens reach the engine (D28c)", async () => {
    const raw = await loadRawSeason(db, SEASON);
    const card = raw.scorecards[0]!;
    // The three fields that used to be dropped in transit, present and correct.
    expect(card.batting.find((b) => b.innings === 2)!.notOut).toBe(true);
    expect(card.bowling.find((b) => b.innings === 1)!.maidens).toBe(1);
    expect(card.dismissals.map((d) => d.innings)).toEqual([1, 2]);
  }, 120_000);
});

describe("G11 — the O4 keys added by this slice are config, not code", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await makeTestDb();
    await enterMatch(db, O4_CONFIG);
  }, 120_000);

  /** Edit one leaf of the stored config, exactly as /admin/settings saves it. */
  async function setScoring(key: string, value: number): Promise<void> {
    await db.query(
      `UPDATE seasons SET config = jsonb_set(config, ARRAY['scoring', $2], to_jsonb($3::numeric)) WHERE id = $1`,
      [SEASON, key, value],
    );
  }

  it("changing the second-innings multiplier changes the score, with no code change", async () => {
    expect((await scoreOf(db)).base).toBe(167);

    // 1.0 → the second innings is worth face value: 137 + 59 = 196.
    await setScoring("secondInningsMultiplier", 1);
    const whole = await scoreOf(db);
    expect(whole.secondInningsAdjustment).toBe(0);
    expect(whole.base).toBe(196);

    // 0 → the second innings is worth nothing at all: 137.
    await setScoring("secondInningsMultiplier", 0);
    expect((await scoreOf(db)).base).toBe(137);
  }, 120_000);

  it("changing the fifty bonus changes the score", async () => {
    await setScoring("perFifty", 30); // was 10, and the 62 clears fifty
    expect((await scoreOf(db)).base).toBe(167 + 20);
  }, 120_000);

  it("changing the not-out bonus moves the SECOND innings, and is halved with it", async () => {
    // The not-out is in innings 2, so +10 there is worth +5 after the multiplier.
    // 59 + 10 = 69; 69 × 0.5 = 34.5 → 35; base = 137 + 35 = 172.
    await setScoring("perNotOut", 15); // was 5
    expect((await scoreOf(db)).base).toBe(172);
  }, 120_000);

  it("changing the economy rate changes both innings' bonuses", async () => {
    // 0.5 per net ball: innings 1 floor(0.5 × 26) = 13, innings 2 floor(0.5 × 11) = 5.
    // innings 1 = 137 − 6 + 13 = 144; innings 2 = 59 − 2 + 5 = 62 → 62 × 0.5 = 31.
    await setScoring("econBonusPerNetBall", 0.5);
    expect((await scoreOf(db)).base).toBe(144 + 31);
  }, 120_000);

  it("the FIXTURE economy leaves this same card completely unmultiplied", async () => {
    await db.query("UPDATE seasons SET config = $2 WHERE id = $1", [
      SEASON,
      JSON.stringify(FIXTURE_CONFIG),
    ]);
    const s = await scoreOf(db);
    expect(s.secondInningsAdjustment).toBe(0);
    expect(s.base).toBe(s.batting + s.bowling + s.fielding + s.bonuses);
  }, 120_000);
});
