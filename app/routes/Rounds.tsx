import { useMemo } from "react";
import { useSeason, useRounds, type RoundView } from "../lib/queries";
import { useH2hResults, type H2hResultRow } from "../lib/teamQueries";
import { Loading, ErrorState, EmptyState } from "../components/states";
import { dateTime } from "../lib/format";
import "../styles/team.css";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  finalised: "Final",
  abandoned: "Abandoned",
};

/**
 * A settled fixture, matched onto the DERIVED schedule.
 *
 * D21 is untouched: the SCHEDULE still comes from `generateRound` and is never
 * read from `h2h_results`. What is read from `h2h_results` is the SCORE of a
 * round already played — a different thing, and the only place the bye median
 * exists (D18).
 */
interface FixtureResult {
  homePoints: number;
  awayPoints: number | null;
  byeMedian: number | null;
  /** From the home team's point of view. */
  outcome: "W" | "L" | "T";
}

const pairKey = (a: string, b: string | null): string =>
  b === null ? `${a}|BYE` : [a, b].sort().join("|");

/**
 * Match each derived fixture to its settled result. If a round carries results
 * but a derived pairing is not among them, that is a genuine disagreement
 * between the schedule the UI derives and the schedule the engine settled — it
 * is SURFACED, never papered over by rendering whatever result is closest.
 */
function resultsFor(
  fixtures: RoundView["fixtures"],
  rows: H2hResultRow[],
): { byFixture: Map<string, FixtureResult>; disagreement: boolean } {
  const byFixture = new Map<string, FixtureResult>();
  if (rows.length === 0) return { byFixture, disagreement: false };

  const engineKeys = new Set(rows.map((r) => pairKey(r.home_team_id, r.away_team_id)));
  let disagreement = false;

  for (const f of fixtures) {
    const key = pairKey(f.homeId, f.awayId);
    if (!engineKeys.has(key)) {
      disagreement = true;
      continue;
    }
    const row = rows.find(
      (r) => pairKey(r.home_team_id, r.away_team_id) === key,
    )!;

    if (row.away_team_id === null) {
      // BYE — settled against the round median (D18), exactly as the ladder does.
      const median = row.bye_median ?? 0;
      byFixture.set(key, {
        homePoints: row.home_points,
        awayPoints: null,
        byeMedian: median,
        outcome:
          row.home_points > median ? "W" : row.home_points < median ? "L" : "T",
      });
      continue;
    }

    // The derived fixture's "home" may be the engine row's away side; report the
    // result from the side the UI is showing as home.
    const uiHomeIsEngineHome = row.home_team_id === f.homeId;
    const homePoints = uiHomeIsEngineHome ? row.home_points : (row.away_points ?? 0);
    const awayPoints = uiHomeIsEngineHome ? (row.away_points ?? 0) : row.home_points;
    byFixture.set(key, {
      homePoints,
      awayPoints,
      byeMedian: null,
      outcome: homePoints > awayPoints ? "W" : homePoints < awayPoints ? "L" : "T",
    });
  }

  return { byFixture, disagreement };
}

function RoundCard({
  round,
  provisional,
  results,
}: {
  round: RoundView;
  provisional: boolean;
  results: H2hResultRow[];
}) {
  const { byFixture, disagreement } = useMemo(
    () => resultsFor(round.fixtures, results),
    [round.fixtures, results],
  );

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
              {round.fixtures.map((f, i) => {
                const result = byFixture.get(pairKey(f.homeId, f.awayId));
                return (
                  <li key={i} className="fixture-item">
                    {f.away === null ? (
                      <>
                        <span className="fixture-team">{f.home}</span>
                        <span className="fixture-bye">BYE</span>
                        {result ? (
                          <span className="fixture-result">
                            {result.homePoints} v {result.byeMedian} median
                            <span className={`fixture-outcome outcome-${result.outcome}`}>
                              {result.outcome}
                            </span>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="fixture-team">{f.home}</span>
                        <span className="fixture-v">v</span>
                        <span className="fixture-team fixture-away">{f.away}</span>
                        {result ? (
                          <span className="fixture-result">
                            {result.homePoints} – {result.awayPoints}
                            <span className={`fixture-outcome outcome-${result.outcome}`}>
                              {result.outcome}
                            </span>
                          </span>
                        ) : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {round.fixtures.some((f) => f.away === null) ? (
            <span className="fixture-bye-note">
              A bye is not a rest: the byed team is scored against that round&rsquo;s
              median team score and takes a win, loss or tie from it (D18), so it still
              counts as a game played on the ladder.
            </span>
          ) : null}
          {disagreement ? (
            <div className="refusal" role="alert">
              <strong className="refusal-reason">
                This round&rsquo;s derived schedule does not match the settled results.
              </strong>
              <span className="refusal-authority">
                D21 — reported, not patched. Results are withheld for the pairings that
                disagree rather than being attached to the wrong fixture.
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Rounds + fixtures. Fixtures are DERIVED (D21) by calling `generateRound`, never
 * read from `h2h_results`. Pre-lock (`seasons.locked_at IS NULL`) the team set can
 * still change, so every fixture is labelled "provisional".
 *
 * C2: at an ODD team count one team byes each round. The bye renders as "BYE"
 * rather than an opponent, and — once the round is settled — against the round
 * median it was actually scored against, so what this page shows and what the
 * ladder counts are visibly the same event.
 */
export function Rounds() {
  const season = useSeason();
  const rounds = useRounds(season.data?.id);
  const provisional = season.data ? season.data.locked_at === null : true;

  const roundIds = useMemo(() => (rounds.data ?? []).map((r) => r.id), [rounds.data]);
  const h2h = useH2hResults(season.data?.id, roundIds);

  const resultsByRound = useMemo(() => {
    const m = new Map<string, H2hResultRow[]>();
    for (const row of h2h.data ?? []) {
      const list = m.get(row.round_id) ?? [];
      list.push(row);
      m.set(row.round_id, list);
    }
    return m;
  }, [h2h.data]);

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
            <RoundCard
              key={r.id}
              round={r}
              provisional={provisional}
              results={resultsByRound.get(r.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
