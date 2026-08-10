/**
 * THE ODD-TEAM-COUNT SCENARIO (carried-forward item C2), as data.
 *
 * G9 (bye = round median, D18) is VERIFIED at the engine level, but every
 * demo/seed scenario has run an EVEN fantasy-team count, so no bye row has ever
 * been rendered. This builds a FIVE-team season — odd, so exactly one team byes
 * every round.
 *
 * It lives apart from the SQL emitter so the seed generator and the C2 display
 * test share ONE definition of the scenario: a seed that drifts from the test
 * proving it is worth very little.
 *
 * THREE THINGS THIS SCENARIO DELIBERATELY EXERCISES
 *
 *  1. THE BYE (C2/G9/D18). Five teams, two settled rounds, so the bye rotates and
 *     the byed team's W/L/T against the round median lands on the ladder.
 *
 *  2. THE FIELDING SEAM (D25, A10). Fielders in dismissal strings are written as
 *     CANONICAL PLAYER IDS — the identifier the lineup holds. The scoring engine
 *     credits a fielder only when the parsed token is in the lineup, so a seed
 *     written with registry keys silently scores every catch, stumping and
 *     run-out as ZERO. That is the defect D25 records; this scenario is written
 *     the way D25 requires, so the full path (dismissal string → storage →
 *     recompute → displayed score) actually carries fielding points.
 *
 *  3. PRICE-ENTERING-ROUND (Rider 2). Round 1 contains a FINALISED match while
 *     round 1 is still open — precisely the case where a player's latest price
 *     and his price ENTERING the round diverge. Recompute asserts every trade was
 *     struck at the entering-round price, so the round-2 trade pair below is
 *     priced by deriving that value first: the same arithmetic the UI performs
 *     before it writes a trade.
 */
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import type { RawSeason, RawTrade, DerivedState } from "../src/recompute/types.js";
import type { PlayerRole } from "../src/config/types.js";

// ── Fixed ids (own namespace: the dev season coexists with the demo season) ──
export const SEASON = "5ea50dd0-0000-4000-8000-000000000001";
export const R1 = "40110dd0-0000-4000-8000-000000000001";
export const R2 = "40110dd0-0000-4000-8000-000000000002";
export const R3 = "40110dd0-0000-4000-8000-000000000003";
const M1 = "3a7c0dd0-0000-4000-8000-000000000001"; // finalised, round 1
const M2 = "3a7c0dd0-0000-4000-8000-000000000002"; // finalised, round 2
/**
 * Both demo cards are ONE-INNINGS matches, so every line and every dismissal
 * belongs to innings 1 (D27). Spelled out rather than defaulted because the raw
 * contract makes `innings` required — the database column is NOT NULL, and a seed
 * that omitted it would be describing a scorecard the database cannot hold.
 */
const INNINGS_1 = 1;
const dis = (text: string) => ({ innings: INNINGS_1, text });

const SC1 = "5cad0dd0-0000-4000-8000-000000000001";
const SC2 = "5cad0dd0-0000-4000-8000-000000000002";

export const pid = (n: number) =>
  `71a70dd0-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
export const tid = (n: number) =>
  `7ea70dd0-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;

/** FIVE owners — the odd count is the whole point (C2). */
export const OWNERS = [
  "__OWNER_A__",
  "__OWNER_B__",
  "__OWNER_C__",
  "__OWNER_D__",
  "__OWNER_E__",
];

// ── Pool. Roles/prices are DEMO data; the shape satisfies the fixture config
//    (teamSize 6 = BAT>=2, WK>=1, BWL>=2, AR>=1, flex 0) for every squad below.
interface P {
  n: number;
  key: string;
  name: string;
  role: PlayerRole;
  wkEligible: boolean;
  price: number;
}
export const PLAYERS: P[] = [
  { n: 1, key: "o01", name: "A. Abbott", role: "BAT", wkEligible: false, price: 150_000 },
  { n: 2, key: "o02", name: "B. Byrne", role: "BAT", wkEligible: false, price: 120_000 },
  { n: 3, key: "o03", name: "C. Cross", role: "BAT", wkEligible: true, price: 95_000 },
  { n: 4, key: "o04", name: "D. Doyle", role: "BAT", wkEligible: false, price: 70_000 },
  { n: 5, key: "o05", name: "E. Ennis", role: "WK", wkEligible: false, price: 110_000 },
  { n: 6, key: "o06", name: "F. Fraser", role: "WK", wkEligible: false, price: 65_000 },
  { n: 7, key: "o07", name: "G. Grady", role: "BWL", wkEligible: false, price: 140_000 },
  { n: 8, key: "o08", name: "H. Hale", role: "BWL", wkEligible: false, price: 105_000 },
  { n: 9, key: "o09", name: "I. Irwin", role: "BWL", wkEligible: false, price: 80_000 },
  { n: 10, key: "o10", name: "J. Jarrett", role: "BWL", wkEligible: false, price: 55_000 },
  { n: 11, key: "o11", name: "K. Kendrick", role: "AR", wkEligible: false, price: 130_000 },
  { n: 12, key: "o12", name: "L. Lowry", role: "AR", wkEligible: false, price: 90_000 },
  { n: 13, key: "o13", name: "M. Mercer", role: "AR", wkEligible: false, price: 60_000 },
];
const byN = new Map(PLAYERS.map((p) => [p.n, p]));

