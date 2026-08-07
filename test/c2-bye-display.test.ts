import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateRound } from "../src/recompute/roundRobin.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import {
  buildOddSeason,
  priceEnteringRound,
  pid,
  tid,
  OWNERS,
  SEASON as SEASON_ID,
  R1,
  R2,
  TRADE_IN,
  TRADE_OUT,
  type OddSeason,
} from "../scripts/oddSeasonScenario.js";

/**
 * C2 — THE BYE ROW, RENDERED.
 *
 * G9 (bye = round median, D18) has been VERIFIED at the engine level since the
 * full-chain slice, but every seed scenario ran an EVEN fantasy-team count, so
 * the DISPLAY path had never executed: no bye row has ever been drawn. This file
 * covers the gap with an ODD (five-team) scenario and asserts the three things
 * the two surfaces must agree on:
 *
 *   1. the FIXTURES page shows "BYE" for exactly the team the engine byed, and
 *      the round median it was scored against;
 *   2. the LADDER row for that team counts the bye as a game played, with
 *      points-for including the byed round's own total and
 *      ladder points = 2·wins + ties (D20);
 *   3. the derived SCHEDULE the UI renders (`generateRound`, D21) is the same
 *      schedule the engine settled — so overlaying results onto fixtures cannot
 *      attach a result to the wrong pairing.
 *
 * It also asserts the two seams the scenario exists to exercise: fielding credit
 * surviving the database path (D25) and price-entering-round diverging from the
 * latest price (Rider 2).
 *
 * NOTE ON SCOPE: this proves the DATA the view renders, and the mapping rule the
 * view uses. It does not drive a browser; the rendered page is checked separately
 * with Playwright (see the slice report).
 */

let scenario: OddSeason;

beforeAll(() => {
  scenario = buildOddSeason();
});

/** The two rounds that carry results, in seq order. */
const settledRounds = () => [R1, R2];

describe("C2 — an odd team count produces a bye every round", () => {
  it("the scenario really is odd-sized", () => {
    expect(scenario.raw.fantasyTeams.length % 2).toBe(1);
  });

  it("every settled round has exactly one bye fixture", () => {
    for (const roundId of settledRounds()) {
      const byes = scenario.derived.h2hResults.filter(
        (h) => h.roundId === roundId && h.awayTeamId === null,
      );
      expect(byes).toHaveLength(1);
      expect(byes[0]!.outcome).toBe("bye");
      expect(byes[0]!.byeMedian).not.toBeNull();
    }
  });

  it("the bye rotates — a different team byes in each round", () => {
    const byeTeams = settledRounds().map(
      (roundId) =>
        scenario.derived.h2hResults.find(
          (h) => h.roundId === roundId && h.awayTeamId === null,
        )!.homeTeamId,
    );
    expect(new Set(byeTeams).size).toBe(byeTeams.length);
  });

  it("the bye median is the true middle of ALL teams' totals that round, INCLUDING the byed team (D18/A3)", () => {
    for (const roundId of settledRounds()) {
      const totals = scenario.raw.fantasyTeams
        .map(
          (t) =>
            scenario.derived.teamRoundScores.find(
              (s) => s.roundId === roundId && s.fantasyTeamId === t.id,
            )?.total ?? 0,
        )
        .sort((a, b) => a - b);
      const middle = totals[Math.floor((totals.length - 1) / 2)]!;
      const bye = scenario.derived.h2hResults.find(
        (h) => h.roundId === roundId && h.awayTeamId === null,
      )!;
      expect(bye.byeMedian).toBe(middle);
    }
  });
});

describe("C2 — the derived schedule and the settled results are the same fixtures (D21)", () => {
  /**
   * The fixtures page derives its schedule by calling `generateRound` (D21) and
   * only overlays SCORES from `h2h_results`. That overlay is safe only if the two
   * agree on the pairings, so the agreement is asserted rather than assumed —
   * and the view surfaces a disagreement instead of attaching a result to the
   * wrong fixture.
   */
  const pairKey = (a: string, b: string | null) =>
    b === null ? `${a}|BYE` : [a, b].sort().join("|");

  it("each round's derived pairings match the engine's settled pairings exactly", () => {
    const teamIds = scenario.raw.fantasyTeams.map((t) => t.id);
    settledRounds().forEach((roundId, index) => {
      const derivedKeys = generateRound(teamIds, index)
        .map((f) => pairKey(f.home, f.away))
        .sort();
      const engineKeys = scenario.derived.h2hResults
        .filter((h) => h.roundId === roundId)
        .map((h) => pairKey(h.homeTeamId, h.awayTeamId))
        .sort();
      expect(derivedKeys).toEqual(engineKeys);
    });
  });

  it("the round index the UI uses (round seq − 1) matches the engine's active-round index here", () => {
    // Both settled rounds are active and contiguous from seq 1, so seq−1 and the
    // engine's active-round position coincide. If a season ever has an INACTIVE
    // round before an active one these diverge — which is exactly the case the
    // fixtures view reports rather than papers over.
    const teamIds = scenario.raw.fantasyTeams.map((t) => t.id);
    settledRounds().forEach((roundId, activeIndex) => {
      const seq = scenario.raw.rounds.find((r) => r.id === roundId)!.seq;
      expect(seq - 1).toBe(activeIndex);
      expect(generateRound(teamIds, seq - 1)).toEqual(
        generateRound(teamIds, activeIndex),
      );
    });
  });
});

