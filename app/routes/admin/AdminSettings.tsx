import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminPage, Section, StatusLine, Field } from "./adminChrome";
import { useAdminSeason, useAdminPlayers } from "../../lib/adminQueries";
import type { AdminPlayer } from "../../lib/adminQueries";
import { useSeasonLockPreview, type SeasonLockPreview } from "../../lib/seasonLockQueries";
import {
  saveSeasonConfig,
  fireSeasonLock,
  removePlayerFromPool,
  explainLockError,
} from "../../lib/seasonLockMutations";
import {
  CONFIG_GROUPS,
  CONFIG_FIELDS,
  LOCK_CATEGORIES,
  fieldPathKey,
  getConfigValue,
  setConfigValue,
  validateConfig,
  totalRoleMinimums,
  flexSlots,
  isArmed,
  isConfigEditable,
  isPoolRemovalAllowed,
  type ConfigField,
} from "../../lib/seasonLock";
import { Loading, ErrorState, EmptyState } from "../../components/states";
import { money, dateTime } from "../../lib/format";
import type { LeagueConfig } from "../../../src/config/types";

/**
 * SETTINGS + SEASON LOCK (/admin/settings) — C5.
 *
 * WHAT WAS ACTUALLY MISSING, said plainly, because C5's wording overstates it:
 * the season lock's ENFORCEMENT has existed and been green since the locks slice
 * (0002) — the freeze, the cap computation, the unpriced-player block and the
 * one-way door are all triggers, all verified. What did not exist was any way for
 * the operator to SEE or FIRE it: this page was a stub, so the only route to a
 * locked season was `UPDATE seasons SET locked_at = now()` in the SQL editor,
 * with no way to know beforehand what cap that would compute. This page is the
 * door handle and the window beside the door.
 *
 * G11 DISCIPLINE. Not one economy value is written in this file. Every input is
 * generated from `CONFIG_FIELDS` and reads its value out of `seasons.config`;
 * every figure in the rehearsal panel comes from the database. Search this file
 * for a number and you will find array indices and nothing else.
 *
 * D16. Everything disabled here is also refused by a trigger. The disabling is a
 * courtesy so the operator is not told "no" after the round-trip; the boundary is
 * the database's, proven per category in test/g10.season-lock-action.test.ts.
 */
export function AdminSettings() {
  const season = useAdminSeason();
  const seasonId = season.data?.id;
  const players = useAdminPlayers(seasonId);
  const preview = useSeasonLockPreview(seasonId);

  if (season.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) {
    return (
      <AdminPage title="Settings">
        <EmptyState>
          No season exists yet. Create one in the database before configuring the economy.
        </EmptyState>
      </AdminPage>
    );
  }

  const { id, name, config, locked_at } = season.data;
  const locked = locked_at !== null;

  return (
    <AdminPage title="Settings" intro={name}>
      <LockStateBanner lockedAt={locked_at} cap={preview.data?.currentCap ?? config.squad.cap} />

      <Section title="Economy parameters">
        <ConfigEditor
          key={JSON.stringify(config)}
          seasonId={id}
          config={config}
          locked={locked}
          previewCap={preview.data?.computedCap ?? null}
        />
      </Section>

      <Section title="The pool the cap is computed from">
        <PoolPanel
          players={players.data ?? []}
          preview={preview.data ?? null}
          loading={players.isLoading}
          error={players.error}
          locked={locked}
        />
      </Section>

      <Section title="Rehearsal — what the lock will do">
        {preview.isLoading ? (
          <Loading />
        ) : preview.error ? (
          <ErrorState error={preview.error} />
        ) : preview.data ? (
          <RehearsalPanel preview={preview.data} />
        ) : (
          <EmptyState>The preview returned nothing for this season.</EmptyState>
        )}
      </Section>

      <Section title={locked ? "Season lock" : "Fire the season lock"}>
        {locked ? (
          <LockedRecord lockedAt={locked_at} preview={preview.data ?? null} />
        ) : preview.data ? (
          <FirePanel seasonId={id} seasonName={name} preview={preview.data} />
        ) : null}
      </Section>
    </AdminPage>
  );
}

// ── Banner ──────────────────────────────────────────────────────────────────

