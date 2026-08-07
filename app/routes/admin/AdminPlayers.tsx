import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminPage, Section, SeasonLockBanner, StatusLine, Field } from "./adminChrome";
import { useAdminSeason, useAdminPlayers, useRegistryEvents } from "../../lib/adminQueries";
import type { AdminPlayer } from "../../lib/adminQueries";
import {
  createPlayer,
  updatePlayer,
  importPlayers,
  explainWriteError,
} from "../../lib/adminMutations";
import { Loading, ErrorState, EmptyState } from "../../components/states";
import { RoleBadge } from "../../components/RoleBadge";
import { money, shortDate } from "../../lib/format";
import { parseRegistrySeed, type SeedRow } from "../../../src/registry/csvImport";
import { normaliseName } from "../../../src/registry/nameNormalisation";
import type { PlayerRole } from "../../../src/config/types";

const ROLES: PlayerRole[] = ["BAT", "WK", "BWL", "AR"];

/**
 * PLAYER REGISTRY (/admin/players) — list, create, edit, CSV import, mid-season add.
 *
 * Roles and prices are editable PRE-LOCK ONLY (D4/D9/D13). Post-lock this screen
 * disables those inputs and says why — but the refusal that counts is the
 * database's (0002's trg_players_lock, gate G10). The UI is a courtesy; it is not
 * the boundary, and it never pretends to be.
 *
 * DATA HANDLING (D17/Law 11): the import reads a file the operator picks in the
 * browser, parses it IN MEMORY, writes the rows to the database and forgets it.
 * No player data file is read from, or written to, this repository.
 */