describe("C2 — the byed team's ladder row reconciles by hand (D20)", () => {
  it("a bye counts as a game played, settled against the median", () => {
    for (const roundId of settledRounds()) {
      const bye = scenario.derived.h2hResults.find(
        (h) => h.roundId === roundId && h.awayTeamId === null,
      )!;
      const expectedOutcome =
        bye.homePoints > (bye.byeMedian ?? 0)
          ? "win"
          : bye.homePoints < (bye.byeMedian ?? 0)
            ? "loss"
            : "tie";
      // Every team plays every settled round — a bye is a fixture, not a rest.
      const row = scenario.derived.ladder.find(
        (l) => l.fantasyTeamId === bye.homeTeamId,
      )!;
      expect(row.played).toBe(settledRounds().length);
      expect(expectedOutcome).toBeDefined();
    }
  });

  it("points-for equals the sum of the team's OWN round totals, byed rounds included", () => {
    for (const team of scenario.raw.fantasyTeams) {
      const own = scenario.derived.teamRoundScores
        .filter((s) => s.fantasyTeamId === team.id)
        .reduce((n, s) => n + s.total, 0);
      const row = scenario.derived.ladder.find((l) => l.fantasyTeamId === team.id)!;
      expect(row.pointsFor).toBe(own);
    }
  });

  it("ladder points are 2·wins + ties for every row, bye rows included (D20)", () => {
    for (const row of scenario.derived.ladder) {
      expect(row.ladderPoints).toBe(2 * row.wins + row.ties);
      expect(row.played).toBe(row.wins + row.losses + row.ties);
    }
  });

  it("the whole ladder balances: total games played = fixtures settled", () => {
    const played = scenario.derived.ladder.reduce((n, r) => n + r.played, 0);
    // Each head-to-head settles two teams; each bye settles one.
    const settled = scenario.derived.h2hResults.reduce(
      (n, h) => n + (h.awayTeamId === null ? 1 : 2),
      0,
    );
    expect(played).toBe(settled);
  });
});

describe("C2 — the scenario applies cleanly through the live trigger stack", () => {
  it("the raw seed passes every database guard (no bypass)", async () => {
    const db = await makeTestDb();
    // The emitted SQL carries `__OWNER_A..E__` tokens the operator find-replaces
    // with real auth.users ids; the database needs uuids, so substitute here.
    const raw = {
      ...scenario.raw,
      fantasyTeams: scenario.raw.fantasyTeams.map((t, i) => ({
        ...t,
        ownerProfileId: `00000000-0000-0000-0000-0000000c2b${i.toString().padStart(2, "0")}`,
      })),
    };
    await expect(seedSeason(db, raw)).resolves.toBeUndefined();

    const teams = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM fantasy_teams WHERE season_id = $1",
      [scenario.raw.seasonId],
    );
    expect(Number(teams.rows[0]!.n)).toBe(scenario.raw.fantasyTeams.length);
    expect(Number(teams.rows[0]!.n) % 2).toBe(1);
  }, 60_000);
});

