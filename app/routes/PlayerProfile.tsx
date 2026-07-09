import { Link, useParams } from "react-router-dom";
import { usePlayer, type PlayerProfile as Profile } from "../lib/queries";
import { RoleBadge } from "../components/RoleBadge";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { PriceMovement } from "../components/PriceMovement";
import { BroadcastPanel } from "../components/BroadcastPanel";
import { Loading, ErrorState, EmptyState } from "../components/states";
import { money, shortDate } from "../lib/format";

/** Minimal, dependency-free sparkline of the price path (seq order). */
function PriceSparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return null;
  const w = 280;
  const h = 64;
  const pad = 6;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const pts = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((p - min) / span) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = prices[prices.length - 1]! >= prices[0]!;
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Price history"
      preserveAspectRatio="none"
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={rising ? "var(--up)" : "var(--down)"}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function totalPoints(p: Profile): number {
  return p.scores.reduce((sum, s) => sum + s.base, 0);
}

export function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const query = usePlayer(id);

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const p = query.data;
  if (!p)
    return (
      <div className="page">
        <EmptyState>Player not found.</EmptyState>
      </div>
    );

  const seedPrice = p.priceHistory[0]?.price ?? p.starting_price ?? null;
  const overallMove =
    p.currentPrice !== null && seedPrice !== null ? p.currentPrice - seedPrice : 0;
  const played = p.scores.filter((s) => s.played).length;

  return (
    <div className="page">
      <Link to="/players" className="back-link">
        ← All players
      </Link>

      <div className="profile-head card">
        <PlayerAvatar name={p.display_name} size={72} />
        <div className="profile-id">
          <h1 className="profile-name">{p.display_name}</h1>
          <div className="profile-role">
            <RoleBadge role={p.role} wkEligible={p.wk_eligible} />
          </div>
        </div>
      </div>

      {/* Score/price readout — reserved broadcast treatment. */}
      <BroadcastPanel className="statline">
        <div className="stat">
          <span className="stat-label">Current price</span>
          <span className="stat-value num">{money(p.currentPrice)}</span>
          <PriceMovement delta={overallMove} />
        </div>
        <div className="stat">
          <span className="stat-label">Season points</span>
          <span className="stat-value num">{totalPoints(p)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Matches played</span>
          <span className="stat-value num">{played}</span>
        </div>
      </BroadcastPanel>

      <h2 className="section-title">Price history</h2>
      <div className="card price-history-card">
        <PriceSparkline prices={p.priceHistory.map((h) => h.price)} />
        <table className="table">
          <thead>
            <tr>
              <th>Point</th>
              <th className="col-num">Price</th>
              <th className="col-num">Move</th>
            </tr>
          </thead>
          <tbody>
            {p.priceHistory.map((h, i) => {
              const prev = i > 0 ? p.priceHistory[i - 1]!.price : h.price;
              return (
                <tr key={h.seq}>
                  <td>{h.match_id === null ? "Starting price" : `After match ${i}`}</td>
                  <td className="col-num num">{money(h.price)}</td>
                  <td className="col-num">
                    {i === 0 ? (
                      <span className="movement movement-flat">–</span>
                    ) : (
                      <PriceMovement delta={h.price - prev} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Match scores</h2>
      {p.scores.length === 0 ? (
        <EmptyState>No finalised matches for this player yet.</EmptyState>
      ) : (
        <div className="card table-card">
          <table className="table scores-table">
            <thead>
              <tr>
                <th>Round</th>
                <th>Match</th>
                <th className="col-num">Bat</th>
                <th className="col-num">Bowl</th>
                <th className="col-num">Field</th>
                <th className="col-num">Bonus</th>
                <th className="col-num col-pts">Pts</th>
              </tr>
            </thead>
            <tbody>
              {p.scores.map((s) => (
                <tr key={s.match_id} className={s.played ? "" : "row-dnp"}>
                  <td>{s.matches?.rounds?.name ?? "—"}</td>
                  <td>
                    <span className="match-cell">
                      <span className="match-grade">{s.matches?.grade ?? "—"}</span>
                      <span className="match-opp">v {s.matches?.opponent ?? "—"}</span>
                      <span className="match-date">
                        {shortDate(s.matches?.final_day_date)}
                      </span>
                    </span>
                  </td>
                  {s.played ? (
                    <>
                      <td className="col-num num">{s.batting}</td>
                      <td className="col-num num">{s.bowling}</td>
                      <td className="col-num num">{s.fielding}</td>
                      <td className="col-num num">{s.bonuses}</td>
                      <td className="col-num num col-pts">
                        <span className="score-chip">{s.base}</span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={5} className="dnp-cell">
                      Did not play
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