export function AdminPlayers() {
  const season = useAdminSeason();
  const seasonId = season.data?.id;
  const players = useAdminPlayers(seasonId);
  const events = useRegistryEvents(seasonId, 12);
  const locked = !!season.data?.locked_at;

  if (season.isLoading || players.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) {
    return (
      <AdminPage title="Player registry">
        <EmptyState>No season exists yet. Create one before registering players.</EmptyState>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="Player registry"
      intro={`${season.data.name} · ${players.data?.length ?? 0} players`}
    >
      <SeasonLockBanner lockedAt={season.data.locked_at} />

      <Section title={locked ? "Add a player mid-season" : "Add a player"}>
        <AddPlayerForm
          seasonId={season.data.id}
          locked={locked}
          floor={season.data.config.pricing.floor}
        />
      </Section>

      {!locked ? (
        <Section title="Import the registry seed (CSV)">
          <ImportSeed seasonId={season.data.id} pricing={season.data.config.pricing} />
        </Section>
      ) : null}

      <Section title="Registry">
        {players.error ? (
          <ErrorState error={players.error} />
        ) : (players.data?.length ?? 0) === 0 ? (
          <EmptyState>No players yet — add one above, or import the seed.</EmptyState>
        ) : (
          <div className="card table-card">
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th>WK elig.</th>
                  <th className="col-num">Starting price</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {players.data!.map((p) => (
                  <PlayerRow key={p.id} player={p} locked={locked} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Recent registry changes">
        <p className="admin-note">
          Every create and edit is written by a database trigger, not by this page —
          a log the writer can skip is not a log (C4).
        </p>
        {(events.data?.length ?? 0) === 0 ? (
          <EmptyState>Nothing logged yet.</EmptyState>
        ) : (
          <ul className="admin-log">
            {events.data!.map((e) => (
              <li key={e.id}>
                <strong>{e.event === "create" ? "Added" : "Edited"}</strong>{" "}
                {playerName(players.data, e.player_id)} · {shortDate(e.at)} ·{" "}
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {summariseDetail(e.detail)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </AdminPage>
  );
}

function playerName(players: AdminPlayer[] | undefined, id: string | null): string {
  if (!id) return "(removed player)";
  return players?.find((p) => p.id === id)?.display_name ?? "(player)";
}

function summariseDetail(detail: Record<string, unknown>): string {
  if ("mid_season" in detail) {
    return detail["mid_season"] === true ? "mid-season addition" : "registration";
  }
  return Object.entries(detail)
    .map(([field, change]) => {
      const c = change as { from?: unknown; to?: unknown };
      return `${field}: ${String(c.from)} → ${String(c.to)}`;
    })
    .join(" · ");
}

// ── Add / mid-season add ────────────────────────────────────────────────────

function AddPlayerForm({
  seasonId,
  locked,
  floor,
}: {
  seasonId: string;
  locked: boolean;
  floor: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState<PlayerRole>("BAT");
  const [wkEligible, setWkEligible] = useState(false);
  const [price, setPrice] = useState<string>("");
  const [done, setDone] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      const startingPrice = price.trim() === "" ? (locked ? null : null) : Number(price);
      return createPlayer(seasonId, {
        displayName: name,
        role,
        wkEligible,
        startingPrice,
        active: true,
      });
    },
    onSuccess: async () => {
      setDone(
        locked
          ? `Added mid-season. Price defaults to the config floor (${money(floor)}); the salary cap is unchanged (O3).`
          : "Added to the registry.",
      );
      setName("");
      setPrice("");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const canonical = normaliseName(name);

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <p className="admin-note">
        {locked
          ? "The season is locked, so a new player joins at the config floor unless you set a price. Adding a player does not change the salary cap — it was computed at lock and is frozen (O3/C4)."
          : "Names are stored in their normalised form (D22) so inbound scorecards match them. Leave the price blank before lock; prices materialise when the season locks."}
      </p>
      <div className="admin-form-grid admin-form-grid-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as PlayerRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="WK eligible" hint="the only dual eligibility (D9)">
          <input
            type="checkbox"
            checked={wkEligible}
            onChange={(e) => setWkEligible(e.target.checked)}
            style={{ width: "auto" }}
          />
        </Field>
        <Field label="Starting price" hint={locked ? `blank = floor ${money(floor)}` : "optional"}>
          <input
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={locked ? String(floor) : "—"}
          />
        </Field>
      </div>
      {canonical !== "" && canonical !== name.trim() ? (
        <p className="admin-note">Will be stored as “{canonical}” (D22 normalisation).</p>
      ) : null}
      <div className="admin-actions">
        <button
          className="btn-primary btn-primary-inline"
          disabled={canonical === "" || add.isPending}
          onClick={() => {
            setDone(null);
            add.mutate();
          }}
        >
          {add.isPending ? "Adding…" : "Add player"}
        </button>
      </div>
      <StatusLine
        error={add.error ? new Error(explainWriteError(add.error)) : undefined}
        success={done}
      />
    </div>
  );
}

// ── Registry row (inline edit) ──────────────────────────────────────────────

function PlayerRow({ player, locked }: { player: AdminPlayer; locked: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({
    displayName: player.display_name,
    role: player.role,
    wkEligible: player.wk_eligible,
    price: player.starting_price === null ? "" : String(player.starting_price),
    active: player.active,
  });

  const dirty =
    draft.displayName !== player.display_name ||
    draft.role !== player.role ||
    draft.wkEligible !== player.wk_eligible ||
    draft.active !== player.active ||
    draft.price !== (player.starting_price === null ? "" : String(player.starting_price));

  const save = useMutation({
    mutationFn: () =>
      updatePlayer(player.id, {
        displayName: draft.displayName,
        // Post-lock these are frozen by the database; the UI does not even offer
        // them, so a save carries only what is still legal to change.
        ...(locked
          ? {}
          : {
              role: draft.role,
              wkEligible: draft.wkEligible,
              startingPrice: draft.price.trim() === "" ? null : Number(draft.price),
            }),
        active: draft.active,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  return (
    <tr>
      <td className="tight">
        <input
          value={draft.displayName}
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
        />
      </td>
      <td className="tight">
        {locked ? (
          <RoleBadge role={player.role} wkEligible={player.wk_eligible} />
        ) : (
          <select
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as PlayerRole })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="tight">
        <input
          type="checkbox"
          checked={draft.wkEligible}
          disabled={locked}
          onChange={(e) => setDraft({ ...draft, wkEligible: e.target.checked })}
          style={{ width: "auto" }}
        />
      </td>
      <td className="tight col-num">
        {locked ? (
          <span className="num">{money(player.starting_price)}</span>
        ) : (
          <input
            className="num-cell"
            inputMode="numeric"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
        )}
      </td>
      <td className="tight">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          style={{ width: "auto" }}
        />
      </td>
      <td className="tight">
        <button
          className="btn-ghost"
          disabled={!dirty || save.isPending}
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

// ── CSV import: review, then commit ─────────────────────────────────────────

function ImportSeed({
  seasonId,
  pricing,
}: {
  seasonId: string;
  pricing: { floor: number; dollarsPerPoint: number; roundingIncrement: number; startingPriceGamesCap: number; alpha: number };
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseRegistrySeed> | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const commit = useMutation({
    mutationFn: () =>
      importPlayers(
        seasonId,
        parsed!.importable.map((r) => ({
          name: r.name,
          role: r.role,
          wkEligible: r.wkEligible,
          price: r.computedPrice, // the ENGINE's value, never the file's column
        })),
      ),
    onSuccess: async (rows) => {
      setDone(`Imported ${rows.length} players.`);
      setParsed(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const blocked = useMemo(
    () => (parsed ? parsed.rows.filter((r) => r.errors.length > 0) : []),
    [parsed],
  );

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <p className="admin-note">
        Columns: <code>player, role, wk_eligible, g_matches_2526, total_fantasy_pts_2526,
        starting_price_reference</code>. The price column is <strong>not trusted</strong> — every
        price is recomputed from points and games through the D4/G14 starting-price engine, and
        any row where the file disagrees is flagged below. Nothing is written until you press
        Import. The file is read in your browser and never uploaded anywhere but the database
        (D17).
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          setDone(null);
          if (!file) {
            setParsed(null);
            setFileName(null);
            return;
          }
          setFileName(file.name);
          setParsed(parseRegistrySeed(await file.text(), pricing));
        }}
      />

      {parsed ? (
        <>
          <p className="admin-note" style={{ marginTop: "var(--sp-3)" }}>
            <strong>{fileName}</strong>: {parsed.rows.length} rows · {parsed.importable.length}{" "}
            importable · {blocked.length} blocked · {parsed.disagreements.length} price
            disagreement{parsed.disagreements.length === 1 ? "" : "s"}.
          </p>

          {parsed.errors.length > 0 ? (
            <div className="admin-banner admin-banner-frozen">
              <strong>This file cannot be imported.</strong>
              <span>{parsed.errors.join(" · ")}</span>
            </div>
          ) : null}

          {parsed.disagreements.length > 0 ? (
            <div className="admin-banner admin-banner-locked">
              <strong>
                {parsed.disagreements.length} row
                {parsed.disagreements.length === 1 ? "" : "s"} disagree with the file's price
                column.
              </strong>
              <span>
                The engine's value is what will be written. Check these before importing.
              </span>
            </div>
          ) : null}

          <div className="card table-card" style={{ marginTop: "var(--sp-3)" }}>
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Player</th>
                  <th>Role</th>
                  <th>WK</th>
                  <th className="col-num">G</th>
                  <th className="col-num">Points</th>
                  <th className="col-num">Computed</th>
                  <th className="col-num">File says</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((r) => (
                  <SeedRowView key={r.line} row={r} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-actions">
            <button
              className="btn-primary btn-primary-inline"
              disabled={parsed.importable.length === 0 || commit.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending
                ? "Importing…"
                : `Import ${parsed.importable.length} players`}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setParsed(null);
                setFileName(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Discard
            </button>
          </div>
        </>
      ) : null}

      <StatusLine
        error={commit.error ? new Error(explainWriteError(commit.error)) : undefined}
        success={done}
      />
    </div>
  );
}

function SeedRowView({ row }: { row: SeedRow }) {
  const status =
    row.errors.length > 0
      ? row.errors.join(" · ")
      : row.priceDisagrees
        ? "price differs — engine value used"
        : "ok";
  return (
    <tr>
      <td className="tight">{row.line}</td>
      <td className="tight">
        {row.name}
        {row.rawName ? (
          <div style={{ color: "var(--ink-faint)", fontSize: "var(--fs-xs)" }}>
            from “{row.rawName}”
          </div>
        ) : null}
      </td>
      <td className="tight">{row.role}</td>
      <td className="tight">{row.wkEligible ? "yes" : "—"}</td>
      <td className="tight col-num num">{row.games}</td>
      <td className="tight col-num num">{row.totalPoints}</td>
      <td className="tight col-num num">{money(row.computedPrice)}</td>
      <td className="tight col-num num">{money(row.referencePrice)}</td>
      <td
        className="tight"
        style={{
          color: row.errors.length
            ? "var(--down)"
            : row.priceDisagrees
              ? "var(--role-ar-ink)"
              : "var(--ink-muted)",
        }}
      >
        {status}
      </td>
    </tr>
  );
}