function LockStateBanner({ lockedAt, cap }: { lockedAt: string | null; cap: number | null }) {
  if (lockedAt === null) {
    return (
      <div className="admin-banner">
        <strong>Season is not locked.</strong>
        <span>
          Every parameter below is tunable, and a change propagates through the next recompute
          (D13). The lock is a one-way door with no undo — rehearse it on a scratch season
          before firing it here.
        </span>
      </div>
    );
  }
  return (
    <div className="admin-banner admin-banner-locked">
      <strong>Season locked {dateTime(lockedAt)}.</strong>
      <span>
        The economy is frozen and the salary cap is {money(cap)}, computed by the lock itself
        (O3). There is no unlock: the database refuses every change below, whichever way it is
        attempted (G10).
      </span>
    </div>
  );
}

// ── Config editor ───────────────────────────────────────────────────────────

/** Draft values live as STRINGS so a half-typed number is not a validation error. */
type Draft = Record<string, string>;

const draftFrom = (config: LeagueConfig): Draft =>
  Object.fromEntries(
    CONFIG_FIELDS.map((f) => {
      const v = getConfigValue(config, f.path);
      return [fieldPathKey(f.path), v === undefined ? "" : String(v)];
    }),
  );

function ConfigEditor({
  seasonId,
  config,
  locked,
  previewCap,
}: {
  seasonId: string;
  config: LeagueConfig;
  locked: boolean;
  previewCap: number | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(config));
  const [saved, setSaved] = useState<string | null>(null);
  const editable = isConfigEditable(locked ? "locked" : null);

  /** The config the draft describes — built by writing each field back by path. */
  const drafted = useMemo(
    () =>
      CONFIG_FIELDS.reduce(
        (acc, f) => setConfigValue(acc, f.path, Number(draft[fieldPathKey(f.path)])),
        config,
      ),
    [draft, config],
  );

  const problems = useMemo(() => validateConfig(drafted), [drafted]);
  const problemFor = (key: string) => problems.find((p) => p.path === key)?.message;
  const dirty = CONFIG_FIELDS.some(
    (f) => draft[fieldPathKey(f.path)] !== draftFrom(config)[fieldPathKey(f.path)],
  );

  const save = useMutation({
    mutationFn: () => saveSeasonConfig(seasonId, drafted),
    onSuccess: async () => {
      setSaved("Saved. The next recompute uses these values.");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <p className="admin-note">
        {editable ? (
          <>
            These are the season's economy, read from and written to the season's config row —
            no value here is written into the app's code (D13/G11). Change one, press{" "}
            <strong>Save</strong>, then recompute a test round to watch it propagate.
          </>
        ) : (
          <>
            The season is locked, so this is a record of what was frozen rather than a form.
            The database refuses every one of these edits (G10) — the disabled inputs are only
            saying so early.
          </>
        )}
      </p>

      {CONFIG_GROUPS.map((group) => (
        <div key={group.key} style={{ marginTop: "var(--sp-4)" }}>
          <h3 className="admin-section-title">{group.title}</h3>
          <p className="admin-note">{group.blurb}</p>
          <div className="admin-form-grid">
            {group.fields.map((field) => (
              <ConfigInput
                key={fieldPathKey(field.path)}
                field={field}
                value={draft[fieldPathKey(field.path)] ?? ""}
                editable={editable}
                problem={problemFor(fieldPathKey(field.path))}
                previewCap={previewCap}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, [fieldPathKey(field.path)]: next }))
                }
              />
            ))}
          </div>
          {group.key === "squad" ? <SquadArithmetic config={drafted} /> : null}
        </div>
      ))}

      {problems.filter((p) => p.path === "squad.roleMinimums").map((p) => (
        <div key={p.path} className="admin-banner admin-banner-frozen" style={{ marginTop: "var(--sp-3)" }}>
          <strong>These minimums do not fit.</strong>
          <span>{p.message}</span>
        </div>
      ))}

      {editable ? (
        <div className="admin-actions">
          <button
            className="btn-primary btn-primary-inline"
            disabled={!dirty || problems.length > 0 || save.isPending}
            onClick={() => {
              setSaved(null);
              save.mutate();
            }}
          >
            {save.isPending ? "Saving…" : "Save settings"}
          </button>
          <button
            className="btn-ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setSaved(null);
              setDraft(draftFrom(config));
            }}
          >
            Revert
          </button>
        </div>
      ) : null}

      <StatusLine
        error={save.error ? new Error(explainLockError(save.error)) : undefined}
        success={saved}
      />
    </div>
  );
}

