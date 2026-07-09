import { useSeason, useRounds, type RoundView } from "../lib/queries";
import { Loading, ErrorState, EmptyState } from "../components/states";
import { dateTime } from "../lib/format";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  finalised: "Final",
  abandoned: "Abandoned",
};

function RoundCard({ round, provisional }: { round: RoundView; provisional: boolean }) {
  return (
    <div className="card round-card">
      <div className="round-head">
        <div>
          <h2 className="round-name">{round.name}</h2>
          <span className="round-lock">Locks {dateTime(round.lock_at)}</span>
        </div>
        <span className="round-seq">R{round.seq}</span>
      </div>

      <div className="round-body">
        <div className="round-col">
          <h3 className="round-col-title">Matches</h3>
          {round.matches.length === 0 ? (
            <p className="round-empty">No matches assigned.</p>
          ) : (
            <ul className="match-list">
              {round.matches.map((m) => (
                <li key={m.id} className="match-item">
                  <span className="match-grade">{m.grade}</span>
                  <span className="match-opp">v {m.opponent}</span>
                  <span className={`match-status status-${m.status}`}>
                    {STATUS_LABEL[m.status] ?? m.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="round-col">
          <h3 className="round-col-title">
            Fixtures
            {provisional ? <span className="provisional">provisional</span> : null}
          </h3>
          {round.fixtures.length === 0 ? (
            <p className="round-empty">No teams registered yet.</p>
          ) : (
            <ul className="fixture-list">
              {round.fixtures.map((f, i) => (
                <li key={i} className="fixture-item">
                  {f.away === null ? (
                    <>
                      <span className="fixture-team">{f.home}</span>
                      <span className="fixture-bye">BYE</span>
                    </>
                  ) : (
                    <>
                      <span className="fixture-team">{f.home}</span>
                      <span className="fixture-v">v</span>
                      <span className="fixture-team fixture-away">{f.away}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Rounds + fixtures. Fixtures are DERIVED (D21) by calling `generateRound`, never
 * read from `h2h_results`. Pre-lock (`seasons.locked_at IS NULL`) the team set can
 * still change, so every fixture is labelled "provisional".
 */
export function Rounds() {
  const season = useSeason();
  const rounds = useRounds(season.data?.id);
  const provisional = season.data ? season.data.locked_at === null : true;

  return (
    <div className="page">
      <h1 className="page-title">Rounds &amp; fixtures</h1>
      <p className="page-sub">
        {provisional
          ? "Season not yet locked — fixtures are provisional until the team set is frozen."
          : "Fixtures are set for the season."}
      </p>

      {season.isLoading || rounds.isLoading ? (
        <Loading />
      ) : rounds.error ? (
        <ErrorState error={rounds.error} />
      ) : !rounds.data || rounds.data.length === 0 ? (
        <EmptyState>No rounds defined yet.</EmptyState>
      ) : (
        <div className="round-grid">
          {rounds.data.map((r) => (
            <RoundCard key={r.id} round={r} provisional={provisional} />
          ))}
        </div>
      )}
    </div>
  );
}
