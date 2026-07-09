/**
 * SEED GENERATOR (operator SQL-editor path, Rider A).
 *
 * Builds ONE demo `RawSeason` in-process, runs the real `recomputeSeason` engine
 * over it (which also asserts price-integrity, Rider 2), and writes a PAIR of SQL
 * files the operator pastes into the Supabase SQL editor:
 *
 *   supabase/seed/seed_raw.sql      — raw truth (season/players/rounds/matches/
 *                                     scorecard/teams/selections/trades). Idempotent:
 *                                     DELETEs the demo season (cascade) first. Wrapped
 *                                     in ONE transaction so the DEFERRED constraint
 *                                     triggers (mandatory captain, G15 composition,
 *                                     trade limits, round lock) fire at COMMIT over the
 *                                     COMPLETE set — Rider B: passes the live trigger
 *                                     stack legitimately (future lock_at, legal squads,
 *                                     captain present, within cap). No bypass.
 *   supabase/seed/seed_derived.sql  — the ENGINE-COMPUTED derived rows, serialized from
 *                                     recompute output (prime invariant D15/G3: derived
 *                                     state is never hand-written). Idempotent on its own.
 *
 * Run: `npm run seed:generate`. No DB connection or secrets required.
 *
 * Player ROLES here are PLACEHOLDER demo data (operator input pending) — swap the
 * PLAYERS table for the real pool + real roles and re-run to regenerate the pair.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import type { RawSeason, DerivedState } from "../src/recompute/types.js";
import type { PlayerRole } from "../src/config/types.js";

// ── Fixed ids (stable so the pair always targets the same demo season) ───────
const SEASON = "5ea50000-0000-4000-8000-000000000001";
const R1 = "40110000-0000-4000-8000-000000000001";
const R2 = "40110000-0000-4000-8000-000000000002";
const R3 = "40110000-0000-4000-8000-000000000003";
const M1 = "3a7c0000-0000-4000-8000-000000000001"; // finalised (round 1)
const M2 = "3a7c0000-0000-4000-8000-000000000002"; // scheduled (round 2)
const M3 = "3a7c0000-0000-4000-8000-000000000003"; // scheduled (round 3)
const SC1 = "5cad0000-0000-4000-8000-000000000001";

const pid = (n: number) => `71a70000-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
const tid = (n: number) => `7ea70000-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;

// Owner tokens the operator find-replaces with real auth.users ids (see runbook).
const OWNERS = ["__OWNER_A__", "__OWNER_B__", "__OWNER_C__", "__OWNER_D__"];

// ── PLACEHOLDER demo pool (roles are operator-input-pending) ─────────────────
interface P {
  n: number;
  key: string;
  name: string;
  role: PlayerRole;
  wkEligible: boolean;
  price: number;
}
const PLAYERS: P[] = [
  { n: 1, key: "p01", name: "A. Ashford", role: "BAT", wkEligible: false, price: 150000 },
  { n: 2, key: "p02", name: "B. Bannerman", role: "BAT", wkEligible: true, price: 120000 },
  { n: 3, key: "p03", name: "C. Carroll", role: "BAT", wkEligible: false, price: 90000 },
  { n: 4, key: "p04", name: "D. Dettmann", role: "BAT", wkEligible: false, price: 60000 },
  { n: 5, key: "p05", name: "E. Everett", role: "WK", wkEligible: false, price: 110000 },
  { n: 6, key: "p06", name: "F. Fielding", role: "WK", wkEligible: false, price: 70000 },
  { n: 7, key: "p07", name: "G. Gulliver", role: "BWL", wkEligible: false, price: 140000 },
  { n: 8, key: "p08", name: "H. Hollins", role: "BWL", wkEligible: false, price: 100000 },
  { n: 9, key: "p09", name: "I. Ingram", role: "BWL", wkEligible: false, price: 65000 },
  { n: 10, key: "p10", name: "J. Jamison", role: "AR", wkEligible: false, price: 130000 },
  { n: 11, key: "p11", name: "K. Kelleher", role: "AR", wkEligible: false, price: 80000 },
];
const byN = new Map(PLAYERS.map((p) => [p.n, p]));

// ── Fantasy teams + their round-1 squads (2 BAT/1 WK/2 BWL/1 AR = legal G15) ──
interface Squad {
  team: number;
  name: string;
  players: number[]; // exactly 6, legal composition
  captain: number;
  vice: number;
}
const SQUADS: Squad[] = [
  { team: 1, name: "Northcote Nomads", players: [1, 2, 5, 7, 8, 10], captain: 1, vice: 7 },
  { team: 2, name: "Southbank Strikers", players: [2, 3, 6, 8, 9, 11], captain: 8, vice: 2 },
  { team: 3, name: "Eastfield Emus", players: [3, 4, 5, 7, 9, 10], captain: 3, vice: 10 },
  { team: 4, name: "Westgate Warriors", players: [1, 4, 6, 7, 9, 11], captain: 7, vice: 1 },
];

// ── Build the RawSeason ──────────────────────────────────────────────────────
function buildRaw(): RawSeason {
  const lineup = [1, 2, 3, 5, 7, 8, 10].map(pid); // who played M1; the rest DNP
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: PLAYERS.map((p) => ({
      id: pid(p.n),
      registryKey: p.key,
      displayName: p.name,
      role: p.role,
      wkEligible: p.wkEligible,
      startingPrice: p.price,
      active: true,
    })),
    rounds: [
      { id: R1, seq: 1, name: "Round 1", lockAt: "2026-10-10T00:30:00Z" },
      { id: R2, seq: 2, name: "Round 2", lockAt: "2026-10-17T00:30:00Z" },
      { id: R3, seq: 3, name: "Round 3", lockAt: "2026-10-24T00:30:00Z" },
    ],
    matches: [
      {
        id: M1,
        roundId: R1,
        grade: "A Grade",
        opponent: "Prospect District CC",
        status: "finalised",
        finalDayDate: "2026-10-04",
        finalisedAt: "2026-10-04T06:30:00Z",
      },
      {
        id: M2,
        roundId: R2,
        grade: "A Grade",
        opponent: "Kensington CC",
        status: "scheduled",
        finalDayDate: null,
        finalisedAt: null,
      },
      {
        id: M3,
        roundId: R3,
        grade: "A Grade",
        opponent: "Woodville CC",
        status: "scheduled",
        finalDayDate: null,
        finalisedAt: null,
      },
    ],
    scorecards: [
      {
        id: SC1,
        matchId: M1,
        wicketKeeperPlayerId: pid(5), // p05 keeps → catches count as keeper catches
        reviewState: "committed",
        lineup,
        batting: [
          { playerId: pid(1), runs: 72, ballsFaced: 58, fours: 9, sixes: 1 },
          { playerId: pid(2), runs: 34, ballsFaced: 16, fours: 4, sixes: 1 }, // SR 212 → SR bonus
          { playerId: pid(3), runs: 5, ballsFaced: 12, fours: 0, sixes: 0 },
          { playerId: pid(5), runs: 18, ballsFaced: 20, fours: 2, sixes: 0 },
        ],
        bowling: [
          { playerId: pid(7), overs: 6, runsConceded: 14, wickets: 3 }, // econ 2.33 → econ bonus
          { playerId: pid(8), overs: 5, runsConceded: 33, wickets: 1 },
        ],
        dismissals: [
          "c p10 b p08", // p10 outfield catch
          "c p05 b p07", // p05 keeper catch
          "st p05 b p07", // p05 stumping
          "run out (p10)", // p10 unassisted run out
        ],
      },
    ],
    fantasyTeams: SQUADS.map((s, i) => ({
      id: tid(s.team),
      ownerProfileId: OWNERS[i]!,
      name: s.name,
    })),
    selections: SQUADS.flatMap((s) =>
      s.players.map((n) => ({
        id: `5e1e0000-0000-4000-8000-${s.team.toString().padStart(4, "0")}${n
          .toString(16)
          .padStart(8, "0")}`,
        fantasyTeamId: tid(s.team),
        roundId: R1,
        playerId: pid(n),
        isCaptain: n === s.captain,
        isViceCaptain: n === s.vice,
      })),
    ),
    // Initial-squad construction: one buy per selected player at its round-1 price
    // (= starting price, price entering R1) → price-integrity holds; initial build is
    // exempt from the trade COUNT but still cap-checked (Σ ≤ cap). Legit within-cap squad.
    trades: SQUADS.flatMap((s, ti) =>
      s.players.map((n, pi) => ({
        id: `77ade000-0000-4000-8000-${s.team.toString().padStart(4, "0")}${n
          .toString(16)
          .padStart(8, "0")}`,
        fantasyTeamId: tid(s.team),
        kind: "buy" as const,
        playerId: pid(n),
        price: byN.get(n)!.price,
        roundId: R1,
        createdAt: `2026-09-2${ti}T0${pi}:00:00Z`,
      })),
    ),
  };
}

// ── SQL serialization helpers ────────────────────────────────────────────────
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const val = (v: string | number | boolean | null): string =>
  v === null ? "NULL" : typeof v === "string" ? q(v) : typeof v === "boolean" ? (v ? "true" : "false") : String(v);
const row = (vals: (string | number | boolean | null)[]) => `(${vals.map(val).join(", ")})`;

function insert(table: string, cols: string[], rows: (string | number | boolean | null)[][]): string {
  if (rows.length === 0) return `-- (no rows for ${table})\n`;
  return (
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES\n` +
    rows.map(row).join(",\n") +
    ";\n"
  );
}

// ── Emit seed_raw.sql ────────────────────────────────────────────────────────
function emitRaw(raw: RawSeason): string {
  const sc = raw.scorecards[0]!;
  const out: string[] = [];
  out.push(`-- NSCC Fantasy — DEMO SEASON, RAW TRUTH (generated by scripts/generate-seed.ts).`);
  out.push(`-- Paste into the Supabase SQL editor and run. Replace __OWNER_A..D__ with real`);
  out.push(`-- auth.users ids FIRST (see VERCEL_DEPLOY.md). Player roles are PLACEHOLDER demo data.`);
  out.push(`-- Idempotent: re-running wipes and rebuilds the demo season. ONE transaction so the`);
  out.push(`-- deferred triggers (captain / G15 / trade / lock) validate the COMPLETE set at COMMIT.`);
  // Explicit FK-safe wipe (children → parents). NOT a single season cascade: several
  // player_id FKs (scorecard_lineup, batting/bowling_lines, player_match_scores,
  // selections, trades) are ON DELETE NO ACTION, so a lone `DELETE FROM seasons`
  // is not portably cascade-safe. This ordered delete is bulletproof on real Postgres.
  const S = q(SEASON);
  const R_OF = `(SELECT id FROM rounds WHERE season_id = ${S})`;
  const M_OF = `(SELECT id FROM matches WHERE round_id IN ${R_OF})`;
  const T_OF = `(SELECT id FROM fantasy_teams WHERE season_id = ${S})`;
  const P_OF = `(SELECT id FROM players WHERE season_id = ${S})`;
  const SC_OF = `(SELECT id FROM scorecards WHERE match_id IN ${M_OF})`;
  const wipe = [
    `DELETE FROM player_match_scores WHERE match_id IN ${M_OF};`,
    `DELETE FROM price_history WHERE player_id IN ${P_OF};`,
    `DELETE FROM team_cap_snapshots WHERE fantasy_team_id IN ${T_OF};`,
    `DELETE FROM team_round_scores WHERE fantasy_team_id IN ${T_OF};`,
    `DELETE FROM h2h_results WHERE round_id IN ${R_OF};`,
    `DELETE FROM ladder WHERE season_id = ${S};`,
    `DELETE FROM overall_leaderboard WHERE season_id = ${S};`,
    `DELETE FROM trades WHERE fantasy_team_id IN ${T_OF};`,
    `DELETE FROM selections WHERE fantasy_team_id IN ${T_OF};`,
    `DELETE FROM dismissals WHERE scorecard_id IN ${SC_OF};`,
    `DELETE FROM batting_lines WHERE scorecard_id IN ${SC_OF};`,
    `DELETE FROM bowling_lines WHERE scorecard_id IN ${SC_OF};`,
    `DELETE FROM scorecard_lineup WHERE scorecard_id IN ${SC_OF};`,
    `DELETE FROM scorecards WHERE match_id IN ${M_OF};`,
    `DELETE FROM matches WHERE round_id IN ${R_OF};`,
    `DELETE FROM fantasy_teams WHERE season_id = ${S};`,
    `DELETE FROM rounds WHERE season_id = ${S};`,
    `DELETE FROM players WHERE season_id = ${S};`,
    `DELETE FROM seasons WHERE id = ${S};`,
  ];
  out.push(`BEGIN;`);
  out.push(`-- Idempotent wipe of the demo season (children first).`);
  out.push(wipe.join("\n"));
  out.push("");
  out.push(
    `INSERT INTO seasons (id, name, config) VALUES\n(${val(SEASON)}, ${val(
      "NSCC Fantasy — Demo Season (scratch)",
    )}, ${q(JSON.stringify(raw.config))}::jsonb);\n`,
  );
  out.push(
    insert(
      "players",
      ["id", "season_id", "registry_key", "display_name", "role", "wk_eligible", "starting_price", "active"],
      raw.players.map((p) => [p.id, SEASON, p.registryKey, p.displayName, p.role, p.wkEligible, p.startingPrice, p.active]),
    ),
  );
  out.push(
    insert(
      "rounds",
      ["id", "season_id", "seq", "name", "lock_at"],
      raw.rounds.map((r) => [r.id, SEASON, r.seq, r.name, r.lockAt]),
    ),
  );
  out.push(
    insert(
      "matches",
      ["id", "round_id", "grade", "opponent", "status", "final_day_date", "finalised_at"],
      raw.matches.map((m) => [m.id, m.roundId, m.grade, m.opponent, m.status, m.finalDayDate, m.finalisedAt]),
    ),
  );
  out.push(
    insert(
      "scorecards",
      ["id", "match_id", "wicket_keeper_player_id", "review_state"],
      [[sc.id, sc.matchId, sc.wicketKeeperPlayerId, sc.reviewState]],
    ),
  );
  out.push(
    insert(
      "scorecard_lineup",
      ["scorecard_id", "player_id"],
      sc.lineup.map((p) => [sc.id, p]),
    ),
  );
  out.push(
    insert(
      "batting_lines",
      ["scorecard_id", "player_id", "runs", "balls_faced", "fours", "sixes"],
      sc.batting.map((b) => [sc.id, b.playerId, b.runs, b.ballsFaced, b.fours, b.sixes]),
    ),
  );
  out.push(
    insert(
      "bowling_lines",
      ["scorecard_id", "player_id", "overs", "runs_conceded", "wickets"],
      sc.bowling.map((b) => [sc.id, b.playerId, b.overs, b.runsConceded, b.wickets]),
    ),
  );
  out.push(
    insert(
      "dismissals",
      ["scorecard_id", "seq", "raw_text"],
      sc.dismissals.map((d, i) => [sc.id, i, d]),
    ),
  );
  out.push(
    insert(
      "fantasy_teams",
      ["id", "season_id", "owner_profile_id", "name"],
      raw.fantasyTeams.map((t) => [t.id, SEASON, t.ownerProfileId, t.name]),
    ),
  );
  out.push(
    insert(
      "selections",
      ["id", "fantasy_team_id", "round_id", "player_id", "is_captain", "is_vice_captain"],
      raw.selections.map((s) => [s.id, s.fantasyTeamId, s.roundId, s.playerId, s.isCaptain, s.isViceCaptain]),
    ),
  );
  out.push(
    insert(
      "trades",
      ["id", "fantasy_team_id", "kind", "player_id", "price", "round_id", "created_at"],
      raw.trades.map((t) => [t.id, t.fantasyTeamId, t.kind, t.playerId, t.price, t.roundId, t.createdAt]),
    ),
  );
  out.push(`COMMIT;`);
  return out.join("\n") + "\n";
}

// ── Emit seed_derived.sql (engine output; never hand-written) ────────────────
function emitDerived(d: DerivedState): string {
  const out: string[] = [];
  out.push(`-- NSCC Fantasy — DEMO SEASON, DERIVED STATE (recomputeSeason output; D15/G3).`);
  out.push(`-- Paste AFTER seed_raw.sql. Engine-computed — do not hand-edit. Idempotent.`);
  out.push(`BEGIN;`);
  // Defensive scoped deletes so this file is idempotent even run on its own.
  out.push(`DELETE FROM player_match_scores WHERE match_id IN (SELECT id FROM matches WHERE round_id IN (SELECT id FROM rounds WHERE season_id = ${q(SEASON)}));`);
  out.push(`DELETE FROM price_history WHERE player_id IN (SELECT id FROM players WHERE season_id = ${q(SEASON)});`);
  out.push(`DELETE FROM team_cap_snapshots WHERE fantasy_team_id IN (SELECT id FROM fantasy_teams WHERE season_id = ${q(SEASON)});`);
  out.push(`DELETE FROM team_round_scores WHERE fantasy_team_id IN (SELECT id FROM fantasy_teams WHERE season_id = ${q(SEASON)});`);
  out.push(`DELETE FROM h2h_results WHERE round_id IN (SELECT id FROM rounds WHERE season_id = ${q(SEASON)});`);
  out.push(`DELETE FROM ladder WHERE season_id = ${q(SEASON)};`);
  out.push(`DELETE FROM overall_leaderboard WHERE season_id = ${q(SEASON)};`);
  out.push("");
  out.push(
    insert(
      "player_match_scores",
      ["match_id", "player_id", "played", "batting", "bowling", "fielding", "bonuses", "base"],
      d.playerMatchScores.map((s) => [s.matchId, s.playerId, s.played, s.batting, s.bowling, s.fielding, s.bonuses, s.base]),
    ),
  );
  out.push(
    insert(
      "price_history",
      ["player_id", "match_id", "seq", "price"],
      d.priceHistory.map((p) => [p.playerId, p.matchId, p.seq, p.price]),
    ),
  );
  out.push(
    insert(
      "team_cap_snapshots",
      ["fantasy_team_id", "as_of_round_id", "cap_remaining", "invested_value", "team_value"],
      d.teamCapSnapshots.map((c) => [c.fantasyTeamId, c.asOfRoundId, c.capRemaining, c.investedValue, c.teamValue]),
    ),
  );
  out.push(
    insert(
      "team_round_scores",
      ["fantasy_team_id", "round_id", "total", "captain_player_id"],
      d.teamRoundScores.map((t) => [t.fantasyTeamId, t.roundId, t.total, t.captainPlayerId]),
    ),
  );
  out.push(
    insert(
      "h2h_results",
      ["round_id", "home_team_id", "away_team_id", "home_points", "away_points", "bye_median", "outcome"],
      d.h2hResults.map((h) => [h.roundId, h.homeTeamId, h.awayTeamId, h.homePoints, h.awayPoints, h.byeMedian, h.outcome]),
    ),
  );
  out.push(
    insert(
      "ladder",
      ["season_id", "fantasy_team_id", "played", "wins", "losses", "ties", "points_for", "ladder_points"],
      d.ladder.map((l) => [SEASON, l.fantasyTeamId, l.played, l.wins, l.losses, l.ties, l.pointsFor, l.ladderPoints]),
    ),
  );
  out.push(
    insert(
      "overall_leaderboard",
      ["season_id", "fantasy_team_id", "total_points"],
      d.overallLeaderboard.map((o) => [SEASON, o.fantasyTeamId, o.totalPoints]),
    ),
  );
  out.push(`COMMIT;`);
  return out.join("\n") + "\n";
}

// ── Run ───────────────────────────────────────────────────────────────────────
const raw = buildRaw();
const derived = recomputeSeason(raw); // validates + price-integrity (throws on any defect)

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(here, "../supabase/seed");
mkdirSync(seedDir, { recursive: true });
writeFileSync(resolve(seedDir, "seed_raw.sql"), emitRaw(raw));
writeFileSync(resolve(seedDir, "seed_derived.sql"), emitDerived(derived));

console.log("Wrote supabase/seed/seed_raw.sql and seed_derived.sql");
console.log(
  `  ${raw.players.length} players · ${raw.fantasyTeams.length} teams · ${raw.rounds.length} rounds · ` +
    `${derived.playerMatchScores.length} match scores · ${derived.ladder.length} ladder rows`,
);
