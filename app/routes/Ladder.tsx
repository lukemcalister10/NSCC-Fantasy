import { useSeason } from "../lib/queries";
import { BroadcastPanel } from "../components/BroadcastPanel";
import { SortableLadder } from "../components/SortableLadder";
import { PointsLeaderboard } from "../components/PointsLeaderboard";
import { Loading, ErrorState, EmptyState } from "../components/states";
import "../styles/team.css";

/**
 * Ladder + overall leaderboard. The ladder HEADER uses the reserved broadcast
 * treatment (navy #0d1b45 / chrome #193889); the rows themselves stay on the
 * clean white base. Ranking: premiership points (2·w + t) then points-for (D11/D20).
 */
export function Ladder() {
  const season = useSeason();
  const seasonId = season.data?.id;

  if (season.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data)
    return (
      <div className="page">
        <EmptyState>No season found yet.</EmptyState>
      </div>
    );

  return (
    <div className="page">
      <BroadcastPanel className="ladder-hero">
        <div className="ladder-hero-kicker">{season.data.name}</div>
        <h1 className="ladder-hero-title">Ladder</h1>
        <p className="ladder-hero-sub">
          H2H standings · win 2 / tie 1 / loss 0
        </p>
      </BroadcastPanel>

      <SortableLadder seasonId={seasonId} />

      <PointsLeaderboard seasonId={seasonId} />
    </div>
  );
}
