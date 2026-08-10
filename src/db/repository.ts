import type { LeagueConfig, PlayerRole } from "../config/types.js";
import type { LedgerTxnKind } from "../engines/capLedger.js";
import type {
  DerivedH2hResult,
  DerivedState,
  MatchStatus,
  RawScorecard,
  RawSeason,
  ReviewState,
} from "../recompute/types.js";

/**
 * Persistence for the recompute contract. `loadRawSeason` reads the raw-truth +
 * config tables into a `RawSeason`; `writeDerived` replaces the season's derived
 * rows in one transaction (DELETE-then-INSERT — no orphaned derived rows, the DB
 * half of G3); `readDerived` reads them back for verification.
 *
 * `DbClient` is the minimal surface both a real Postgres/Supabase client and
 * pglite satisfy, so the same code runs in tests (pglite) and production.
 */
export interface DbClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

const str = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v);
const strOrNull = (v: unknown): string | null =>
  v == null ? null : str(v);
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === "t" || v === "true";

// ---------------------------------------------------------------------------
// Load raw
// ---------------------------------------------------------------------------
export async function loadRawSeason(
  db: DbClient,
  seasonId: string,
): Promise<RawSeason> {
  const season = (
    await db.query<{ config: unknown }>(
      "SELECT config FROM seasons WHERE id = $1",
      [seasonId],
    )
  ).rows[0];
  if (!season) throw new Error(`season ${seasonId} not found`);
  const config: LeagueConfig =
    typeof season.config === "string"
      ? (JSON.parse(season.config) as LeagueConfig)
      : (season.config as LeagueConfig);

  const players = (
    await db.query(
      `SELECT id, registry_key, display_name, role, wk_eligible, starting_price, active
         FROM players WHERE season_id = $1`,
      [seasonId],
    )
  ).rows.map((r) => ({
    id: str(r.id),
    registryKey: str(r.registry_key),
    displayName: str(r.display_name),
    role: str(r.role) as PlayerRole,
    wkEligible: bool(r.wk_eligible),
    startingPrice: numOrNull(r.starting_price),
    active: bool(r.active),
  }));

  const rounds = (
    await db.query(
      "SELECT id, seq, name, lock_at FROM rounds WHERE season_id = $1",
      [seasonId],
    )
  ).rows.map((r) => ({
    id: str(r.id),
    seq: num(r.seq),
    name: str(r.name),
    lockAt: str(r.lock_at),
  }));

  const matches = (
    await db.query(
      `SELECT m.id, m.round_id, m.grade, m.opponent, m.status, m.final_day_date, m.finalised_at
         FROM matches m JOIN rounds r ON m.round_id = r.id
        WHERE r.season_id = $1`,
      [seasonId],
    )
  ).rows.map((r) => ({
    id: str(r.id),
    roundId: str(r.round_id),
    grade: str(r.grade),
    opponent: str(r.opponent),
    status: str(r.status) as MatchStatus,
    finalDayDate: strOrNull(r.final_day_date),
    finalisedAt: strOrNull(r.finalised_at),
  }));

  const scorecardRows = (
    await db.query(
      `SELECT s.id, s.match_id, s.wicket_keeper_player_id, s.review_state
         FROM scorecards s JOIN matches m ON s.match_id = m.id
         JOIN rounds r ON m.round_id = r.id
        WHERE r.season_id = $1`,
      [seasonId],
    )
  ).rows;

  const scardIds = scorecardRows.map((s) => str(s.id));
  const lineupRows = await selectForSeason(
    db,
    seasonId,
    `SELECT sl.scorecard_id, sl.player_id FROM scorecard_lineup sl
       JOIN scorecards s ON sl.scorecard_id = s.id
       JOIN matches m ON s.match_id = m.id JOIN rounds r ON m.round_id = r.id
      WHERE r.season_id = $1`,
  );
  // INNINGS (0006/D5): a two-day match yields more than one line per player, so
  // these queries return one row PER INNINGS and the ordering is explicit —
  // recompute must not inherit whatever order the planner happens to produce.
  // scoreMatch accumulates across lines, so a player's match total is the sum of
  // their innings lines.
  //
  // NOT_OUT AND MAIDENS ARE NO LONGER DROPPED IN TRANSIT (D28c). Migration 0006
  // captured both — not_out because a duck (dismissed for 0) and an unbeaten 0
  // are different events that runs alone cannot distinguish, maidens because O4
  // scores them — but this loader selected neither, so the raw truth reached the
  // engine incomplete no matter what the scoring config said. Storage was
  // sufficient; the seam was not.
  const battingRows = await selectForSeason(
    db,
    seasonId,
    `SELECT b.scorecard_id, b.innings, b.player_id, b.runs, b.balls_faced, b.fours, b.sixes, b.not_out
       FROM batting_lines b JOIN scorecards s ON b.scorecard_id = s.id
       JOIN matches m ON s.match_id = m.id JOIN rounds r ON m.round_id = r.id
      WHERE r.season_id = $1
      ORDER BY b.scorecard_id, b.innings, b.player_id`,
  );
  const bowlingRows = await selectForSeason(
    db,
    seasonId,
    `SELECT b.scorecard_id, b.innings, b.player_id, b.overs, b.runs_conceded, b.wickets, b.maidens
       FROM bowling_lines b JOIN scorecards s ON b.scorecard_id = s.id
       JOIN matches m ON s.match_id = m.id JOIN rounds r ON m.round_id = r.id
      WHERE r.season_id = $1
      ORDER BY b.scorecard_id, b.innings, b.player_id`,
  );
  // `resolved_text` (renamed from `raw_text` in 0006) is the CANONICAL,
  // engine-facing string: fielder positions hold player ids, resolved against the
  // registry under D22 when the scorecard was entered. `source_text` — the string
  // as the operator typed or transcribed it — is deliberately NOT loaded: it is
  // audit material, and recompute must be a function of canonical raw truth only.
  const dismissalRows = await selectForSeason(
    db,
    seasonId,
    `SELECT d.scorecard_id, d.innings, d.seq, d.resolved_text FROM dismissals d
       JOIN scorecards s ON d.scorecard_id = s.id
       JOIN matches m ON s.match_id = m.id JOIN rounds r ON m.round_id = r.id
      WHERE r.season_id = $1
      ORDER BY d.scorecard_id, d.innings, d.seq`,
  );

  const scorecards: RawScorecard[] = scorecardRows.map((s) => {
    const id = str(s.id);
    return {
      id,
      matchId: str(s.match_id),
      wicketKeeperPlayerId: strOrNull(s.wicket_keeper_player_id),
      reviewState: str(s.review_state) as ReviewState,
      lineup: lineupRows
        .filter((r) => str(r.scorecard_id) === id)
        .map((r) => str(r.player_id)),
      batting: battingRows
        .filter((r) => str(r.scorecard_id) === id)
        .map((r) => ({
          playerId: str(r.player_id),
          innings: num(r.innings),
          runs: num(r.runs),
          ballsFaced: num(r.balls_faced),
          fours: num(r.fours),
          sixes: num(r.sixes),
          notOut: bool(r.not_out),
        })),
      bowling: bowlingRows
        .filter((r) => str(r.scorecard_id) === id)
        .map((r) => ({
          playerId: str(r.player_id),
          innings: num(r.innings),
          overs: num(r.overs),
          runsConceded: num(r.runs_conceded),
          wickets: num(r.wickets),
          maidens: num(r.maidens),
        })),
      dismissals: dismissalRows
        .filter((r) => str(r.scorecard_id) === id)
        .sort((a, b) => num(a.innings) - num(b.innings) || num(a.seq) - num(b.seq))
        .map((r) => ({ innings: num(r.innings), text: str(r.resolved_text) })),
    };
  });
  void scardIds;

  const fantasyTeams = (
    await db.query(
      "SELECT id, owner_profile_id, name FROM fantasy_teams WHERE season_id = $1",
      [seasonId],
    )
  ).rows.map((r) => ({
    id: str(r.id),
    ownerProfileId: str(r.owner_profile_id),
    name: str(r.name),
  }));

  const selections = (
    await db.query(
      `SELECT se.id, se.fantasy_team_id, se.round_id, se.player_id, se.is_captain, se.is_vice_captain
         FROM selections se JOIN fantasy_teams ft ON se.fantasy_team_id = ft.id
        WHERE ft.season_id = $1`,
      [seasonId],
    )
  ).rows.map((r) => ({
    id: str(r.id),
    fantasyTeamId: str(r.fantasy_team_id),
    roundId: str(r.round_id),
    playerId: str(r.player_id),
    isCaptain: bool(r.is_captain),
    isViceCaptain: bool(r.is_vice_captain),
  }));

  const trades = (
    await db.query(
      `SELECT t.id, t.fantasy_team_id, t.kind, t.player_id, t.price, t.round_id, t.created_at
         FROM trades t JOIN fantasy_teams ft ON t.fantasy_team_id = ft.id
        WHERE ft.season_id = $1`,
      [seasonId],
    )
  ).rows.map((r) => ({
    id: str(r.id),
    fantasyTeamId: str(r.fantasy_team_id),
    kind: str(r.kind) as LedgerTxnKind,
    playerId: str(r.player_id),
    price: num(r.price),
    roundId: str(r.round_id),
    createdAt: str(r.created_at),
  }));

  return {
    seasonId,
    config,
    players,
    rounds,
    matches,
    scorecards,
    fantasyTeams,
    selections,
    trades,
  };
}

