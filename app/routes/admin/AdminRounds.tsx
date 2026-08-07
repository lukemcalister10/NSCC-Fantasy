import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminPage, Section, StatusLine, Field } from "./adminChrome";
import { useAdminSeason, useAdminRounds } from "../../lib/adminQueries";
import type { AdminMatch, AdminRound } from "../../lib/adminQueries";
import {
  createRound,
  updateRound,
  createMatch,
  updateMatch,
  freezeRoundScorecards,
  explainWriteError,
} from "../../lib/adminMutations";
import { Loading, ErrorState, EmptyState } from "../../components/states";
import {
  adelaideLabel,
  defaultRoundLockAt,
  fromAdelaideInputValue,
  toAdelaideInputValue,
} from "../../lib/lockTime";

const STATUSES: AdminMatch["status"][] = ["scheduled", "in_progress", "finalised", "abandoned"];

/**
 * ROUND MANAGEMENT (/admin/rounds) — create and edit rounds, assign matches, set
 * the per-round lock, and end scorecard lockout (D24).
 *
 * D6: the lock datetime is PER ROUND and stored. The Saturday-11:00-Adelaide
 * default is a suggestion this form makes when you create a round; from then on
 * the stored value is the only thing any lock check reads (G4). Nothing about
 * 11:00 or Adelaide is compiled into a rule.
 *
 * D5: a match lands in the round containing its FINAL day — which is why the
 * final-day date is asked for here rather than inferred from a start date.
 */
export function AdminRounds() {
  const season = useAdminSeason();
  const rounds = useAdminRounds(season.data?.id);

  if (season.isLoading || rounds.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) {
    return (
      <AdminPage title="Rounds">
        <EmptyState>No season exists yet.</EmptyState>
      </AdminPage>
    );
  }

  const nextSeq = (rounds.data?.reduce((m, r) => Math.max(m, r.seq), 0) ?? 0) + 1;

  return (
    <AdminPage title="Rounds" intro={`${season.data.name} · ${rounds.data?.length ?? 0} rounds`}>
      <Section title="Create a round">
        <NewRoundForm seasonId={season.data.id} nextSeq={nextSeq} />
      </Section>

      <Section title="Rounds and matches">
        {rounds.error ? (
          <ErrorState error={rounds.error} />
        ) : (rounds.data?.length ?? 0) === 0 ? (
          <EmptyState>No rounds yet.</EmptyState>
        ) : (
          rounds.data!.map((r) => <RoundCard key={r.id} round={r} />)
        )}
      </Section>
    </AdminPage>
  );
}

function NewRoundForm({ seasonId, nextSeq }: { seasonId: string; nextSeq: number }) {
  const qc = useQueryClient();
  const [name, setName] = useState(`Round ${nextSeq}`);
  const [seq, setSeq] = useState(String(nextSeq));
  const [lockAt, setLockAt] = useState(() => toAdelaideInputValue(defaultRoundLockAt()));
  const [done, setDone] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createRound(seasonId, {
        seq: Number(seq),
        name,
        lockAt: fromAdelaideInputValue(lockAt),
      }),
    onSuccess: async () => {
      setDone("Round created.");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <p className="admin-note">
        The lock time below defaults to 11:00 Adelaide on the next Saturday (D6) and is
        editable — hybrid one- and two-week rounds are hand-crafted after the fixture is
        released (O8). Times are entered on the Adelaide clock, so daylight saving is
        handled for you.
      </p>
      <div className="admin-form-grid admin-form-grid-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Sequence" hint="ordering within the season">
          <input inputMode="numeric" value={seq} onChange={(e) => setSeq(e.target.value)} />
        </Field>
        <Field label="Locks at" hint="Adelaide time">
          <input
            type="datetime-local"
            value={lockAt}
            onChange={(e) => setLockAt(e.target.value)}
          />
        </Field>
      </div>
      <div className="admin-actions">
        <button
          className="btn-primary btn-primary-inline"
          disabled={create.isPending || name.trim() === ""}
          onClick={() => {
            setDone(null);
            create.mutate();
          }}
        >
          {create.isPending ? "Creating…" : "Create round"}
        </button>
      </div>
      <StatusLine
        error={create.error ? new Error(explainWriteError(create.error)) : undefined}
        success={done}
      />
    </div>
  );
}

