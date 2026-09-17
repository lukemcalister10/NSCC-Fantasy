import { useMemo } from "react";
import { useSeason, useRounds, type RoundView } from "../lib/queries";
import { useH2hResults, type H2hResultRow } from "../lib/teamQueries";
import { Loading, ErrorState, EmptyState } from "../components/states";
import { dateTime } from "../lib/format";
import { useAuth } from "../auth/AuthProvider";
import "../styles/team.css";

type RoundStatus = "completed" | "current" | "scheduled";

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
  status,
  results,
  userId,
}: {
  round: RoundView;
  status: RoundStatus;
  results: H2hResultRow[];
  userId: string | undefined;
}) {
  const { byFixture, disagreement } = useMemo(
    () => resultsFor(round.fixtures, results),
    [round.fixtures, results],
  );

  return (
    <details className="card round-card" open={status === "current"}>
      <summary className="round-head">
        <div>
          <span className="round-title-line">
            <h2 className="round-name">{round.name}</h2>
            <span className={`round-status round-status-${status}`}>
              {status === "completed"
                ? "Completed"
                : status === "current"
                  ? "Current"
                  : "Scheduled"}
            </span>
          </span>
          <span className="round-lock">Locks {dateTime(round.lock_at)}</span>
        </div>
        <span className="round-expand" aria-hidden="true" />
      </summary>

      <div className="round-body">
        <div className="round-col">
          <h3 className="round-col-title">Matches</h3>
          {round.matches.length === 0 ? (
            <p className="round-empty">No matches assigned.</p>
          ) : (
            <ul className="match-list round-match-grid">
              {round.matches.map((m) => (
                <li key={m.id} className="match-item">
                  <span className="match-grade">{m.grade}</span>
                  <span className="match-v">v</span>
                  <span className="match-opp">{m.opponent}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="round-col">
          <h3 className="round-col-title">Fixtures</h3>
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
                        <span
                          className={`fixture-team-block${
                            f.homeOwnerId === userId ? " fixture-team-mine" : ""
                          }`}
                        >
                          <strong>{f.home}</strong>
                          <em>{f.homeOwner}</em>
                        </span>
                        <span className="fixture-v">—</span>
                        <span className="fixture-team-block fixture-bye">BYE</span>
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
                        <span
                          className={`fixture-team-block${
                            f.homeOwnerId === userId ? " fixture-team-mine" : ""
                          }`}
                        >
                          <strong>{f.home}</strong>
                          <em>{f.homeOwner}</em>
                        </span>
                        <span className="fixture-v">v</span>
                        <span
                          className={`fixture-team-block fixture-away${
                            f.awayOwnerId === userId ? " fixture-team-mine" : ""
                          }`}
                        >
                          <strong>{f.away}</strong>
                          <em>{f.awayOwner}</em>
                        </span>
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
    </details>
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
  const { session } = useAuth();
  const season = useSeason();
  const rounds = useRounds(season.data?.id);

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

  const currentRoundId = useMemo(
    () =>
      (rounds.data ?? []).find((round) =>
        round.matches.some(
          (match) => match.status !== "finalised" && match.status !== "abandoned",
        ),
      )?.id ?? null,
    [rounds.data],
  );

  return (
    <div className="page">
      <h1 className="page-title">Rounds &amp; fixtures</h1>

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
              status={
                r.id === currentRoundId
                  ? "current"
                  : r.matches.length > 0 &&
                      r.matches.every(
                        (match) =>
                          match.status === "finalised" || match.status === "abandoned",
                      )
                    ? "completed"
                    : "scheduled"
              }
              results={resultsByRound.get(r.id) ?? []}
              userId={session?.user.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