function selectForSeason(
  db: DbClient,
  seasonId: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  return db.query(sql, [seasonId]).then((r) => r.rows);
}

// ---------------------------------------------------------------------------
// Write derived (transactional replace)
// ---------------------------------------------------------------------------

/**
 * Bind parameters per INSERT statement. Postgres' hard limit is 65,535; this sits
 * an order of magnitude below it so a wide table cannot creep up on the ceiling,
 * while still collapsing a season's writes into a handful of statements.
 */
const MAX_BIND_PARAMS = 8_000;

/**
 * One multi-row INSERT per chunk instead of one INSERT per row (C9).
 *
 * WHY THIS IS THE LATENCY FIX. `writeDerived` used to issue a round-trip per
 * derived row — every player-match score, every price point, every cap snapshot.
 * In-process against pglite that is free, which is why the gate suite never felt
 * it; from a serverless function to a Postgres pooler a region away it is one
 * network round-trip each, and a full season is thousands of them. That is what
 * ran the first live recompute up against the function timeout, and it grows with
 * every round played.
 *
 * WHAT IT DOES NOT CHANGE: the rows, their values, their order, or the single
 * surrounding transaction. This is the same write, batched — G3 idempotence is
 * the proof (test/recompute.idempotence.test.ts), and test/se.recompute-batching
 * .test.ts pins the round-trip count so a regression to per-row writes fails
 * loudly rather than quietly costing the operator a minute a week.
 */