// ── Five squads, each exactly 2 BAT / 1 WK / 2 BWL / 1 AR, each within cap ────
interface Squad {
  team: number;
  name: string;
  players: number[];
  captain: number;
  vice: number;
}
export const SQUADS: Squad[] = [
  { team: 1, name: "Adelaide Antics", players: [1, 2, 5, 7, 8, 11], captain: 1, vice: 7 },
  { team: 2, name: "Brighton Bandits", players: [2, 3, 6, 8, 9, 12], captain: 8, vice: 2 },
  { team: 3, name: "Croydon Comets", players: [3, 4, 5, 9, 10, 13], captain: 3, vice: 13 },
  { team: 4, name: "Dulwich Dragons", players: [1, 4, 6, 7, 10, 11], captain: 7, vice: 11 },
  { team: 5, name: "Enfield Eagles", players: [1, 2, 5, 7, 9, 13], captain: 2, vice: 5 },
];

// ── The round-2 trade pair (Croydon: out M. Mercer, in K. Kendrick) ──────────
export const TRADE_TEAM = 3;
export const TRADE_OUT = 13;
export const TRADE_IN = 11;

/** Croydon's round-2 squad after the trade — still 2 BAT / 1 WK / 2 BWL / 1 AR. */
function round2Players(squad: Squad): number[] {
  if (squad.team !== TRADE_TEAM) return squad.players;
  return squad.players.map((n) => (n === TRADE_OUT ? TRADE_IN : n));
}
/** Croydon's vice was the player traded out; the incoming player inherits. */
function round2Vice(squad: Squad): number {
  return squad.team === TRADE_TEAM && squad.vice === TRADE_OUT ? TRADE_IN : squad.vice;
}

function buildRaw(r2Trades: RawTrade[]): RawSeason {
  const m1Lineup = [1, 2, 3, 5, 7, 8, 11].map(pid);
  const m2Lineup = [2, 3, 4, 6, 9, 10, 12, 13].map(pid);

  const selections = SQUADS.flatMap((s) => [
    ...s.players.map((n) => ({
      id: `5e1e0dd0-0000-4000-8000-${s.team.toString().padStart(4, "0")}1${n
        .toString(16)
        .padStart(7, "0")}`,
      fantasyTeamId: tid(s.team),
      roundId: R1,
      playerId: pid(n),
      isCaptain: n === s.captain,
      isViceCaptain: n === s.vice,
    })),
    // Round 2 carries forward from holdings (there is no bench and no per-round
    // choice): the same squad, plus the traded-in player for the team that traded.
    ...round2Players(s).map((n) => ({
      id: `5e1e0dd0-0000-4000-8000-${s.team.toString().padStart(4, "0")}2${n
        .toString(16)
        .padStart(7, "0")}`,
      fantasyTeamId: tid(s.team),
      roundId: R2,
      playerId: pid(n),
      isCaptain: n === s.captain,
      isViceCaptain: n === round2Vice(s),
    })),
  ]);

  // Founding buys: one per selected player, at the price entering round 1 (=
  // the starting price). Initial construction consumes ZERO trades (G15).
  const foundingTrades: RawTrade[] = SQUADS.flatMap((s, ti) =>
    s.players.map((n, pi) => ({
      id: `77ade0dd-0000-4000-8000-${s.team.toString().padStart(4, "0")}1${n
        .toString(16)
        .padStart(7, "0")}`,
      fantasyTeamId: tid(s.team),
      kind: "buy" as const,
      playerId: pid(n),
      price: byN.get(n)!.price,
      roundId: R1,
      createdAt: `2026-09-2${ti}T0${pi}:00:00Z`,
    })),
  );

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
        status: "finalised",
        finalDayDate: "2026-10-11",
        finalisedAt: "2026-10-11T06:30:00Z",
      },
    ],
    scorecards: [
      {
        id: SC1,
        matchId: M1,
        wicketKeeperPlayerId: pid(5),
        reviewState: "committed",
        lineup: m1Lineup,
        batting: [
          { playerId: pid(1), innings: INNINGS_1, runs: 72, ballsFaced: 58, fours: 9, sixes: 1, notOut: false },
          { playerId: pid(2), innings: INNINGS_1, runs: 34, ballsFaced: 16, fours: 4, sixes: 1, notOut: false },
          { playerId: pid(3), innings: INNINGS_1, runs: 5, ballsFaced: 12, fours: 0, sixes: 0, notOut: false },
          { playerId: pid(5), innings: INNINGS_1, runs: 18, ballsFaced: 20, fours: 2, sixes: 0, notOut: true },
        ],
        bowling: [
          { playerId: pid(7), innings: INNINGS_1, overs: 6, runsConceded: 14, wickets: 3, maidens: 2 },
          { playerId: pid(8), innings: INNINGS_1, overs: 5, runsConceded: 33, wickets: 1, maidens: 0 },
        ],
        // D25: fielders named by CANONICAL PLAYER ID, the identifier the lineup
        // holds — otherwise no fielding credit lands through the database path.
        dismissals: [
          dis(`c ${pid(11)} b ${pid(8)}`), // K. Kendrick, outfield catch
          dis(`c ${pid(5)} b ${pid(7)}`), // E. Ennis keeping — keeper catch
          dis(`st ${pid(5)} b ${pid(7)}`), // E. Ennis, stumping
          dis(`run out (${pid(11)})`), // K. Kendrick, unassisted
        ],
      },
      {
        id: SC2,
        matchId: M2,
        wicketKeeperPlayerId: pid(6),
        reviewState: "committed",
        lineup: m2Lineup,
        batting: [
          { playerId: pid(2), innings: INNINGS_1, runs: 12, ballsFaced: 20, fours: 1, sixes: 0, notOut: false },
          { playerId: pid(3), innings: INNINGS_1, runs: 61, ballsFaced: 44, fours: 7, sixes: 2, notOut: false },
          { playerId: pid(4), innings: INNINGS_1, runs: 40, ballsFaced: 35, fours: 5, sixes: 0, notOut: true },
          { playerId: pid(6), innings: INNINGS_1, runs: 25, ballsFaced: 19, fours: 3, sixes: 0, notOut: false },
        ],
        bowling: [
          { playerId: pid(9), innings: INNINGS_1, overs: 7, runsConceded: 20, wickets: 2, maidens: 1 },
          { playerId: pid(10), innings: INNINGS_1, overs: 4, runsConceded: 30, wickets: 0, maidens: 0 },
        ],
        dismissals: [
          dis(`c ${pid(12)} b ${pid(9)}`), // L. Lowry, outfield catch
          dis(`c ${pid(6)} b ${pid(9)}`), // F. Fraser keeping — keeper catch
          dis(`run out (${pid(13)}/${pid(12)})`), // assisted, credited to both
          dis(`b ${pid(10)}`), // bowled — no fielding credit
        ],
      },
    ],
    fantasyTeams: SQUADS.map((s, i) => ({
      id: tid(s.team),
      ownerProfileId: OWNERS[i]!,
      name: s.name,
    })),
    selections,
    trades: [...foundingTrades, ...r2Trades],
  };
}

