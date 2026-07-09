import { CapLedger } from "../engines/capLedger.js";
import { repriceAfterMatch } from "../engines/pricing.js";
import { scoreMatch } from "../engines/scoring.js";
import type { MatchScorecard } from "../types.js";
import { computeH2hResults } from "./h2h.js";
import { computeLadder } from "./ladder.js";
import { computeOverallLeaderboard } from "./overallLeaderboard.js";
import { computeTeamRoundScores } from "./teamRoundScoring.js";
import type {
  DerivedCapSnapshot,
  DerivedPlayerMatchScore,
  DerivedPricePoint,
  DerivedState,
  RawMatch,
  RawScorecard,
  RawSeason,
} from "./types.js";

/**
 * RECOMPUTE ORCHESTRATOR — the pure, deterministic function at the heart of G3.
 * Given a RawSeason (raw scorecards + frozen config, the sole truth) it derives
 * all state; run twice on equal input it returns byte-identical output. Composes
 * the existing engines (scoreMatch, repriceAfterMatch, CapLedger) unchanged.
 *
 * The FULL chain is derived here: player match scores, price history and cap
 * snapshots (core), plus team-round scores (captaincy applied per D10), H2H
 * results, the ladder and the overall leaderboard (the deferred engines, G3 +
 * G9). Every family is a pure, deterministic function of RawSeason.
 *
 * Determinism rests on: stable sort keys everywhere (matches by round seq then
 * finalised-at then id; players/teams by id; every derived array keyed on the
 * exact string columns readDerived orders by), integer money/points via the
 * engines' epsilon-guarded rounding, and no wall-clock / random input.
 */

// scoreMatch requires captain/VC fields, but fantasy captaincy is per-team and we
// only consume the pre-captaincy `base` here, so a sentinel that is never in any
// lineup (registry ids are uuids) leaves base untouched and applies no doubling.
const NO_CAPTAIN = "";

