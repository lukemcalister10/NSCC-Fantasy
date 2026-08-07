import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminPage, Section, StatusLine, Field } from "./adminChrome";
import {
  useAdminSeason,
  useAdminPlayers,
  useAdminRounds,
  useScorecard,
} from "../../lib/adminQueries";
import type { AdminMatch, AdminPlayer, ScorecardView } from "../../lib/adminQueries";
import { saveScorecard, updateMatch, explainWriteError } from "../../lib/adminMutations";
import { Loading, ErrorState, EmptyState } from "../../components/states";
import {
  parseTypedDismissal,
  describeResolved,
  type RegistryEntry,
} from "../../lib/dismissalEntry";

/**
 * SCORECARD ENTRY (/admin/scorecards) — a full match card, ALL innings.
 *
 * Shape of the form, and why:
 *
 *  · LINEUP FIRST, as an explicit choice. Membership of the named XI is what
 *    separates DNP from played (D2/D3) — a player in the lineup who scored
 *    nothing scores 0 and reprices; a player left out did not play and his price
 *    freezes. So it is never inferred from "did they have any stats", it is
 *    ticked.
 *
 *  · INNINGS ARE NOT FIXED AT TWO. D5 contemplates two-day matches, so innings
 *    are added as needed and every line carries its innings number (0006).
 *
 *  · FIELDING COMES FROM DISMISSALS, resolved to players at entry time (D25).
 *    Type the dismissal as it reads on the card; the same engine parser that will
 *    score it tells you immediately who gets credited. A name the registry cannot
 *    resolve blocks the save — it is never guessed. A dismissal that names no
 *    catcher simply earns nobody a credit, which is the accepted ruling.
 *
 *  · O4 CAPTURE. not-out and maidens are entered here even though today's engine
 *    ignores them: without them a duck cannot be told from an unbeaten 0, and no
 *    later recompute could recover the difference from raw truth.
 *
 * Target: ≤10 minutes per grade per week (KICKOFF; baseline B1 measures it).
 */

interface BattingDraft {
  batted: boolean;
  runs: string;
  balls: string;
  fours: string;
  sixes: string;
  notOut: boolean;
}
interface BowlingDraft {
  bowled: boolean;
  overs: string;
  runs: string;
  wickets: string;
  maidens: string;
}
interface DismissalDraft {
  innings: number;
  text: string;
}

const emptyBatting = (): BattingDraft => ({
  batted: false,
  runs: "",
  balls: "",
  fours: "",
  sixes: "",
  notOut: false,
});
const emptyBowling = (): BowlingDraft => ({
  bowled: false,
  overs: "",
  runs: "",
  wickets: "",
  maidens: "",
});

const n = (s: string): number => {
  const v = Number(s.trim());
  return Number.isFinite(v) ? v : 0;
};
const cellKey = (innings: number, playerId: string) => `${innings}:${playerId}`;