function ConfigInput({
  field,
  value,
  editable,
  problem,
  previewCap,
  onChange,
}: {
  field: ConfigField;
  value: string;
  editable: boolean;
  problem: string | undefined;
  previewCap: number | null;
  onChange: (next: string) => void;
}) {
  const computed = field.computedAtLock === true;
  const hint = [field.decision, field.hint].filter(Boolean).join(" · ");

  return (
    <Field label={field.label} hint={hint}>
      <input
        inputMode="decimal"
        value={value}
        disabled={!editable || computed}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={problem ? true : undefined}
      />
      {computed ? (
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-faint)" }}>
          {previewCap === null
            ? "computed by the lock action — not typed in"
            : `the lock will compute ${money(previewCap)}`}
        </span>
      ) : field.kind === "money" && value !== "" && Number.isFinite(Number(value)) ? (
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-faint)" }}>
          {money(Number(value))}
        </span>
      ) : null}
      {problem ? (
        <span className="admin-status admin-status-error">{problem}</span>
      ) : null}
    </Field>
  );
}

/** Σ minimums / flex, restated from the draft so O2's shape is visible while editing. */
function SquadArithmetic({ config }: { config: LeagueConfig }) {
  const total = totalRoleMinimums(config);
  const flex = flexSlots(config);
  return (
    <p className="admin-note">
      Role minimums total <strong>{total}</strong> of{" "}
      <strong>{getConfigValue(config, ["squad", "teamSize"]) ?? "—"}</strong> —{" "}
      <strong>{flex}</strong> flex slot{flex === 1 ? "" : "s"}, the only wildcard (O2/A7).
    </p>
  );
}

// ── The pool ────────────────────────────────────────────────────────────────

/**
 * The two things that stand between the operator and a correct cap: players with
 * no price (which BLOCK the lock, C13) and players who are no longer real
 * registrants (which drag the mean, A9). Both are named here rather than
 * summarised, because "1 awaiting a price" is not actionable and "Sam Hollis is
 * awaiting a price" is.
 */
