import { useSeason, useLeaderboard } from "../lib/queries";
import { Link } from "react-router-dom";
import { BroadcastPanel } from "../components/BroadcastPanel";
import { SortableLadder } from "../components/SortableLadder";
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
  const board = useLeaderboard(seasonId);

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

      <h2 className="section-title">Overall points leaderboard</h2>
      {board.isLoading ? (
        <Loading />
      ) : board.error ? (
        <ErrorState error={board.error} />
      ) : board.data && board.data.length > 0 ? (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th>Team</th>
                <th className="col-num col-pts">Total</th>
              </tr>
            </thead>
            <tbody>
              {board.data.map((row, i) => (
                <tr key={row.fantasy_team_id}>
                  <td className="col-rank num">{i + 1}</td>
                  <td className="team-name"><Link className="team-profile-link" to={`/teams/${row.fantasy_team_id}`}>{row.fantasy_teams?.name ?? "—"}</Link></td>
                  <td className="col-num num col-pts">
                    <span className="score-chip">{row.total_points}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No points recorded yet.</EmptyState>
      )}
    </div>
  );
}
