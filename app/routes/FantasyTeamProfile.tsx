import { Link, useParams } from "react-router-dom";
import { useLadder, usePlayers, useSeason, useTeamOwners, useTeamValues } from "../lib/queries";
import { useSeasonRounds, useTeamSelections } from "../lib/teamQueries";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { RoleBadge } from "../components/RoleBadge";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { money } from "../lib/format";

export function FantasyTeamProfile() {
  const { id } = useParams<{ id: string }>();
  const season = useSeason();
  const ladder = useLadder(season.data?.id);
  const rounds = useSeasonRounds(season.data?.id);
  const players = usePlayers(season.data?.id, true);
  const selections = useTeamSelections(id);
  const values = useTeamValues(id ? [id] : []);
  const owners = useTeamOwners(id ? [id] : []);

  if (season.isLoading || ladder.isLoading || rounds.isLoading || players.isLoading ||
      selections.isLoading || values.isLoading || owners.isLoading) return <Loading />;
  const error = season.error ?? ladder.error ?? rounds.error ?? players.error ??
    selections.error ?? values.error ?? owners.error;
  if (error) return <ErrorState error={error} />;

  const ordered = [...(ladder.data ?? [])].sort((a, b) =>
    b.ladder_points - a.ladder_points || b.points_for - a.points_for ||
    (a.fantasy_teams?.name ?? "").localeCompare(b.fantasy_teams?.name ?? ""));
  const rank = ordered.findIndex((row) => row.fantasy_team_id === id);
  const team = ordered[rank];
  if (!team) return <div className="page"><EmptyState>Team not found.</EmptyState></div>;

  const lastLocked = [...(rounds.data ?? [])]
    .filter((round) => new Date(round.lock_at).getTime() <= Date.now())
    .sort((a, b) => b.seq - a.seq)[0];
  const playerById = new Map((players.data ?? []).map((player) => [player.id, player]));
  const squad = (selections.data ?? [])
    .filter((selection) => selection.round_id === lastLocked?.id)
    .map((selection) => ({ ...selection, player: playerById.get(selection.player_id) }))
    .filter((selection) => selection.player)
    .sort((a, b) => (a.player!.display_name).localeCompare(b.player!.display_name));

  return (
    <div className="page">
      <Link to="/" className="back-link">← Ladder</Link>
      <h1 className="page-title">{team.fantasy_teams?.name ?? "Team"}</h1>
      {owners.data?.get(id!) ? <p className="page-sub">Managed by {owners.data.get(id!)}</p> : null}
      <div className="team-profile-facts">
        <div className="card"><span>Rank</span><strong className="num">#{rank + 1}</strong></div>
        <div className="card"><span>Record</span><strong className="num">{team.wins}W {team.losses}L {team.ties}T</strong></div>
        <div className="card"><span>Fantasy points</span><strong className="num">{team.points_for}</strong></div>
        <div className="card"><span>Team value</span><strong className="num">{money(values.data?.[0]?.team_value ?? null)}</strong></div>
      </div>
      <h2 className="section-title">{lastLocked ? `${lastLocked.name} locked squad` : "Locked squad"}</h2>
      {!lastLocked ? <EmptyState>No round has locked yet.</EmptyState> : squad.length === 0 ? (
        <EmptyState>No locked selection recorded for this team.</EmptyState>
      ) : (
        <div className="card table-card">
          <table className="table team-profile-squad">
            <thead><tr><th>Player</th><th>Role</th><th className="col-num">Current price</th><th>Captaincy</th></tr></thead>
            <tbody>{squad.map((selection) => <tr key={selection.player_id}>
              <td><Link to={`/players/${selection.player_id}`} className="team-profile-player"><PlayerAvatar name={selection.player!.display_name} photoUrl={selection.player!.photo_url} size={42} />{selection.player!.display_name}</Link></td>
              <td><RoleBadge role={selection.player!.role} wkEligible={selection.player!.wk_eligible} /></td>
              <td className="col-num num">{money(selection.player!.currentPrice)}</td>
              <td>{selection.is_captain ? "Captain" : selection.is_vice_captain ? "Vice-captain" : ""}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
