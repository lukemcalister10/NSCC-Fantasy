import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSeason, usePlayers, type PlayerListItem } from "../lib/queries";
import { RoleBadge } from "../components/RoleBadge";
import { PriceMovement } from "../components/PriceMovement";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { Loading, ErrorState, EmptyState } from "../components/states";
import { money } from "../lib/format";

type Sort = "price" | "name" | "role";

const roleOrder: Record<string, number> = { BAT: 0, AR: 1, WK: 2, BWL: 3 };

function sortPlayers(rows: PlayerListItem[], sort: Sort): PlayerListItem[] {
  const out = [...rows];
  if (sort === "name") out.sort((a, b) => a.display_name.localeCompare(b.display_name));
  else if (sort === "role")
    out.sort(
      (a, b) =>
        (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) ||
        (b.currentPrice ?? 0) - (a.currentPrice ?? 0),
    );
  else out.sort((a, b) => (b.currentPrice ?? 0) - (a.currentPrice ?? 0));
  return out;
}

/**
 * Player price list — SuperCoach density: role badge, price, movement arrows,
 * per-row stats. Current price is the latest `price_history` point (movement =
 * last − previous); rows link to the player profile.
 */
export function Players() {
  const season = useSeason();
  const players = usePlayers(season.data?.id);
  const [sort, setSort] = useState<Sort>("price");

  const rows = useMemo(
    () => (players.data ? sortPlayers(players.data, sort) : []),
    [players.data, sort],
  );

  return (
    <div className="page">
      <h1 className="page-title">Players</h1>
      <p className="page-sub">Prices update once per completed match.</p>

      <div className="toolbar">
        <div className="segmented segmented-sm" role="tablist" aria-label="Sort by">
          {(["price", "name", "role"] as Sort[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={sort === s}
              className={`seg${sort === s ? " seg-active" : ""}`}
              onClick={() => setSort(s)}
            >
              {s === "price" ? "Price" : s === "name" ? "Name" : "Role"}
            </button>
          ))}
        </div>
        {players.data ? (
          <span className="toolbar-count">{players.data.length} players</span>
        ) : null}
      </div>

      {season.isLoading || players.isLoading ? (
        <Loading />
      ) : players.error ? (
        <ErrorState error={players.error} />
      ) : rows.length === 0 ? (
        <EmptyState>No players in the pool yet.</EmptyState>
      ) : (
        <div className="card player-list">
          {rows.map((p) => (
            <Link key={p.id} to={`/players/${p.id}`} className="player-row">
              <PlayerAvatar name={p.display_name} size={40} />
              <div className="player-main">
                <span className="player-name">{p.display_name}</span>
                <span className="player-meta">
                  <RoleBadge role={p.role} wkEligible={p.wk_eligible} />
                  <span className="player-start">
                    from {money(p.starting_price)}
                  </span>
                </span>
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