async function insertRows(
  db: DbClient,
  table: string,
  columns: string[],
  rows: (string | number | boolean | null)[][],
): Promise<void> {
  if (rows.length === 0) return;
  const perStatement = Math.max(1, Math.floor(MAX_BIND_PARAMS / columns.length));
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    const params: (string | number | boolean | null)[] = [];
    const tuples = chunk.map(
      (row) =>
        `(${row
          .map((value) => {
            params.push(value);
            return `$${params.length}`;
          })
          .join(",")})`,
    );
    await db.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(",")}`,
      params,
    );
  }
}

export async function writeDerived(
  db: DbClient,
  seasonId: string,
  derived: DerivedState,
): Promise<void> {
  await db.query("BEGIN");
  try {
    // Delete every derived family for the season first — so recompute is a clean
    // rebuild and no rows from a prior (possibly erroneous) run are orphaned.
    await db.query(
      `DELETE FROM player_match_scores WHERE match_id IN
         (SELECT m.id FROM matches m JOIN rounds r ON m.round_id = r.id WHERE r.season_id = $1)`,
      [seasonId],
    );
    await db.query(
      "DELETE FROM price_history WHERE player_id IN (SELECT id FROM players WHERE season_id = $1)",
      [seasonId],
    );
    await db.query(
      "DELETE FROM team_cap_snapshots WHERE fantasy_team_id IN (SELECT id FROM fantasy_teams WHERE season_id = $1)",
      [seasonId],
    );
    await db.query(
      "DELETE FROM team_round_scores WHERE fantasy_team_id IN (SELECT id FROM fantasy_teams WHERE season_id = $1)",
      [seasonId],
    );
    await db.query(
      "DELETE FROM h2h_results WHERE round_id IN (SELECT id FROM rounds WHERE season_id = $1)",
      [seasonId],
    );
    await db.query("DELETE FROM ladder WHERE season_id = $1", [seasonId]);
    await db.query("DELETE FROM overall_leaderboard WHERE season_id = $1", [
      seasonId,
    ]);

    await insertRows(
      db,
      "player_match_scores",
      ["match_id", "player_id", "played", "batting", "bowling", "fielding", "bonuses", "second_innings_adjustment", "base"],
      derived.playerMatchScores.map((s) => [
        s.matchId, s.playerId, s.played, s.batting, s.bowling, s.fielding, s.bonuses,
        s.secondInningsAdjustment, s.base,
      ]),
    );
    await insertRows(
      db,
      "price_history",
      ["player_id", "match_id", "seq", "price"],
      derived.priceHistory.map((p) => [p.playerId, p.matchId, p.seq, p.price]),
    );
    await insertRows(
      db,
      "team_cap_snapshots",
      ["fantasy_team_id", "as_of_round_id", "cap_remaining", "invested_value", "team_value"],
      derived.teamCapSnapshots.map((c) => [
        c.fantasyTeamId, c.asOfRoundId, c.capRemaining, c.investedValue, c.teamValue,
      ]),
    );
    await insertRows(
      db,
      "team_round_scores",
      ["fantasy_team_id", "round_id", "total", "captain_player_id"],
      derived.teamRoundScores.map((tr) => [
        tr.fantasyTeamId, tr.roundId, tr.total, tr.captainPlayerId,
      ]),
    );
    // h2h_results.id is a physical surrogate (DEFAULT gen_random_uuid); it is
    // deliberately not part of the derived contract and never read back.
    await insertRows(
      db,
      "h2h_results",
      ["round_id", "home_team_id", "away_team_id", "home_points", "away_points", "bye_median", "outcome"],
      derived.h2hResults.map((h) => [
        h.roundId, h.homeTeamId, h.awayTeamId, h.homePoints, h.awayPoints, h.byeMedian, h.outcome,
      ]),
    );
    await insertRows(
      db,
      "ladder",
      ["season_id", "fantasy_team_id", "played", "wins", "losses", "ties", "points_for", "ladder_points"],
      derived.ladder.map((l) => [
        seasonId, l.fantasyTeamId, l.played, l.wins, l.losses, l.ties, l.pointsFor, l.ladderPoints,
      ]),
    );
    await insertRows(
      db,
      "overall_leaderboard",
      ["season_id", "fantasy_team_id", "total_points"],
      derived.overallLeaderboard.map((o) => [seasonId, o.fantasyTeamId, o.totalPoints]),
    );

    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Read derived back (for G3 verification: DB state == recompute output)
// ---------------------------------------------------------------------------
export async function readDerived(
  db: DbClient,
  seasonId: string,
): Promise<DerivedState> {
  const playerMatchScores = (
    await db.query(
      `SELECT pms.* FROM player_match_scores pms
         JOIN matches m ON pms.match_id = m.id JOIN rounds r ON m.round_id = r.id
        WHERE r.season_id = $1
        ORDER BY pms.match_id, pms.player_id`,
      [seasonId],
    )
  ).rows.map((r) => ({
    matchId: str(r.match_id),
    playerId: str(r.player_id),
    played: bool(r.played),
    batting: num(r.batting),
    bowling: num(r.bowling),
    fielding: num(r.fielding),
    bonuses: num(r.bonuses),
    secondInningsAdjustment: num(r.second_innings_adjustment),
    base: num(r.base),
  }));

  const priceHistory = (
    await db.query(
      `SELECT ph.* FROM price_history ph JOIN players p ON ph.player_id = p.id
        WHERE p.season_id = $1 ORDER BY ph.player_id, ph.seq`,
      [seasonId],
    )
  ).rows.map((r) => ({
    playerId: str(r.player_id),
    matchId: strOrNull(r.match_id),
    seq: num(r.seq),
    price: num(r.price),
  }));

  const teamCapSnapshots = (
    await db.query(
      `SELECT tcs.* FROM team_cap_snapshots tcs
         JOIN fantasy_teams ft ON tcs.fantasy_team_id = ft.id
        WHERE ft.season_id = $1
        ORDER BY tcs.fantasy_team_id, tcs.as_of_round_id`,
      [seasonId],
    )
  ).rows.map((r) => ({
    fantasyTeamId: str(r.fantasy_team_id),
    asOfRoundId: str(r.as_of_round_id),
    capRemaining: num(r.cap_remaining),
    investedValue: num(r.invested_value),
    teamValue: num(r.team_value),
  }));

  const teamRoundScores = (
    await db.query(
      `SELECT trs.* FROM team_round_scores trs
         JOIN fantasy_teams ft ON trs.fantasy_team_id = ft.id
        WHERE ft.season_id = $1
        ORDER BY trs.fantasy_team_id, trs.round_id`,
      [seasonId],
    )
  ).rows.map((r) => ({
    fantasyTeamId: str(r.fantasy_team_id),
    roundId: str(r.round_id),
    total: num(r.total),
    captainPlayerId: strOrNull(r.captain_player_id),
  }));

  const h2hResults = (
    await db.query(
      `SELECT h.* FROM h2h_results h JOIN rounds r ON h.round_id = r.id
        WHERE r.season_id = $1
        ORDER BY h.round_id, h.home_team_id`,
      [seasonId],
    )
  ).rows.map((r) => ({
    roundId: str(r.round_id),
    homeTeamId: str(r.home_team_id),
    awayTeamId: strOrNull(r.away_team_id),
    homePoints: num(r.home_points),
    awayPoints: numOrNull(r.away_points),
    byeMedian: numOrNull(r.bye_median),
    outcome: str(r.outcome) as DerivedH2hResult["outcome"],
  }));

  const ladder = (
    await db.query(
      `SELECT * FROM ladder WHERE season_id = $1 ORDER BY fantasy_team_id`,
      [seasonId],
    )
  ).rows.map((r) => ({
    fantasyTeamId: str(r.fantasy_team_id),
    played: num(r.played),
    wins: num(r.wins),
    losses: num(r.losses),
    ties: num(r.ties),
    pointsFor: num(r.points_for),
    ladderPoints: num(r.ladder_points),
  }));

  const overallLeaderboard = (
    await db.query(
      `SELECT * FROM overall_leaderboard WHERE season_id = $1 ORDER BY fantasy_team_id`,
      [seasonId],
    )
  ).rows.map((r) => ({
    fantasyTeamId: str(r.fantasy_team_id),
    totalPoints: num(r.total_points),
  }));

  return {
    playerMatchScores,
    priceHistory,
    teamCapSnapshots,
    teamRoundScores,
    h2hResults,
    ladder,
    overallLeaderboard,
  };
}
