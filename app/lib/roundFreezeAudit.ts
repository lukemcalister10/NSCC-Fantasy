export interface FreezeMatch {
  id: string;
  grade: string;
  opponent: string;
  status: "scheduled" | "in_progress" | "finalised" | "abandoned";
  finalised_at: string | null;
}

export interface FreezeScorecard {
  id: string;
  match_id: string;
  review_state: "draft" | "committed";
}

export interface FreezeLineupRow {
  scorecard_id: string;
  player_id: string;
}

export interface FreezeScoreRow {
  match_id: string;
  player_id: string;
  played: boolean;
}

export interface FreezePriceRow {
  match_id: string;
  player_id: string;
}

export interface FreezeMatchReport {
  match: FreezeMatch;
  lineup: string[];
  scoreCount: number;
  priceCount: number;
  blockers: string[];
}

export interface RoundFreezeAudit {
  matches: FreezeMatchReport[];
  blockers: string[];
}

function samePlayers(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length &&
    expected.every((id) => actual.includes(id));
}

/** Coverage checks only. A human must still confirm who actually played and the raw figures. */
export function evaluateRoundFreeze(
  matches: FreezeMatch[],
  cards: FreezeScorecard[],
  lineups: FreezeLineupRow[],
  scores: FreezeScoreRow[],
  prices: FreezePriceRow[],
  names: Map<string, string> = new Map(),
): RoundFreezeAudit {
  const blockers: string[] = [];
  if (matches.length === 0) blockers.push("No club matches are assigned to this round.");

  const reports = matches.map((match) => {
    const issues: string[] = [];
    const label = `${match.grade} v ${match.opponent}`;
    const card = cards.find((item) => item.match_id === match.id);
    const playerIds = lineups.filter((item) => item.scorecard_id === card?.id)
      .map((item) => item.player_id);
    const matchScores = scores.filter((item) => item.match_id === match.id);
    const matchPrices = prices.filter((item) => item.match_id === match.id);

    if (match.status === "scheduled" || match.status === "in_progress") {
      issues.push("Match is not finalised or abandoned.");
    } else if (match.status === "abandoned") {
      if (matchScores.length || matchPrices.length) {
        issues.push("Abandoned match still has published scores or price entries. Recompute first.");
      }
    } else {
      if (!match.finalised_at) issues.push("Finalisation time is missing.");
      if (!card) issues.push("Scorecard is missing.");
      else if (card.review_state !== "committed") issues.push("Scorecard is still a draft.");
      if (playerIds.length === 0) issues.push("No players are named as having played.");
      if (playerIds.length > 0 &&
          (!samePlayers(playerIds, matchScores.map((row) => row.player_id)) ||
           matchScores.some((row) => !row.played))) {
        issues.push("Published player scores do not match the named players. Recompute first.");
      }
      if (playerIds.length > 0 && !samePlayers(playerIds, matchPrices.map((row) => row.player_id))) {
        issues.push("Published price entries do not match the named players. Recompute first.");
      }
    }

    blockers.push(...issues.map((issue) => `${label}: ${issue}`));
    return {
      match,
      lineup: playerIds.map((id) => names.get(id) ?? id).sort((a, b) => a.localeCompare(b)),
      scoreCount: matchScores.length,
      priceCount: matchPrices.length,
      blockers: issues,
    };
  });
  return { matches: reports, blockers };
}

function dataOrThrow<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

/** Always reads fresh rows; the final freeze action runs this again before writing. */
export async function fetchRoundFreezeAudit(roundId: string): Promise<RoundFreezeAudit> {
  const { supabase } = await import("./supabase");
  const matches = dataOrThrow<FreezeMatch>(await supabase.from("matches")
    .select("id,grade,opponent,status,finalised_at").eq("round_id", roundId));
  if (matches.length === 0) return evaluateRoundFreeze([], [], [], [], []);

  const matchIds = matches.map((match) => match.id);
  const [cardsResult, scoresResult, pricesResult] = await Promise.all([
    supabase.from("scorecards").select("id,match_id,review_state").in("match_id", matchIds),
    supabase.from("player_match_scores").select("match_id,player_id,played").in("match_id", matchIds),
    supabase.from("price_history").select("match_id,player_id").in("match_id", matchIds),
  ]);
  const cards = dataOrThrow<FreezeScorecard>(cardsResult);
  const scores = dataOrThrow<FreezeScoreRow>(scoresResult);
  const prices = dataOrThrow<FreezePriceRow>(pricesResult) as FreezePriceRow[];
  const cardIds = cards.map((card) => card.id);
  const lineups = cardIds.length
    ? dataOrThrow<FreezeLineupRow>(await supabase.from("scorecard_lineup")
      .select("scorecard_id,player_id").in("scorecard_id", cardIds))
    : [];
  const playerIds = [...new Set(lineups.map((row) => row.player_id))];
  const players = playerIds.length
    ? dataOrThrow<{ id: string; display_name: string }>(await supabase.from("players")
      .select("id,display_name").in("id", playerIds))
    : [];
  return evaluateRoundFreeze(matches, cards, lineups, scores, prices,
    new Map(players.map((player) => [player.id, player.display_name])));
}
