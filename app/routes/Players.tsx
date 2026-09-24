import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSeason, usePlayers, usePlayerAverages, useOwnershipCounts, type PlayerListItem } from "../lib/queries";
import { RoleBadge } from "../components/RoleBadge";
import { PriceMovement } from "../components/PriceMovement";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { Loading, ErrorState, EmptyState } from "../components/states";
import { money } from "../lib/format";
import { activeRoundOf, useSeasonRounds } from "../lib/teamQueries";
import { usePlayerAvailability } from "../lib/playerAvailability";
import { PlayerAvailabilityDot } from "../components/PlayerAvailabilityDot";

type Sort = "price" | "name" | "role" | "average" | "owned" | "change";

const roleOrder: Record<string, number> = { BAT: 0, AR: 1, WK: 2, BWL: 3 };

function sortPlayers(
  rows: PlayerListItem[], sort: Sort,
  averages: Map<string, number>, owned: Map<string, number>, changes: Map<string, number>, descending: boolean,
): PlayerListItem[] {
  const out = [...rows];
  if (sort === "name") out.sort((a, b) => a.display_name.localeCompare(b.display_name));
  else if (sort === "role")
    out.sort(
      (a, b) =>
        (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) ||
        (b.currentPrice ?? 0) - (a.currentPrice ?? 0),
    );
  else if (sort === "average") out.sort((a, b) => (averages.get(b.id) ?? -1) - (averages.get(a.id) ?? -1));
  else if (sort === "owned") out.sort((a, b) => (owned.get(b.id) ?? 0) - (owned.get(a.id) ?? 0));
  else if (sort === "change") out.sort((a, b) => (changes.get(b.id) ?? 0) - (changes.get(a.id) ?? 0));
  else out.sort((a, b) => (b.currentPrice ?? 0) - (a.currentPrice ?? 0));
  return descending === (sort !== "name" && sort !== "role") ? out : out.reverse();
}

const headings: { key: Sort; label: string; title?: string }[] = [
  { key: "name", label: "Player" },
  { key: "role", label: "Role" },
  { key: "average", label: "Average", title: "Fantasy points per match played" },
  { key: "owned", label: "Ownership", title: "Teams selecting this player in the current round" },
  { key: "change", label: "Ownership change", title: "Change in teams since the previous round" },
  { key: "price", label: "Price" },
];

/**
 * Player price list — SuperCoach density: role badge, price, movement arrows,
 * per-row stats. Current price is the latest `price_history` point (movement =
 * last − previous); rows link to the player profile.
 */
export function Players() {
  const location = useLocation();
  const season = useSeason();
  const players = usePlayers(season.data?.id);
  const rounds = useSeasonRounds(season.data?.id);
  const activeRound = activeRoundOf(rounds.data);
  const ownershipRound = activeRound ?? rounds.data?.[rounds.data.length - 1];
  const availability = usePlayerAvailability(activeRound?.id);
  const averages = usePlayerAverages(season.data?.id);
  const previousRound = rounds.data?.find((round) => round.seq === (ownershipRound?.seq ?? 0) - 1);
  const ownership = useOwnershipCounts([ownershipRound?.id, previousRound?.id].filter((id): id is string => !!id));
  const [sort, setSort] = useState<Sort>("price");
  const [descending, setDescending] = useState(true);

  function changeSort(key: Sort) {
    if (key === sort) setDescending((current) => !current);
    else {
      setSort(key);
      setDescending(key !== "name" && key !== "role");
    }
  }

  const owned = useMemo(() => new Map(
    (ownership.data ?? []).filter((row) => row.round_id === ownershipRound?.id)
      .map((row) => [row.player_id, row.selected_count]),
  ), [ownership.data, ownershipRound?.id]);
  const changes = useMemo(() => {
    const prior = new Map((ownership.data ?? []).filter((row) => row.round_id === previousRound?.id)
      .map((row) => [row.player_id, row.selected_count]));
    return new Map([...owned].map(([id, count]) => [id, count - (prior.get(id) ?? 0)]));
  }, [ownership.data, previousRound?.id, owned]);

  const rows = useMemo(
    () => (players.data ? sortPlayers(players.data, sort, averages.data ?? new Map(), owned, changes, descending) : []),
    [players.data, sort, descending, averages.data, owned, changes],
  );

  return (
    <div className="page">
      <h1 className="page-title">Players</h1>
      <p className="page-sub">Prices update once per completed match.</p>

      <div className="toolbar">
        {players.data ? (
          <span className="toolbar-count">{players.data.length} players</span>
        ) : null}
      </div>

      {season.isLoading || players.isLoading || averages.isLoading || ownership.isLoading ? (
        <Loading />
      ) : players.error ? (
        <ErrorState error={players.error} />
      ) : averages.error ? (
        <ErrorState error={averages.error} />
      ) : ownership.error ? (
        <ErrorState error={ownership.error} />
      ) : rows.length === 0 ? (
        <EmptyState>No players in the pool yet.</EmptyState>
      ) : (
        <div className="card table-card">
          <table className="table players-table">
            <thead><tr>
              <th className="players-photo-col" aria-label="Photo" />
              {headings.map(({ key, label, title }) => (
                <th key={key} className={key === "name" || key === "role" ? undefined : "col-num"} aria-sort={sort === key ? descending ? "descending" : "ascending" : "none"}>
                  <button type="button" className="players-sort" title={title} onClick={() => changeSort(key)}>
                    {label}<span aria-hidden="true">{sort === key ? descending ? " ↓" : " ↑" : " ↕"}</span>
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td className="players-photo-col"><Link to={`/players/${p.id}`} state={{ backgroundLocation: location }} aria-label={`View ${p.display_name}`}><PlayerAvatar name={p.display_name} size={54} photoUrl={p.photo_url} /></Link></td>
                <td className="team-name">
                  <span className="squad-player-name-row"><Link to={`/players/${p.id}`} state={{ backgroundLocation: location }} className="players-name-link">{p.display_name}</Link><PlayerAvailabilityDot status={availability.data?.get(p.id)} /></span>
                  <span className="player-start">from {money(p.starting_price)}</span>
                </td>
                <td><RoleBadge role={p.role} wkEligible={p.wk_eligible} /></td>
                <td className="col-num num">{averages.data?.has(p.id) ? averages.data.get(p.id)!.toFixed(1) : "—"}</td>
                <td className="col-num num">{ownershipRound ? owned.get(p.id) ?? 0 : "—"}</td>
                <td className="col-num num">{previousRound ? `${(changes.get(p.id) ?? 0) > 0 ? "+" : ""}${changes.get(p.id) ?? 0}` : "—"}</td>
                <td className="col-num"><span className="price-now num">{money(p.currentPrice)}</span><PriceMovement delta={p.movement} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