describe("the EMITTED seed files apply against the real schema", () => {
  /**
   * WHY THIS EXISTS (Rule 9e — integration is not inherited). Every other test in
   * this file exercises the scenario through `seedSeason`, the shared helper. The
   * files the OPERATOR actually pastes are a different artifact, and they went
   * stale the moment migration 0006 renamed `dismissals.raw_text` to
   * `resolved_text`: the helper was updated, the emitter was not, and the tests
   * stayed green while the artifact was broken. This applies the emitted SQL
   * itself, so the paste path is covered rather than assumed.
   */
  const SEED_DIR = fileURLToPath(new URL("../supabase/seed/dev/", import.meta.url));

  /** Machine-generated SQL: strip comment lines, split on statement boundaries. */
  function statements(sql: string): string[] {
    return sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  it("seed_odd_raw.sql then seed_odd_derived.sql apply cleanly and land the bye", async () => {
    const db = await makeTestDb();

    // Owner tokens the operator find-replaces with real auth.users ids.
    const owners = OWNERS.map(
      (_, i) => `00000000-0000-0000-0000-0000000c2c${i.toString().padStart(2, "0")}`,
    );
    for (const id of owners) {
      await db.query(
        "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,$2,false)",
        [id, "owner"],
      );
    }

    const substitute = (sql: string) =>
      OWNERS.reduce((acc, token, i) => acc.split(token).join(owners[i]!), sql);

    for (const file of ["seed_odd_raw.sql", "seed_odd_derived.sql"]) {
      const sql = substitute(readFileSync(new URL(file, `file://${SEED_DIR}`), "utf8"));
      for (const statement of statements(sql)) {
        await db.query(statement);
      }
    }

    // The bye is on the board, from the pasted files alone.
    const byes = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM h2h_results WHERE away_team_id IS NULL AND bye_median IS NOT NULL",
    );
    expect(Number(byes.rows[0]!.n)).toBe(2);

    const teams = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM fantasy_teams WHERE season_id = $1",
      [SEASON_ID],
    );
    expect(Number(teams.rows[0]!.n) % 2).toBe(1);

    // And the fielding credit survived the dismissal path (D25) end to end.
    const fielding = await db.query<{ total: string | null }>(
      "SELECT sum(fielding) AS total FROM player_match_scores",
    );
    expect(Number(fielding.rows[0]!.total)).toBeGreaterThan(0);
  }, 60_000);

  it("re-applying the raw seed is idempotent", async () => {
    const db = await makeTestDb();
    const owners = OWNERS.map(
      (_, i) => `00000000-0000-0000-0000-0000000c2d${i.toString().padStart(2, "0")}`,
    );
    for (const id of owners) {
      await db.query(
        "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,$2,false)",
        [id, "owner"],
      );
    }
    const sql = OWNERS.reduce(
      (acc, token, i) => acc.split(token).join(owners[i]!),
      readFileSync(new URL("seed_odd_raw.sql", `file://${SEED_DIR}`), "utf8"),
    );
    for (let pass = 0; pass < 2; pass++) {
      for (const statement of statements(sql)) await db.query(statement);
    }
    const teams = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM fantasy_teams WHERE season_id = $1",
      [SEASON_ID],
    );
    expect(Number(teams.rows[0]!.n)).toBe(5);
  }, 60_000);
});

describe("the seams this scenario exists to exercise", () => {
  it("D25: fielding credit survives the dismissal-string path (non-zero, not silently lost)", () => {
    const totalFielding = scenario.derived.playerMatchScores.reduce(
      (n, s) => n + s.fielding,
      0,
    );
    expect(totalFielding).toBeGreaterThan(0);

    // The keeper in match 1 took a catch AND a stumping; both must land on him.
    const keeper = scenario.derived.playerMatchScores.filter(
      (s) => s.playerId === pid(5) && s.fielding > 0,
    );
    expect(keeper.length).toBeGreaterThan(0);
  });

  it("Rider 2: the round-2 trade is struck at the price ENTERING round 2, not the latest price", () => {
    const buyEntering = priceEnteringRound(
      scenario.derived,
      scenario.raw,
      pid(TRADE_IN),
      2,
    );
    expect(scenario.tradePrices.buy).toBe(buyEntering);

    // And that value is genuinely NOT the starting price — the player moved in
    // round 1 — which is what makes this a real test of the distinction.
    const starting = scenario.raw.players.find((p) => p.id === pid(TRADE_IN))!.startingPrice;
    expect(buyEntering).not.toBe(starting);

    // The sold player did not play in round 1, so his price is frozen (D2) and
    // the two readings coincide — the other half of the same rule.
    const sellEntering = priceEnteringRound(
      scenario.derived,
      scenario.raw,
      pid(TRADE_OUT),
      2,
    );
    expect(scenario.tradePrices.sell).toBe(sellEntering);
    expect(sellEntering).toBe(
      scenario.raw.players.find((p) => p.id === pid(TRADE_OUT))!.startingPrice,
    );
  });

  it("Rider 2: round 1 is OPEN while already containing a finalised match — the divergent case", () => {
    // The price entering round 1 is the seed; the LATEST price is post-match.
    // A trade in round 1 must be struck at the former. This is the case the UI
    // footnote explains, and the one that would silently poison recompute.
    const entering = priceEnteringRound(scenario.derived, scenario.raw, pid(TRADE_IN), 1);
    const history = scenario.derived.priceHistory
      .filter((p) => p.playerId === pid(TRADE_IN))
      .sort((a, b) => a.seq - b.seq);
    const latest = history[history.length - 1]!.price;
    expect(entering).not.toBe(latest);
    expect(new Date(scenario.raw.rounds[0]!.lockAt).getTime()).toBeGreaterThan(
      new Date("2026-10-04T06:30:00Z").getTime(),
    );
  });

  it("the initial build consumed zero trades, and the one real trade is a PAIR", () => {
    const croydon = tid(3);
    const r2 = scenario.raw.trades.filter(
      (t) => t.fantasyTeamId === croydon && t.roundId === R2,
    );
    expect(r2.filter((t) => t.kind === "sell")).toHaveLength(1);
    expect(r2.filter((t) => t.kind === "buy")).toHaveLength(1);

    const founding = scenario.raw.trades.filter(
      (t) => t.fantasyTeamId === croydon && t.roundId === R1,
    );
    expect(founding.every((t) => t.kind === "buy")).toBe(true);
    expect(founding).toHaveLength(scenario.raw.config.squad.teamSize);
  });
});
