import { Link, useSearchParams } from "react-router-dom";
import { useCompletedLeaderboardRounds, useLeaderboard, useRoundLeaderboard, useTeamOwners } from "../lib/queries";
import { rankPointsLeaderboard, selectedLeaderboardRound } from "../lib/pointsLeaderboard";
import { Loading, ErrorState, EmptyState } from "./states";

export function PointsLeaderboard({ seasonId }: { seasonId: string | undefined }) {
  const [params, setParams] = useSearchParams();
  const byRound = params.get("points") === "round";
  const rounds = useCompletedLeaderboardRounds(seasonId);
  const selected = selectedLeaderboardRound(rounds.data ?? [], params.get("round"));
  const overall = useLeaderboard(seasonId);
  const roundBoard = useRoundLeaderboard(seasonId, byRound ? selected?.id : undefined);
  const board = byRound ? roundBoard : overall;
  const owners = useTeamOwners((board.data ?? []).map(row => row.fantasy_team_id));
  const ranked = rankPointsLeaderboard(board.data ?? []);

  function changeView(roundView: boolean) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (roundView) next.set("points", "round");
      else next.delete("points");
      return next;
    }, { preventScrollReset: true });
  }

  return <section aria-labelledby="points-leaderboard-title">
    <h2 id="points-leaderboard-title" className="section-title">Points leaderboard</h2>
    <div className="points-leaderboard-controls">
      <div className="team-tabs points-leaderboard-tabs" role="group" aria-label="Points leaderboard view">
        <button type="button" className={`team-tab${!byRound ? " team-tab-active" : ""}`} aria-pressed={!byRound} onClick={() => changeView(false)}>Overall</button>
        <button type="button" className={`team-tab${byRound ? " team-tab-active" : ""}`} aria-pressed={byRound} onClick={() => changeView(true)}>By round</button>
      </div>
      {byRound && selected ? <label className="points-round-picker">
        <span className="visually-hidden">Round</span>
        <select value={selected.id} onChange={event => {
          const id = event.target.value;
          setParams(previous => {
            const next = new URLSearchParams(previous);
            next.set("round", id);
            return next;
          }, { preventScrollReset: true });
        }}>
          {rounds.data?.map(round => <option key={round.id} value={round.id}>{round.name}</option>)}
        </select>
      </label> : null}
    </div>
    <div aria-live="polite" aria-busy={board.isFetching || (byRound && rounds.isFetching)}>
      {byRound && rounds.isLoading ? <Loading /> :
        byRound && rounds.error ? <ErrorState error={rounds.error} /> :
        byRound && !selected ? <EmptyState>No completed rounds yet.</EmptyState> :
        board.isLoading ? <Loading /> :
        board.error ? <ErrorState error={board.error} /> :
        ranked.length === 0 ? <EmptyState>{byRound ? "No published scores for this round yet." : "No points recorded yet."}</EmptyState> :
        <div className="card table-card">
          <table className="table points-leaderboard-table">
            <caption className="visually-hidden">{byRound ? `${selected?.name} points leaderboard` : "Overall points leaderboard"}</caption>
            <thead><tr><th className="col-rank">#</th><th>Team</th><th className="col-num col-pts">{byRound ? `${selected?.name} points` : "Total points"}</th></tr></thead>
            <tbody>{ranked.map(row => <tr key={row.fantasy_team_id}>
              <td className="col-rank num">{row.rank}</td>
              <td className="team-name"><Link className="team-profile-link" to={`/teams/${row.fantasy_team_id}`}>{row.fantasy_teams?.name ?? "—"}</Link>{owners.data?.get(row.fantasy_team_id) ? <span className="ladder-owner"> — {owners.data.get(row.fantasy_team_id)}</span> : null}</td>
              <td className="col-num num col-pts"><span className="score-chip">{row.total_points}</span></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>
  </section>;
}