function PoolPanel({
  players,
  preview,
  loading,
  error,
  locked,
}: {
  players: AdminPlayer[];
  preview: SeasonLockPreview | null;
  loading: boolean;
  error: unknown;
  locked: boolean;
}) {
  const unpriced = players.filter((p) => p.starting_price === null);
  const inactive = players.filter((p) => !p.active);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <p className="admin-note">
        The cap is the mean starting price across <strong>all</strong> players in the pool,
        taken literally (O3) — active and inactive alike. So the pool must contain only real
        registrants when you lock. Remove withdrawals; do not rely on the active flag, which
        means "not selectable", not "not in the pool".
      </p>

      {unpriced.length > 0 ? (
        <div className="admin-banner admin-banner-frozen">
          <strong>
            {unpriced.length} player{unpriced.length === 1 ? "" : "s"} awaiting a price — the
            lock is blocked (C13).
          </strong>
          <span>
            An unpriced player drops silently out of the mean the cap is computed from, so the
            database refuses to lock until every player has one (Rider 3 / O3).
          </span>
          <ul className="admin-log">
            {unpriced.map((p) => (
              <li key={p.id}>
                {p.display_name} · {p.role}
                {p.active ? "" : " · inactive"}
              </li>
            ))}
          </ul>
          <Link className="btn-ghost" to="/admin/players">
            Price them in the registry
          </Link>
        </div>
      ) : (
        <div className="admin-banner admin-banner-ok">
          <strong>Every player in the pool has a starting price.</strong>
          <span>
            {preview
              ? `${preview.pricedCount} of ${preview.poolSize} priced.`
              : "Nothing blocks the lock on pricing."}
          </span>
        </div>
      )}

      {inactive.length > 0 ? (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <p className="admin-note">
            <strong>
              {inactive.length} inactive player{inactive.length === 1 ? "" : "s"} still counted
              in the cap.
            </strong>{" "}
            If they are not playing this season, remove them from the pool — that is what keeps
            O3's "all players" honest without changing what O3 means. Removal works only for
            players with no history, and never after lock.
          </p>
          <div className="card table-card">
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th className="col-num">Starting price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {inactive.map((p) => (
                  <RemovableRow key={p.id} player={p} locked={locked} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RemovableRow({ player, locked }: { player: AdminPlayer; locked: boolean }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const allowed = isPoolRemovalAllowed(locked ? "locked" : null);

  const remove = useMutation({
    mutationFn: () => removePlayerFromPool(player.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <tr>
      <td className="tight">{player.display_name}</td>
      <td className="tight">{player.role}</td>
      <td className="tight col-num num">{money(player.starting_price)}</td>
      <td className="tight">
        {!allowed ? (
          <span style={{ color: "var(--ink-faint)" }}>frozen at lock</span>
        ) : confirming ? (
          <>
            <button
              className="btn-ghost btn-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Removing…" : "Remove permanently"}
            </button>
            <button className="btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn-ghost btn-danger" onClick={() => setConfirming(true)}>
            Remove from pool…
          </button>
        )}
        {remove.error ? (
          <div className="admin-status admin-status-error">{explainLockError(remove.error)}</div>
        ) : null}
      </td>
    </tr>
  );
}

// ── Rehearsal ───────────────────────────────────────────────────────────────

/**
 * The rehearsal affordance KICKOFF asks for: exactly what the lock will freeze
 * and exactly what cap it will compute, from live data, firing nothing.
 *
 * Every figure comes from `public.season_lock_preview()`, which calls the same
 * functions `enforce_season_lock()` calls (0008). This panel is not a prediction
 * of the lock's arithmetic; it is that arithmetic, run without the write.
 */
function RehearsalPanel({ preview }: { preview: SeasonLockPreview }) {
  const floorShare =
    preview.poolSize > 0 ? Math.round((preview.atFloorCount / preview.poolSize) * 100) : 0;

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <p className="admin-note">
        Nothing on this panel writes anything. The cap below is not an estimate of what the
        lock would do — it is the lock's own computation, run without firing, so what you
        rehearse is what you get.
      </p>

      <ul className="admin-log">
        <li>
          Pool: <strong>{preview.poolSize}</strong> players · {preview.pricedCount} priced ·{" "}
          {preview.unpricedCount} awaiting a price
        </li>
        <li>
          {preview.activeCount} active · <strong>{preview.inactiveCount}</strong> inactive —
          inactive players are still in the cap mean (O3)
        </li>
        <li>
          Mean starting price:{" "}
          <strong>{preview.meanStartingPrice === null ? "—" : money(preview.meanStartingPrice)}</strong>
        </li>
        <li>
          At the floor ({money(preview.floorPrice)}): <strong>{preview.atFloorCount}</strong> of{" "}
          {preview.poolSize} ({floorShare}%)
        </li>
        <li>
          Cap the lock will compute: <strong>{money(preview.computedCap)}</strong> ={" "}
          {preview.teamSize ?? "—"} × {money(preview.meanStartingPrice)}, rounded to the nearest{" "}
          {money(preview.roundingIncrement)} with halves up (O3/D4)
        </li>
        <li>
          Cap currently stored: {money(preview.currentCap)}{" "}
          {preview.lockedAt === null ? "(placeholder — the lock overwrites it)" : "(frozen)"}
        </li>
      </ul>

      <PoolCompletenessWarning preview={preview} />

      <h3 className="admin-section-title" style={{ marginTop: "var(--sp-4)" }}>
        What freezes
      </h3>
      <div className="card table-card">
        <table className="table admin-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Decision</th>
              <th>Where it lives</th>
              <th>Refused by</th>
            </tr>
          </thead>
          <tbody>
            {LOCK_CATEGORIES.map((c) => (
              <tr key={c.key}>
                <td className="tight">{c.label}</td>
                <td className="tight">{c.decision}</td>
                <td className="tight">
                  <code>{c.target}</code>
                </td>
                <td className="tight">
                  <code>{c.enforcedBy}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * O3's pool-completeness warning (A9), stated where it bites: at the moment of
 * firing. Newcomers price at the D4 floor and pull the mean — and therefore the
 * cap — DOWN, so a pool skewed toward established performers produces a cap that
 * is systematically too GENEROUS relative to the 1.0× intent.
 */
function PoolCompletenessWarning({ preview }: { preview: SeasonLockPreview }) {
  if (preview.lockedAt !== null) return null;
  return (
    <div className="admin-banner admin-banner-locked" style={{ marginTop: "var(--sp-3)" }}>
      <strong>Check the pool is complete before you fire this.</strong>
      <span>
        The cap is 1.0× with no headroom, so it is only as right as the pool it is computed
        from. Unknown and newcomer registrants price at the floor and pull the mean — and the
        cap — down; a pool weighted toward established performers therefore yields a cap that
        is too generous (O3/A9). {preview.atFloorCount} of {preview.poolSize} players currently
        sit at the floor. If registrations are still open, enter the expected newcomers as
        floor-priced registry entries first, so the mean reflects the real pool.
      </span>
    </div>
  );
}

// ── Fire, and the record afterwards ─────────────────────────────────────────

function FirePanel({
  seasonId,
  seasonName,
  preview,
}: {
  seasonId: string;
  seasonName: string;
  preview: SeasonLockPreview;
}) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const armed = isArmed(typed, seasonName);

  const fire = useMutation({
    mutationFn: () => fireSeasonLock(seasonId),
    onSuccess: async () => {
      setTyped("");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <div className="admin-banner admin-banner-frozen">
        <strong>This is a one-way door. There is no unlock.</strong>
        <span>
          Firing it freezes the economy and the team set permanently: the database will refuse
          every change in the table above, from this app, from the SQL editor, and from
          anything else that ever connects (G10/D21). Rehearse on a scratch season first.
        </span>
      </div>

      {!preview.lockable ? (
        <div className="admin-banner admin-banner-frozen" style={{ marginTop: "var(--sp-3)" }}>
          <strong>The lock is blocked.</strong>
          <span>{preview.blocker}</span>
        </div>
      ) : (
        <ul className="admin-log">
          <li>
            Pool at this moment: <strong>{preview.poolSize}</strong> players, mean{" "}
            <strong>{money(preview.meanStartingPrice)}</strong>, {preview.atFloorCount} at the
            floor
          </li>
          <li>
            Cap to be computed and frozen: <strong>{money(preview.computedCap)}</strong>
          </li>
          <li>
            Fantasy-team registration closes permanently — fixtures are derived from the team
            set and need it stable (D21)
          </li>
        </ul>
      )}

      <Field
        label={`Type the season name to arm this`}
        hint={`exactly “${seasonName}”`}
      >
        <input
          value={typed}
          disabled={!preview.lockable || fire.isPending}
          placeholder={seasonName}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>

      <div className="admin-actions">
        <button
          className="btn-ghost btn-danger"
          disabled={!preview.lockable || !armed || fire.isPending}
          onClick={() => fire.mutate()}
        >
          {fire.isPending ? "Locking…" : `Lock ${seasonName} permanently`}
        </button>
      </div>

      <StatusLine error={fire.error ? new Error(explainLockError(fire.error)) : undefined} />
    </div>
  );
}

function LockedRecord({
  lockedAt,
  preview,
}: {
  lockedAt: string | null;
  preview: SeasonLockPreview | null;
}) {
  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <ul className="admin-log">
        <li>
          Locked <strong>{dateTime(lockedAt)}</strong>
        </li>
        <li>
          Salary cap <strong>{money(preview?.currentCap ?? null)}</strong>, computed by the lock
          over {preview?.poolSize ?? "—"} players at a mean of{" "}
          {money(preview?.meanStartingPrice ?? null)} (O3)
        </li>
        <li>
          All {LOCK_CATEGORIES.length} categories above are frozen. Players can still be added
          mid-season at the floor, and that does not move the cap (C4/O3).
        </li>
      </ul>
      <p className="admin-note">
        There is no unlock control on this page because there is no unlock. The database
        refuses to clear or move <code>locked_at</code>, so a control here could only lie.
      </p>
    </div>
  );
}