export function recomputeSeason(raw: RawSeason): DerivedState {
  const { config } = raw;
  const roundSeqById = new Map(raw.rounds.map((r) => [r.id, r.seq]));
  const scorecardByMatch = new Map(raw.scorecards.map((s) => [s.matchId, s]));

  // Finalised matches only, in a stable chronological order.
  const finalisedMatches = raw.matches
    .filter((m) => m.status === "finalised")
    .sort(compareMatches(roundSeqById));

  // ---- 1. Per-player match scores (base, pre-captaincy) --------------------
  const playerMatchScores: DerivedPlayerMatchScore[] = [];
  const scoreByMatchPlayer = new Map<string, Map<string, DerivedPlayerMatchScore>>();

  for (const match of finalisedMatches) {
    const scorecard = scorecardByMatch.get(match.id);
    if (!scorecard) continue; // finalised but no scorecard entered yet
    const result = scoreMatch(buildCard(match, scorecard), config.scoring);
    const perPlayer = new Map<string, DerivedPlayerMatchScore>();
    for (const [playerId, ps] of result.scores) {
      const row: DerivedPlayerMatchScore = {
        matchId: match.id,
        playerId,
        played: ps.played,
        batting: ps.batting,
        bowling: ps.bowling,
        fielding: ps.fielding,
        bonuses: ps.bonuses,
        base: ps.base,
      };
      playerMatchScores.push(row);
      perPlayer.set(playerId, row);
    }
    scoreByMatchPlayer.set(match.id, perPlayer);
  }

  // ---- 2. Price history (one movement per finalised match played) ----------
  const priceHistory: DerivedPricePoint[] = [];
  const seedByPlayer = new Map<string, number>();
  // Per player: ordered movements as {roundSeq, price} for price-entering-round.
  const movementsByPlayer = new Map<string, { roundSeq: number; price: number }[]>();

  for (const player of raw.players) {
    const seed = player.startingPrice ?? config.pricing.floor;
    seedByPlayer.set(player.id, seed);
    movementsByPlayer.set(player.id, []);
    priceHistory.push({ playerId: player.id, matchId: null, seq: 0, price: seed });
  }

  const nextSeq = new Map<string, number>(); // per-player running seq (seed used 0)
  for (const match of finalisedMatches) {
    const roundSeq = roundSeqById.get(match.roundId) ?? 0;
    const perPlayer = scoreByMatchPlayer.get(match.id);
    if (!perPlayer) continue;
    // Sort players within the match by id for a stable emission order.
    for (const playerId of [...perPlayer.keys()].sort()) {
      const score = perPlayer.get(playerId)!;
      if (!score.played) continue; // DNP freeze (D2) — no movement
      const prevPrice = currentPrice(playerId, seedByPlayer, movementsByPlayer);
      const price = repriceAfterMatch(prevPrice, score.base, config.pricing);
      const seq = (nextSeq.get(playerId) ?? 0) + 1;
      nextSeq.set(playerId, seq);
      movementsByPlayer.get(playerId)!.push({ roundSeq, price });
      priceHistory.push({ playerId, matchId: match.id, seq, price });
    }
  }

  // ---- 3. Cap snapshots per fantasy team (from the trades ledger) ----------
  const teamCapSnapshots: DerivedCapSnapshot[] = [];
  const latestRoundId = latestRound(raw);
  const tradesByTeam = new Map<string, RawSeason["trades"]>();
  for (const t of raw.trades) {
    (tradesByTeam.get(t.fantasyTeamId) ?? tradesByTeam.set(t.fantasyTeamId, []).get(t.fantasyTeamId)!).push(t);
  }

  for (const team of raw.fantasyTeams) {
    if (latestRoundId === null) break; // no rounds -> no as-of point
    const ledger = new CapLedger(config.squad.cap);
    const teamTrades = (tradesByTeam.get(team.id) ?? [])
      .slice()
      .sort((a, b) =>
        a.createdAt === b.createdAt ? cmp(a.id, b.id) : cmp(a.createdAt, b.createdAt),
      );

    for (const trade of teamTrades) {
      // Rider 2: the recorded trade price MUST equal the derived price the player
      // carries entering the trade's round; loud failure otherwise.
      const tradeRoundSeq = roundSeqById.get(trade.roundId) ?? 0;
      const expected = priceEnteringRound(
        trade.playerId,
        tradeRoundSeq,
        seedByPlayer,
        movementsByPlayer,
      );
      if (trade.price !== expected) {
        throw new Error(
          `recompute price-integrity: trade ${trade.id} (${trade.kind} ${trade.playerId}) ` +
            `recorded ${trade.price} but derived price entering round seq ${tradeRoundSeq} is ${expected}`,
        );
      }
      if (trade.kind === "buy") ledger.buy(trade.playerId, trade.price, tradeRoundSeq);
      else ledger.sell(trade.playerId, trade.price, tradeRoundSeq);
    }

    const priceOf = (playerId: string): number =>
      currentPrice(playerId, seedByPlayer, movementsByPlayer);
    teamCapSnapshots.push({
      fantasyTeamId: team.id,
      asOfRoundId: latestRoundId,
      capRemaining: ledger.capRemaining(),
      investedValue: ledger.investedValue(priceOf),
      teamValue: ledger.teamValue(priceOf),
    });
  }

  // ---- 4. Full chain: team-round scores → H2H → ladder → overall ----------
  // Active rounds: >=1 finalised OR abandoned match (operator washout convention).
  // An all-abandoned round is active with all-zero totals (every pairing ties,
  // the bye ties a median of 0). Scoring above already excludes abandoned
  // matches, so they contribute no score rows and no price movements (D2).
  const activeStatuses = new Set(["finalised", "abandoned"]);
  const activeRoundIds = new Set(
    raw.matches.filter((m) => activeStatuses.has(m.status)).map((m) => m.roundId),
  );
  const activeRoundIdsBySeq = raw.rounds
    .filter((r) => activeRoundIds.has(r.id))
    .slice()
    .sort((a, b) => a.seq - b.seq || cmp(a.id, b.id))
    .map((r) => r.id);

  const teamIds = raw.fantasyTeams.map((t) => t.id).slice().sort(cmp);
  const roundIdByMatch = new Map(raw.matches.map((m) => [m.id, m.roundId]));

  const teamRoundScores = computeTeamRoundScores({
    teamIds,
    roundIds: activeRoundIdsBySeq,
    selections: raw.selections,
    playerMatchScores,
    roundIdByMatch,
  });
  const h2hResults = computeH2hResults({
    teamIds,
    activeRoundIdsBySeq,
    teamRoundScores,
  });
  const ladder = computeLadder({ teamIds, teamRoundScores, h2hResults });
  const overallLeaderboard = computeOverallLeaderboard(teamIds, teamRoundScores);

  return {
    playerMatchScores: playerMatchScores.sort(
      (a, b) => cmp(a.matchId, b.matchId) || cmp(a.playerId, b.playerId),
    ),
    priceHistory: priceHistory.sort(
      (a, b) => cmp(a.playerId, b.playerId) || a.seq - b.seq,
    ),
    teamCapSnapshots: teamCapSnapshots.sort(
      (a, b) => cmp(a.fantasyTeamId, b.fantasyTeamId) || cmp(a.asOfRoundId, b.asOfRoundId),
    ),
    teamRoundScores,
    h2hResults,
    ladder,
    overallLeaderboard,
  };
}

