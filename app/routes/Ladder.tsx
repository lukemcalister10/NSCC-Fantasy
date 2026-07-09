import { useSeason, useLadder, useLeaderboard } from "../lib/queries";
import { BroadcastPanel } from "../components/BroadcastPanel";
import { Loading, ErrorState, EmptyState } from "../components/states";

/**
 * Ladder + overall leaderboard. The ladder HEADER uses the reserved broadcast
 * treatment (navy #0d1b45 / chrome #193889); the rows themselves stay on the
 * clean white base. Ranking: premiership points (2·w + t) then points-for (D11/D20).
 */
export function Ladder() {
  const season = useSeason();
  const seasonId = season.data?.id;
  const ladder = useLadder(seasonId);
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

      {ladder.isLoading ? (
        <Loading />
      ) : ladder.error ? (
        <ErrorState error={ladder.error} />
      ) : ladder.data && ladder.data.length > 0 ? (
        <div className="card table-card">
          <table className="table ladder-table">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th>Team</th>
                <th className="col-num">P</th>
                <th className="col-num">W</th>
                <th className="col-num">L</th>
                <th className="col-num">T</th>
                <th className="col-num">PF</th>
                <th className="col-num col-pts">Pts</th>
              </tr>
            </thead>
            <tbody>
              {ladder.data.map((row, i) => (
                <tr key={row.fantasy_team_id}>
                  <td className="col-rank num">{i + 1}</td>
                  <td className="team-name">{row.fantasy_teams?.name ?? "—"}</td>
                  <td className="col-num num">{row.played}</td>
                  <td className="col-num num">{row.wins}</td>
                  <td className="col-num num">{row.losses}</td>
                  <td className="col-num num">{row.ties}</td>
                  <td className="col-num num">{row.points_for}</td>
                  <td className="col-num num col-pts">
                    <span className="score-chip">{row.ladder_points}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          No rounds have been scored yet — the ladder fills in after the first
          finalised round.
        </EmptyState>
      )}

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
                  <td className="team-name">{row.fantasy_teams?.name ?? "—"}</td>
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
