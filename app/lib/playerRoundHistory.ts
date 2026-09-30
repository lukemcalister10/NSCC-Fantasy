import type { PlayerProfile } from "./queries";
import type { RoundBasic } from "./teamQueries";

export interface PlayerRoundHistoryRow {
  key: string;
  label: string;
  score: number | "DNP" | null;
  price: number | null;
  move: number | null;
}

/** One row per completed round, including a flat-price DNP row. */
export function playerRoundHistory(
  player: Pick<PlayerProfile, "starting_price" | "priceHistory" | "scores">,
  rounds: RoundBasic[],
): PlayerRoundHistoryRow[] {
  const startingPrice = player.priceHistory.find((point) => point.match_id === null)?.price
    ?? player.starting_price;
  const rows: PlayerRoundHistoryRow[] = [{
    key: "start", label: "Starting price", score: null, price: startingPrice, move: null,
  }];
  let lastPrice = startingPrice;
  const priceByMatch = new Map(player.priceHistory.filter((point) => point.match_id !== null)
    .map((point) => [point.match_id, point]));

  for (const round of [...rounds].sort((a, b) => a.seq - b.seq)) {
    if (!round.matches.length || !round.matches.every((match) =>
      match.status === "finalised" || match.status === "abandoned")) continue;
    const scores = player.scores.filter((score) => score.matches?.rounds?.seq === round.seq && score.played);
    if (!scores.length) {
      rows.push({ key: round.id, label: `After ${round.name}`, score: "DNP", price: lastPrice, move: null });
      continue;
    }
    const lastPoint = scores.map((score) => priceByMatch.get(score.match_id))
      .filter((point): point is NonNullable<typeof point> => !!point)
      .sort((a, b) => a.seq - b.seq).at(-1);
    const nextPrice = lastPoint?.price ?? null;
    rows.push({
      key: round.id,
      label: `After ${round.name}`,
      score: scores.reduce((total, score) => total + score.base, 0),
      price: nextPrice,
      move: nextPrice !== null && lastPrice !== null ? nextPrice - lastPrice : null,
    });
    if (nextPrice !== null) lastPrice = nextPrice;
  }
  return rows;
}