// ---- helpers ----------------------------------------------------------------

function buildCard(match: RawMatch, scorecard: RawScorecard): MatchScorecard {
  const card: MatchScorecard = {
    matchId: match.id,
    lineup: scorecard.lineup,
    captain: NO_CAPTAIN,
    viceCaptain: NO_CAPTAIN,
    clubBatting: scorecard.batting.map((b) => ({
      player: b.playerId,
      runs: b.runs,
      ballsFaced: b.ballsFaced,
      fours: b.fours,
      sixes: b.sixes,
    })),
    clubBowling: scorecard.bowling.map((b) => ({
      player: b.playerId,
      overs: b.overs,
      runsConceded: b.runsConceded,
      wickets: b.wickets,
    })),
    oppositionDismissals: scorecard.dismissals,
  };
  if (scorecard.wicketKeeperPlayerId) {
    card.wicketKeeper = scorecard.wicketKeeperPlayerId;
  }
  return card;
}

function compareMatches(
  roundSeqById: Map<string, number>,
): (a: RawMatch, b: RawMatch) => number {
  return (a, b) => {
    const ra = roundSeqById.get(a.roundId) ?? 0;
    const rb = roundSeqById.get(b.roundId) ?? 0;
    if (ra !== rb) return ra - rb;
    const fa = a.finalisedAt ?? "";
    const fb = b.finalisedAt ?? "";
    return cmp(fa, fb) || cmp(a.id, b.id);
  };
}

/** Latest (max-seq) round id, or null if the season has no rounds. */
function latestRound(raw: RawSeason): string | null {
  let best: { id: string; seq: number } | null = null;
  for (const r of raw.rounds) {
    if (best === null || r.seq > best.seq) best = { id: r.id, seq: r.seq };
  }
  return best?.id ?? null;
}

/** The player's most recent derived price (last movement, else seed). */
function currentPrice(
  playerId: string,
  seedByPlayer: Map<string, number>,
  movementsByPlayer: Map<string, { roundSeq: number; price: number }[]>,
): number {
  const moves = movementsByPlayer.get(playerId);
  if (moves && moves.length > 0) return moves[moves.length - 1]!.price;
  return seedByPlayer.get(playerId) ?? 0;
}

/** Price the player carries entering `roundSeq` (last movement in an earlier round). */
function priceEnteringRound(
  playerId: string,
  roundSeq: number,
  seedByPlayer: Map<string, number>,
  movementsByPlayer: Map<string, { roundSeq: number; price: number }[]>,
): number {
  const moves = movementsByPlayer.get(playerId) ?? [];
  let price = seedByPlayer.get(playerId) ?? 0;
  for (const m of moves) {
    if (m.roundSeq < roundSeq) price = m.price;
    else break; // moves are in chronological (round seq ascending) order
  }
  return price;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
