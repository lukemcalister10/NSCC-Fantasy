import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AdminPage, Section, SeasonLockBanner, StatusLine } from "./adminChrome";
import { useAdminSeason, useAdminPlayers, useAdminRounds } from "../../lib/adminQueries";
import { requestRecompute, type RecomputeResult } from "../../lib/adminMutations";
import { Loading, ErrorState, EmptyState } from "../../components/states";
import { money } from "../../lib/format";
import { adelaideLabel } from "../../lib/lockTime";

/**
 * MANAGER DASHBOARD (/admin) — season at a glance, and the recompute control.
 *
 * WHAT THE BUTTON DOES, said honestly: one FULL-SEASON recompute. There is no
 * partial pass and this page never claims otherwise. Prices are a chain — each
 * movement reads the price the previous match left — so no round can be rebuilt
 * in isolation, and writing a round-scoped entry point would fork the verified
 * recompute path (G3). What IS round-scoped is the summary that comes back:
 * which rounds moved, which teams, and how many prices changed.
 *
 * The work happens server-side (api/recompute.ts) because derived state is
 * SELECT-only for every browser client by design (0004): the engine's output is
 * the engine's to write.
 */
export function AdminHome() {
  const season = useAdminSeason();
  const players = useAdminPlayers(season.data?.id);
  const rounds = useAdminRounds(season.data?.id);

  if (season.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) {
    return (
      <AdminPage title="Manager">
        <EmptyState>
          No season exists yet. Create one in the database before using these screens.
        </EmptyState>
      </AdminPage>
    );
  }

  const { config, locked_at, name } = season.data;
  const priced = (players.data ?? []).filter((p) => p.starting_price !== null).length;
  const frozenRounds = (rounds.data ?? []).filter((r) => r.scorecards_frozen_at !== null).length;
  const nextRound = (rounds.data ?? [])
    .filter((r) => new Date(r.lock_at).getTime() > Date.now())
    .sort((a, b) => a.seq - b.seq)[0];

  return (
    <AdminPage title="Manager" intro={name}>
      <SeasonLockBanner lockedAt={locked_at} />

      <Section title="Season">
        <div className="card" style={{ padding: "var(--sp-4)" }}>
          <ul className="admin-log">
            <li>
              <strong>{players.data?.length ?? 0}</strong> players · {priced} priced
              {locked_at ? "" : ` · ${(players.data?.length ?? 0) - priced} awaiting a price`}
            </li>
            <li>
              <strong>{rounds.data?.length ?? 0}</strong> rounds · {frozenRounds} with scorecards
              frozen (D24)
            </li>
            <li>
              Team size <strong>{config.squad.teamSize}</strong> · cap{" "}
              <strong>{money(config.squad.cap)}</strong> · {config.squad.tradesPerRound} trades
              per round
            </li>
            <li>
              Next lock:{" "}
              <strong>
                {nextRound ? `${nextRound.name} — ${adelaideLabel(nextRound.lock_at)}` : "—"}
              </strong>
            </li>
          </ul>
          <div className="admin-actions">
            <Link className="btn-ghost" to="/admin/players">
              Player registry
            </Link>
            <Link className="btn-ghost" to="/admin/rounds">
              Rounds
            </Link>
            <Link className="btn-ghost" to="/admin/scorecards">
              Scorecards
            </Link>
            <Link className="btn-ghost" to="/admin/settings">
              Settings &amp; season lock
            </Link>
          </div>
        </div>
      </Section>

      <Section title="Recompute">
        <RecomputeControl seasonId={season.data.id} />
      </Section>
    </AdminPage>
  );
}

function RecomputeControl({ seasonId }: { seasonId: string }) {
  const [result, setResult] = useState<RecomputeResult | null>(null);

  const run = useMutation({
    mutationFn: () => requestRecompute(seasonId),
    onSuccess: setResult,
  });

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <p className="admin-note">
        Runs a <strong>full-season recompute</strong>: every scorecard re-scored, every price
        re-derived from the seed, ladder and leaderboard rebuilt. It is safe to run at any time
        and safe to run twice — recompute is a pure function of raw scorecards plus frozen
        config, and running it again on unchanged data changes nothing (D15/G3). There is no
        single-round pass; the summary below is what tells you which round moved.
      </p>

      <div className="admin-actions">
        <button
          className="btn-primary btn-primary-inline"
          disabled={run.isPending}
          onClick={() => {
            setResult(null);
            run.mutate();
          }}
        >
          {run.isPending ? "Recomputing…" : "Recompute season"}
        </button>
      </div>

      <StatusLine error={run.error} />

      {result ? (
        result.changed ? (
          <div className="admin-banner admin-banner-ok" style={{ marginTop: "var(--sp-3)" }}>
            <strong>Recomputed — derived state changed.</strong>
            <span>
              {result.changedFamilies.join(", ")} · {result.priceMovementsChanged} price movement
              {result.priceMovementsChanged === 1 ? "" : "s"} differ.
            </span>
            {result.rounds.length > 0 ? (
              <ul className="admin-diff">
                {result.rounds.map((r) => (
                  <li key={r.roundId}>
                    {r.name} (round {r.seq}): {r.teamScores.length} team total
                    {r.teamScores.length === 1 ? "" : "s"} changed
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="admin-banner" style={{ marginTop: "var(--sp-3)" }}>
            <strong>Recomputed — nothing changed.</strong>
            <span>
              The stored derived state already matched what the raw data implies. That is what
              idempotence looks like (G3).
            </span>
          </div>
        )
      ) : null}
    </div>
  );
}