function RoundCard({ round }: { round: AdminRound }) {
  const qc = useQueryClient();
  const frozen = round.scorecards_frozen_at !== null;
  const [name, setName] = useState(round.name);
  const [lockAt, setLockAt] = useState(toAdelaideInputValue(round.lock_at));
  const [confirmFreeze, setConfirmFreeze] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      updateRound(round.id, { name, lockAt: fromAdelaideInputValue(lockAt) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  const endLockout = useMutation({
    mutationFn: () => freezeRoundScorecards(round.id),
    onSuccess: async () => {
      setConfirmFreeze(false);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const locked = new Date(round.lock_at).getTime() <= Date.now();

  return (
    <div className="card" style={{ padding: "var(--sp-4)", marginBottom: "var(--sp-4)" }}>
      <div className="admin-section-head">
        <h3 className="admin-section-title">
          {round.name} <span style={{ color: "var(--ink-faint)" }}>· round {round.seq}</span>
        </h3>
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--ink-muted)" }}>
          {locked ? "Teams locked" : "Teams open"} · {adelaideLabel(round.lock_at)}
        </span>
      </div>

      {frozen ? (
        <div className="admin-banner admin-banner-frozen">
          <strong>Scorecards frozen — lockout ended {adelaideLabel(round.scorecards_frozen_at)}.</strong>
          <span>
            No correction is made after this point, even if an error is discovered (D24):
            participants have traded on the prices these scorecards produced. A catastrophic
            error can still be amended by a deliberate, logged override — that is a database
            action with a written reason, not a button here.
          </span>
        </div>
      ) : null}

      <div className="admin-form-grid admin-form-grid-2">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Locks at" hint="Adelaide time (stored per round, D6)">
          <input
            type="datetime-local"
            value={lockAt}
            onChange={(e) => setLockAt(e.target.value)}
          />
        </Field>
      </div>
      <div className="admin-actions">
        <button
          className="btn-ghost"
          disabled={save.isPending || (name === round.name && lockAt === toAdelaideInputValue(round.lock_at))}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save round"}
        </button>
        {!frozen ? (
          confirmFreeze ? (
            <>
              <button
                className="btn-ghost btn-danger"
                disabled={endLockout.isPending}
                onClick={() => endLockout.mutate()}
              >
                {endLockout.isPending ? "Ending…" : "Yes — end lockout permanently"}
              </button>
              <button className="btn-ghost" onClick={() => setConfirmFreeze(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn-ghost btn-danger" onClick={() => setConfirmFreeze(true)}>
              End scorecard lockout…
            </button>
          )
        ) : null}
      </div>
      {confirmFreeze && !frozen ? (
        <p className="admin-status admin-status-error">
          This is one-way. After it, {round.name}'s scorecards can never be corrected in the
          ordinary course — recompute will keep reproducing whatever they say (D24). Enter and
          check every scorecard for this round first.
        </p>
      ) : null}
      <StatusLine error={save.error ?? endLockout.error} />

      <MatchList round={round} frozen={frozen} />
    </div>
  );
}

function MatchList({ round, frozen }: { round: AdminRound; frozen: boolean }) {
  const qc = useQueryClient();
  const [grade, setGrade] = useState("A Grade");
  const [opponent, setOpponent] = useState("");
  const [finalDay, setFinalDay] = useState("");

  const add = useMutation({
    mutationFn: () =>
      createMatch({
        roundId: round.id,
        grade,
        opponent,
        status: "scheduled",
        finalDayDate: finalDay === "" ? null : finalDay,
      }),
    onSuccess: async () => {
      setOpponent("");
      setFinalDay("");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <div style={{ marginTop: "var(--sp-4)" }}>
      <h4 className="admin-section-title" style={{ marginBottom: "var(--sp-2)" }}>
        Matches
      </h4>
      {round.matches.length === 0 ? (
        <p className="admin-note">No matches assigned to this round yet.</p>
      ) : (
        <div className="table-card">
          <table className="table admin-table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>Opponent</th>
                <th>Status</th>
                <th>Final day</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {round.matches.map((m) => (
                <MatchRow key={m.id} match={m} frozen={frozen} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!frozen ? (
        <>
          <div className="admin-form-grid admin-form-grid-3" style={{ marginTop: "var(--sp-3)" }}>
            <Field label="Grade">
              <input value={grade} onChange={(e) => setGrade(e.target.value)} />
            </Field>
            <Field label="Opponent">
              <input value={opponent} onChange={(e) => setOpponent(e.target.value)} />
            </Field>
            <Field label="Final day" hint="the day the match ENDS (D5)">
              <input type="date" value={finalDay} onChange={(e) => setFinalDay(e.target.value)} />
            </Field>
          </div>
          <div className="admin-actions">
            <button
              className="btn-ghost"
              disabled={add.isPending || opponent.trim() === ""}
              onClick={() => add.mutate()}
            >
              {add.isPending ? "Adding…" : "Add match"}
            </button>
          </div>
          <StatusLine error={add.error ? new Error(explainWriteError(add.error)) : undefined} />
        </>
      ) : null}
    </div>
  );
}

function MatchRow({ match, frozen }: { match: AdminMatch; frozen: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({
    grade: match.grade,
    opponent: match.opponent,
    status: match.status,
    finalDayDate: match.final_day_date ?? "",
  });

  const save = useMutation({
    mutationFn: () =>
      updateMatch(match.id, {
        grade: draft.grade,
        opponent: draft.opponent,
        status: draft.status,
        finalDayDate: draft.finalDayDate === "" ? null : draft.finalDayDate,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  const dirty =
    draft.grade !== match.grade ||
    draft.opponent !== match.opponent ||
    draft.status !== match.status ||
    draft.finalDayDate !== (match.final_day_date ?? "");

  return (
    <tr>
      <td className="tight">
        <input
          value={draft.grade}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
        />
      </td>
      <td className="tight">
        <input
          value={draft.opponent}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, opponent: e.target.value })}
        />
      </td>
      <td className="tight">
        <select
          value={draft.status}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as AdminMatch["status"] })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="tight">
        <input
          type="date"
          value={draft.finalDayDate}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, finalDayDate: e.target.value })}
        />
      </td>
      <td className="tight">
        <button
          className="btn-ghost"
          disabled={frozen || !dirty || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {save.error ? (
          <div className="admin-status admin-status-error">{explainWriteError(save.error)}</div>
        ) : null}
      </td>
    </tr>
  );
}
