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
  averages: Map<string, number>, owned: Map<string, number>, changes: Map<string, number>,
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
  return out;
}

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
    () => (players.data ? sortPlayers(players.data, sort, averages.data ?? new Map(), owned, changes) : []),
    [players.data, sort, averages.data, owned, changes],
  );

  return (
    <div className="page">
      <h1 className="page-title">Players</h1>
      <p className="page-sub">Prices update once per completed match.</p>

      <div className="toolbar">
        <div className="segmented segmented-sm" role="tablist" aria-label="Sort by">
          {(["price", "name", "role", "average", "owned", "change"] as Sort[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={sort === s}
              className={`seg${sort === s ? " seg-active" : ""}`}
              onClick={() => setSort(s)}
            >
              {({ price: "Price", name: "Name", role: "Role", average: "Average", owned: "Teams owned by", change: "Change" } as const)[s]}
            </button>
          ))}
        </div>
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
        <div className="card player-list">
          {rows.map((p) => (
            <Link
              key={p.id}
              to={`/players/${p.id}`}
              state={{ backgroundLocation: location }}
              className="player-row"
            >
              <PlayerAvatar name={p.display_name} size={40} photoUrl={p.photo_url} />
              <div className="player-main">
                <span className="player-name">
                  {p.display_name} <PlayerAvailabilityDot status={availability.data?.get(p.id)} />
                </span>
                <span className="player-meta">
                  <RoleBadge role={p.role} wkEligible={p.wk_eligible} />
                  <span className="player-start">
                    from {money(p.starting_price)}
                  </span>
                </span>
              </div>
              <div className="player-list-stat num" title="Fantasy points per match played">
                <span>Avg</span>{averages.data?.has(p.id) ? averages.data.get(p.id)!.toFixed(1) : "—"}
              </div>
              <div className="player-list-stat num" title="Teams selecting this player in the current round">
                <span>Owned</span>{ownershipRound ? owned.get(p.id) ?? 0 : "—"}
              </div>
              <div className="player-list-stat num" title="Change in teams selecting this player since the previous round">
                <span>Change</span>{previousRound ? `${(changes.get(p.id) ?? 0) > 0 ? "+" : ""}${changes.get(p.id) ?? 0}` : "—"}
              </div>
              <div className="player-price">
                <span className="price-now num">{money(p.currentPrice)}</span>
                <PriceMovement delta={p.movement} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
