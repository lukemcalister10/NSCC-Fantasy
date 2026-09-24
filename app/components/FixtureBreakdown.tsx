import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { usePlayers, type RoundView } from "../lib/queries";
import { supabase } from "../lib/supabase";
import { countedPlayersForRound } from "../../src/recompute/roundScoringPolicy";
import { scoreTeamRound } from "../../src/recompute/teamRoundScoring";
import { PlayerAvatar } from "./PlayerAvatar";
import { ErrorState, Loading } from "./states";

interface FixtureSelection {
  fantasy_team_id: string;
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
}
interface FixtureScore { player_id: string; match_id: string; base: number; played: boolean }

function useFixtureSelections(roundId: string | undefined, teamIds: string[]) {
  return useQuery({
    queryKey: ["fixture-selections", roundId, [...teamIds].sort().join(",")],
    enabled: !!roundId && teamIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<FixtureSelection[]> => {
      const result = await supabase.from("selections")
        .select("fantasy_team_id,player_id,is_captain,is_vice_captain")
        .eq("round_id", roundId!).in("fantasy_team_id", teamIds);
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    },
  });
}

function useFixtureScores(matchIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ["fixture-player-scores", [...matchIds].sort().join(",")],
    enabled: enabled && matchIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<FixtureScore[]> => {
      const result = await supabase.from("player_match_scores")
        .select("match_id,player_id,base,played").in("match_id", matchIds);
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    },
  });
}

export function FixtureBreakdown({ seasonId, round, snapshotRound, homeId, awayId,
  homeName, awayName, completed, homePoints, awayPoints }: {
  seasonId: string;
  round: RoundView;
  snapshotRound: RoundView | undefined;
  homeId: string;
  awayId: string | null;
  homeName: string;
  awayName: string | null;
  completed: boolean;
  homePoints: number | undefined;
  awayPoints: number | null | undefined;
}) {
  const location = useLocation();
  const teamIds = awayId ? [homeId, awayId] : [homeId];
  const selections = useFixtureSelections(snapshotRound?.id, teamIds);
  const scores = useFixtureScores(round.matches.map((match) => match.id), completed);
  const players = usePlayers(seasonId, true);

  if (!snapshotRound) return <p className="fixture-snapshot-note">Squads appear after the first lockout.</p>;
  if (selections.isLoading || players.isLoading || (completed && scores.isLoading)) return <Loading />;
  const error = selections.error ?? players.error ?? (completed ? scores.error : null);
  if (error) return <ErrorState error={error} />;

  const byId = new Map((players.data ?? []).map((player) => [player.id, player]));
  const roundScores = new Map<string, { base: number; played: boolean }>();
  for (const score of scores.data ?? []) {
    const previous = roundScores.get(score.player_id);
    roundScores.set(score.player_id, { base: (previous?.base ?? 0) + score.base, played: score.played || (previous?.played ?? false) });
  }
  const home = (selections.data ?? []).filter((selection) => selection.fantasy_team_id === homeId);
  const away = (selections.data ?? []).filter((selection) => selection.fantasy_team_id === awayId);
  const shared = new Set(home.map((selection) => selection.player_id).filter((id) => away.some((selection) => selection.player_id === id)));
  const count = countedPlayersForRound(seasonId, round.seq);

  function side(teamSelections: FixtureSelection[], teamName: string, expected: number | null | undefined) {
    const ranked = [...teamSelections].sort((a, b) =>
      Number(shared.has(a.player_id)) - Number(shared.has(b.player_id)) ||
      (shared.has(a.player_id) ? (byId.get(a.player_id)?.display_name ?? "").localeCompare(byId.get(b.player_id)?.display_name ?? "") :
        completed ? (roundScores.get(b.player_id)?.base ?? 0) - (roundScores.get(a.player_id)?.base ?? 0) :
          (byId.get(a.player_id)?.display_name ?? "").localeCompare(byId.get(b.player_id)?.display_name ?? "")));
    const calculated = completed ? scoreTeamRound(teamSelections.map((selection) => ({
      playerId: selection.player_id,
      base: roundScores.get(selection.player_id)?.base ?? 0,
      played: roundScores.get(selection.player_id)?.played ?? false,
      isCaptain: selection.is_captain,
      isViceCaptain: selection.is_vice_captain,
    })), count) : null;
    const dropped = new Set(calculated?.droppedPlayerIds ?? []);
    return <div className="fixture-squad-side">
      <h4>{teamName}{expected !== null && expected !== undefined ? <span className="num">{expected} pts</span> : null}</h4>
      {teamSelections.length === 0 ? <p>No locked squad recorded.</p> : <>
        {ranked.map((selection, index) => {
          const player = byId.get(selection.player_id);
          const score = roundScores.get(selection.player_id);
          const isShared = shared.has(selection.player_id);
          return <div key={selection.player_id}>
            {(index === 0 || isShared !== shared.has(ranked[index - 1]!.player_id)) &&
              <div className="fixture-squad-group">{isShared ? "Shared players" : "Unique players"}</div>}
            <div className={`fixture-squad-player${dropped.has(selection.player_id) ? " fixture-squad-dropped" : ""}`}>
              <Link to={`/players/${selection.player_id}`} state={{ backgroundLocation: location }}>
                <PlayerAvatar name={player?.display_name ?? "Unknown player"} photoUrl={player?.photo_url ?? null} size={32} />
                <span>{player?.display_name ?? "Unknown player"}</span>
              </Link>
              <span className="fixture-squad-flags">
                {selection.is_captain ? "C" : selection.is_vice_captain ? "VC" : ""}
                {calculated?.captainPlayerId === selection.player_id ? " 2x" : ""}
                {dropped.has(selection.player_id) ? " dropped" : ""}
              </span>
              {completed ? <strong className="num">{score?.played ? score.base : "DNP"}</strong> : null}
            </div>
          </div>;
        })}
      </>}
      {completed && expected !== null && expected !== undefined && calculated && calculated.total !== expected ?
        <p className="fixture-snapshot-note">Score breakdown differs from the official total. Official fixture score remains {expected}.</p> : null}
    </div>;
  }

  return <div className="fixture-snapshot">
    <p className="fixture-snapshot-note">{snapshotRound.id === round.id ? `${round.name} locked squads` : `Squads as of ${snapshotRound.name} lockout. Open-round trades are hidden.`}</p>
    <div className="fixture-snapshot-grid">
      {side(home, homeName, homePoints)}
      {awayId && awayName ? side(away, awayName, awayPoints) : null}
    </div>
    {completed && count !== undefined ? <p className="fixture-snapshot-note">Best eight player scores plus the effective captain bonus.</p> : null}
  </div>;
}