export function AdminScorecards() {
  const season = useAdminSeason();
  const rounds = useAdminRounds(season.data?.id);
  const players = useAdminPlayers(season.data?.id);
  const [matchId, setMatchId] = useState<string | null>(null);

  if (season.isLoading || rounds.isLoading || players.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) {
    return (
      <AdminPage title="Scorecards">
        <EmptyState>No season exists yet.</EmptyState>
      </AdminPage>
    );
  }

  const allMatches: { match: AdminMatch; roundName: string; frozen: boolean }[] = (
    rounds.data ?? []
  ).flatMap((r) =>
    r.matches.map((m) => ({
      match: m,
      roundName: r.name,
      frozen: r.scorecards_frozen_at !== null,
    })),
  );
  const chosen = allMatches.find((m) => m.match.id === matchId) ?? null;

  return (
    <AdminPage title="Scorecards" intro="Enter a full match card — every innings.">
      <Section title="Match">
        {allMatches.length === 0 ? (
          <EmptyState>
            No matches yet. Create a round and assign matches under Rounds first.
          </EmptyState>
        ) : (
          <Field label="Which match">
            <select value={matchId ?? ""} onChange={(e) => setMatchId(e.target.value || null)}>
              <option value="">— choose a match —</option>
              {allMatches.map(({ match, roundName, frozen }) => (
                <option key={match.id} value={match.id}>
                  {roundName} · {match.grade} v {match.opponent} · {match.status}
                  {frozen ? " · FROZEN" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
      </Section>

      {chosen ? (
        <ScorecardEditor
          key={chosen.match.id}
          match={chosen.match}
          roundName={chosen.roundName}
          frozen={chosen.frozen}
          players={(players.data ?? []).filter((p) => p.active)}
        />
      ) : null}
    </AdminPage>
  );
}

function ScorecardEditor({
  match,
  roundName,
  frozen,
  players,
}: {
  match: AdminMatch;
  roundName: string;
  frozen: boolean;
  players: AdminPlayer[];
}) {
  const qc = useQueryClient();
  const card = useScorecard(match.id);

  const [lineup, setLineup] = useState<string[]>([]);
  const [wk, setWk] = useState<string | null>(null);
  const [inningsCount, setInningsCount] = useState(1);
  const [batting, setBatting] = useState<Record<string, BattingDraft>>({});
  const [bowling, setBowling] = useState<Record<string, BowlingDraft>>({});
  const [dismissals, setDismissals] = useState<DismissalDraft[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  // Load the stored card into the form once it arrives.
  useEffect(() => {
    const data: ScorecardView | null | undefined = card.data;
    if (!data) {
      setLineup([]);
      setWk(null);
      setInningsCount(1);
      setBatting({});
      setBowling({});
      setDismissals([]);
      return;
    }
    setLineup(data.lineup);
    setWk(data.wicket_keeper_player_id);
    setInningsCount(
      Math.max(
        1,
        ...data.batting.map((b) => b.innings),
        ...data.bowling.map((b) => b.innings),
        ...data.dismissals.map((d) => d.innings),
      ),
    );
    setBatting(
      Object.fromEntries(
        data.batting.map((b) => [
          cellKey(b.innings, b.player_id),
          {
            batted: true,
            runs: String(b.runs),
            balls: String(b.balls_faced),
            fours: String(b.fours),
            sixes: String(b.sixes),
            notOut: b.not_out,
          },
        ]),
      ),
    );
    setBowling(
      Object.fromEntries(
        data.bowling.map((b) => [
          cellKey(b.innings, b.player_id),
          {
            bowled: true,
            overs: String(b.overs),
            runs: String(b.runs_conceded),
            wickets: String(b.wickets),
            maidens: String(b.maidens),
          },
        ]),
      ),
    );
    setDismissals(
      data.dismissals.map((d) => ({
        innings: d.innings,
        // Prefer what the operator originally typed; fall back to a readable
        // rendering of the canonical string rather than showing raw ids.
        text: d.source_text ?? describeResolved(d.resolved_text, registryOf(players)),
      })),
    );
  }, [card.data, players]);

  const lineupRegistry: RegistryEntry[] = useMemo(
    () =>
      lineup
        .map((id) => players.find((p) => p.id === id))
        .filter((p): p is AdminPlayer => !!p)
        .map((p) => ({ id: p.id, displayName: p.display_name })),
    [lineup, players],
  );

  const parsedDismissals = useMemo(
    () => dismissals.map((d) => parseTypedDismissal(d.text, lineupRegistry)),
    [dismissals, lineupRegistry],
  );
  const unresolved = parsedDismissals.flatMap((p) => p.unresolved);

  const save = useMutation({
    mutationFn: async () => {
      const battingRows = Object.entries(batting)
        .filter(([, v]) => v.batted)
        .map(([key, v]) => {
          const [innings, player_id] = splitKey(key);
          return {
            innings,
            player_id,
            runs: n(v.runs),
            balls_faced: n(v.balls),
            fours: n(v.fours),
            sixes: n(v.sixes),
            not_out: v.notOut,
          };
        })
        .filter((r) => lineup.includes(r.player_id) && r.innings <= inningsCount);

      const bowlingRows = Object.entries(bowling)
        .filter(([, v]) => v.bowled)
        .map(([key, v]) => {
          const [innings, player_id] = splitKey(key);
          return {
            innings,
            player_id,
            overs: n(v.overs),
            runs_conceded: n(v.runs),
            wickets: n(v.wickets),
            maidens: n(v.maidens),
          };
        })
        .filter((r) => lineup.includes(r.player_id) && r.innings <= inningsCount);

      const dismissalRows = dismissals.map((d, i) => ({
        innings: d.innings,
        seq: i,
        resolved_text: parsedDismissals[i]!.resolvedText,
        source_text: d.text,
      }));

      await saveScorecard({
        matchId: match.id,
        wicketKeeperPlayerId: wk,
        lineup,
        batting: battingRows,
        bowling: bowlingRows,
        dismissals: dismissalRows,
      });
    },
    onSuccess: async () => {
      setSaved("Scorecard saved. Run a recompute from the dashboard to publish scores and prices.");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const finalise = useMutation({
    mutationFn: () => updateMatch(match.id, { status: "finalised" }),
    onSuccess: async () => {
      setSaved("Match finalised. It now contributes to scores and prices on the next recompute.");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  if (card.isLoading) return <Loading label="Loading scorecard…" />;

  return (
    <>
      {frozen ? (
        <div className="admin-banner admin-banner-frozen">
          <strong>{roundName} is frozen (D24).</strong>
          <span>
            Lockout has ended for this round, so its scorecards can no longer be edited — the
            database refuses the write. Recompute still reproduces exactly what they say.
          </span>
        </div>
      ) : (
        <div className="admin-banner">
          <strong>
            {match.grade} v {match.opponent} · {roundName} · {match.status}
          </strong>
          <span>
            Enter the card, then mark the match finalised — a match only contributes to scores
            and prices once it is finalised, so a part-entered card on a scheduled match changes
            nothing.
          </span>
        </div>
      )}

      <Section title="Named XI">
        <p className="admin-note">
          Tick everyone who was named in the lineup. This is what separates DNP from played
          (D2/D3): a player left out scores nothing and his price freezes; a player ticked
          reprices even on a duck. {lineup.length} selected.
        </p>
        <div className="admin-chips">
          {players.map((p) => {
            const on = lineup.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={frozen}
                className={`admin-chip${on ? " admin-chip-on" : ""}`}
                onClick={() =>
                  setLineup(on ? lineup.filter((id) => id !== p.id) : [...lineup, p.id])
                }
              >
                {p.display_name}
                <span style={{ color: "var(--ink-faint)" }}>{p.role}</span>
              </button>
            );
          })}
        </div>

        <div className="admin-form-grid admin-form-grid-2" style={{ marginTop: "var(--sp-3)" }}>
          <Field label="Wicket-keeper" hint="decides keeper vs outfield catch values">
            <select
              value={wk ?? ""}
              disabled={frozen}
              onChange={(e) => setWk(e.target.value || null)}
            >
              <option value="">— none recorded —</option>
              {lineupRegistry.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Innings in this match" hint="two-day matches have more than one (D5)">
            <div className="admin-actions" style={{ marginTop: 0 }}>
              <span style={{ alignSelf: "center", fontWeight: 400 }}>{inningsCount}</span>
              <button
                type="button"
                className="btn-ghost"
                disabled={frozen}
                onClick={() => setInningsCount(inningsCount + 1)}
              >
                Add an innings
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={frozen || inningsCount <= 1}
                onClick={() => setInningsCount(inningsCount - 1)}
              >
                Remove last
              </button>
            </div>
          </Field>
        </div>
      </Section>

      {Array.from({ length: inningsCount }, (_, i) => i + 1).map((innings) => (
        <Section key={innings} title={`Innings ${innings}`}>
          <div className="card table-card" style={{ marginBottom: "var(--sp-4)" }}>
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>Batted</th>
                  <th>Player</th>
                  <th className="col-num">Runs</th>
                  <th className="col-num">Balls</th>
                  <th className="col-num">4s</th>
                  <th className="col-num">6s</th>
                  <th>Not out</th>
                </tr>
              </thead>
              <tbody>
                {lineupRegistry.map((p) => {
                  const key = cellKey(innings, p.id);
                  const row = batting[key] ?? emptyBatting();
                  const set = (patch: Partial<BattingDraft>) =>
                    setBatting({ ...batting, [key]: { ...row, ...patch } });
                  return (
                    <tr key={key}>
                      <td className="tight">
                        <input
                          type="checkbox"
                          checked={row.batted}
                          disabled={frozen}
                          onChange={(e) => set({ batted: e.target.checked })}
                          style={{ width: "auto" }}
                        />
                      </td>
                      <td className="tight">{p.displayName}</td>
                      {(["runs", "balls", "fours", "sixes"] as const).map((f) => (
                        <td className="tight col-num" key={f}>
                          <input
                            className="num-cell"
                            inputMode="numeric"
                            disabled={frozen || !row.batted}
                            value={row[f]}
                            onChange={(e) => set({ [f]: e.target.value } as Partial<BattingDraft>)}
                          />
                        </td>
                      ))}
                      <td className="tight">
                        <input
                          type="checkbox"
                          checked={row.notOut}
                          disabled={frozen || !row.batted}
                          onChange={(e) => set({ notOut: e.target.checked })}
                          style={{ width: "auto" }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card table-card">
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>Bowled</th>
                  <th>Player</th>
                  <th className="col-num">Overs</th>
                  <th className="col-num">Runs</th>
                  <th className="col-num">Wkts</th>
                  <th className="col-num">Maidens</th>
                </tr>
              </thead>
              <tbody>
                {lineupRegistry.map((p) => {
                  const key = cellKey(innings, p.id);
                  const row = bowling[key] ?? emptyBowling();
                  const set = (patch: Partial<BowlingDraft>) =>
                    setBowling({ ...bowling, [key]: { ...row, ...patch } });
                  return (
                    <tr key={key}>
                      <td className="tight">
                        <input
                          type="checkbox"
                          checked={row.bowled}
                          disabled={frozen}
                          onChange={(e) => set({ bowled: e.target.checked })}
                          style={{ width: "auto" }}
                        />
                      </td>
                      <td className="tight">{p.displayName}</td>
                      {(["overs", "runs", "wickets", "maidens"] as const).map((f) => (
                        <td className="tight col-num" key={f}>
                          <input
                            className="num-cell"
                            inputMode="decimal"
                            disabled={frozen || !row.bowled}
                            value={row[f]}
                            onChange={(e) => set({ [f]: e.target.value } as Partial<BowlingDraft>)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <DismissalEditor
            innings={innings}
            frozen={frozen}
            dismissals={dismissals}
            setDismissals={setDismissals}
            registry={lineupRegistry}
          />
        </Section>
      ))}

      <div className="admin-actions">
        <button
          className="btn-primary btn-primary-inline"
          disabled={frozen || save.isPending || lineup.length === 0 || unresolved.length > 0}
          onClick={() => {
            setSaved(null);
            save.mutate();
          }}
        >
          {save.isPending ? "Saving…" : "Save scorecard"}
        </button>
        {match.status !== "finalised" ? (
          <button
            className="btn-ghost"
            disabled={frozen || finalise.isPending}
            onClick={() => finalise.mutate()}
          >
            {finalise.isPending ? "Finalising…" : "Mark match finalised"}
          </button>
        ) : null}
      </div>
      {unresolved.length > 0 ? (
        <p className="admin-status admin-status-error">
          Unresolved fielder{unresolved.length === 1 ? "" : "s"}: {unresolved.join(", ")}. Fix the
          spelling, or add the player to the lineup — an unmatched name is never guessed (D25).
        </p>
      ) : null}
      <StatusLine
        error={
          save.error
            ? new Error(explainWriteError(save.error))
            : finalise.error
              ? new Error(explainWriteError(finalise.error))
              : undefined
        }
        success={saved}
      />
    </>
  );
}

function DismissalEditor({
  innings,
  frozen,
  dismissals,
  setDismissals,
  registry,
}: {
  innings: number;
  frozen: boolean;
  dismissals: DismissalDraft[];
  setDismissals: (d: DismissalDraft[]) => void;
  registry: RegistryEntry[];
}) {
  const rows = dismissals
    .map((d, index) => ({ d, index }))
    .filter(({ d }) => d.innings === innings);

  return (
    <div style={{ marginTop: "var(--sp-4)" }}>
      <h4 className="admin-section-title" style={{ marginBottom: "var(--sp-2)" }}>
        Opposition dismissals — innings {innings}
      </h4>
      <p className="admin-note">
        Type each dismissal as it reads on the card (“c Sam Hollis b Tomas Reiner”, “run out
        (Priya Raman)”, “st …”, “b …”). Fielding credits come from these strings and are
        resolved to registry players as you type (D25); the bowler is scored from the bowling
        figures, never from here.
      </p>

      {rows.map(({ d, index }) => {
        const parsed = parseTypedDismissal(d.text, registry);
        return (
          <div key={index} style={{ marginBottom: "var(--sp-2)" }}>
            <div className="admin-actions" style={{ marginTop: 0 }}>
              <input
                style={{ flex: "1 1 20rem" }}
                value={d.text}
                disabled={frozen}
                placeholder="c Fielder b Bowler"
                onChange={(e) => {
                  const next = [...dismissals];
                  next[index] = { ...d, text: e.target.value };
                  setDismissals(next);
                }}
              />
              <button
                type="button"
                className="btn-ghost"
                disabled={frozen}
                onClick={() => setDismissals(dismissals.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
            <p
              className={`admin-status${parsed.unresolved.length > 0 ? " admin-status-error" : ""}`}
            >
              {d.text.trim() === ""
                ? "empty — will record no credit"
                : parsed.unresolved.length > 0
                  ? `not in this lineup: ${parsed.unresolved.join(", ")}`
                  : parsed.fielderIds.length === 0
                    ? "no fielding credit (bowled, LBW or unnamed catcher)"
                    : describeResolved(parsed.resolvedText, registry)}
            </p>
          </div>
        );
      })}

      <div className="admin-actions">
        <button
          type="button"
          className="btn-ghost"
          disabled={frozen}
          onClick={() => setDismissals([...dismissals, { innings, text: "" }])}
        >
          Add a dismissal
        </button>
      </div>
    </div>
  );
}

function registryOf(players: AdminPlayer[]): RegistryEntry[] {
  return players.map((p) => ({ id: p.id, displayName: p.display_name }));
}

function splitKey(key: string): [number, string] {
  const at = key.indexOf(":");
  return [Number(key.slice(0, at)), key.slice(at + 1)];
}