/**
 * The price a player carries ENTERING a round — the last movement recorded in a
 * round strictly earlier than the target. This is the value recompute asserts a
 * trade was struck at (Rider 2), and it is NOT the latest price whenever the
 * round being traded in already contains a finalised match.
 */
export function priceEnteringRound(
  derived: DerivedState,
  raw: RawSeason,
  playerId: string,
  targetRoundSeq: number,
): number {
  const roundSeqByMatch = new Map(
    raw.matches.map((m) => [m.id, raw.rounds.find((r) => r.id === m.roundId)?.seq ?? 0]),
  );
  const history = derived.priceHistory
    .filter((p) => p.playerId === playerId)
    .sort((a, b) => a.seq - b.seq);
  let price = history[0]?.price ?? 0;
  for (const point of history) {
    if (point.matchId === null) continue;
    const seq = roundSeqByMatch.get(point.matchId) ?? 0;
    if (seq < targetRoundSeq) price = point.price;
    else break;
  }
  return price;
}

export interface OddSeason {
  raw: RawSeason;
  derived: DerivedState;
  /** The round-2 trade, priced at entering-round values (Rider 2). */
  tradePrices: { sell: number; buy: number };
}

/**
 * Build the scenario in two passes.
 *
 * Pass 1 runs the engine with NO round-2 trades, purely to learn what the
 * round-2 prices are. Pass 2 adds the trade pair struck at exactly those values
 * and runs the real recompute — which asserts price-integrity and THROWS if the
 * prices are wrong. So the scenario cannot be built with a mispriced trade.
 */
export function buildOddSeason(): OddSeason {
  const probeRaw = buildRaw([]);
  const probeDerived = recomputeSeason(probeRaw);

  const sell = priceEnteringRound(probeDerived, probeRaw, pid(TRADE_OUT), 2);
  const buy = priceEnteringRound(probeDerived, probeRaw, pid(TRADE_IN), 2);

  const r2Trades: RawTrade[] = [
    {
      id: "77ade0dd-0000-4000-8000-000000000ff1",
      fantasyTeamId: tid(TRADE_TEAM),
      kind: "sell",
      playerId: pid(TRADE_OUT),
      price: sell,
      roundId: R2,
      createdAt: "2026-10-08T01:00:00Z",
    },
    {
      id: "77ade0dd-0000-4000-8000-000000000ff2",
      fantasyTeamId: tid(TRADE_TEAM),
      kind: "buy",
      playerId: pid(TRADE_IN),
      price: buy,
      roundId: R2,
      createdAt: "2026-10-08T01:00:01Z",
    },
  ];

  const raw = buildRaw(r2Trades);
  const derived = recomputeSeason(raw); // throws on any price-integrity defect
  return { raw, derived, tradePrices: { sell, buy } };
}
