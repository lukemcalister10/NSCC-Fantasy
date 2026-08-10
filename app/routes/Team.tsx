import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useSeason } from "../lib/queries";
import { useTeamState } from "../lib/useTeamState";
import {
  buildInitialSquad,
  isAlreadyMaterialised,
  registerTeam,
  resolveCaptaincy,
  setCaptaincy,
  syncSelectionsToHoldings,
  translateRefusal,
  type Captaincy,
  type Refusal,
} from "../lib/teamMutations";
import { validateComposition, type RoleCarrier } from "../lib/squad";
import { Loading, ErrorState, EmptyState } from "../components/states";
import {
  CapStrip,
  CompositionMeter,
  LockNotice,
  PriceBasisNote,
  RefusalNotice,
  TeamTabs,
  TradeBudgetNotice,
} from "../components/team/TeamChrome";
import { PoolPicker, SquadTable } from "../components/team/SquadPicker";
import { money } from "../lib/format";
import type { PoolPlayer } from "../lib/teamQueries";
import "../styles/team.css";

/**
 * SQUAD VIEW (/team) — holdings, cap position, composition against config, and
 * captaincy, plus the initial build.
 *
 * SELECTIONS ARE NOT A SEPARATE CONCEPT (operator ruling). There is no bench and
 * no emergency mechanic, intentionally: a participant's round selection IS their
 * holdings, always, with no per-round choice to make. So this screen never asks
 * anyone to "confirm your round-N squad" — where the database needs selection
 * rows to exist for its composition check, they are MATERIALISED from the ledger,
 * with captaincy carried forward from the previous round unless changed. A
 * participant who does nothing all week fields their full squad. The only way to
 * score zero is to hold nobody.
 *
 * MATERIALISATION HERE IS INTERIM, AND ITS REPLACEMENT IS ALREADY RULED ON.
 * D26 (operator, 10/08/2026) settles that the database materialises holdings into
 * each round's selection set at LOCK, server-side, and that this client-side
 * carry-forward is to be REMOVED when that trigger lands — not kept as a
 * fallback, because two writers of the same rows is how they diverge. S-E may add
 * no migration (Standing Rule 9a), so the trigger is specified for S-D and this
 * code stays until it exists: deleting the only writer first would leave every
 * participant with no selections, and a zero score, for any round that locked in
 * between. That trade is stated, not hidden.
 *
 * WHAT IT CANNOT DO, precisely: it runs only when a client is present before the
 * round locks, so a participant who never opens the app is not covered — which is
 * the whole reason D26 exists. It writes into EVERY open round, not just the next
 * one, so one visit covers every round already on the board.
 *
 * REMOVAL IS ONE FILE: delete the effect below and the `syncSelectionsToHoldings`
 * call inside it. Nothing else in this screen depends on it — the reconciliation
 * banner and explicit captaincy changes are separate paths and stay.
 */
export function Team() {
  const { session } = useAuth();
  const season = useSeason();
  const seasonId = season.data?.id;
  const seasonLocked = season.data?.locked_at !== null && season.data?.locked_at !== undefined;
  const state = useTeamState(seasonId, seasonLocked);

  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  // ── captaincy for the open round, carried forward ─────────────────────────
  const captaincy = useMemo<Captaincy | null>(
    () =>
      resolveCaptaincy({
        holdings: state.holdings,
        thisRound: state.selectionsForActiveRound,
        priorRound: state.priorSelections,
        priceOf: state.priceOf,
      }),
    [state.holdings, state.selectionsForActiveRound, state.priorSelections, state.priceOf],
  );

  // ── automatic carry-forward into every OPEN round with no selection set ───
  // Only ever fills an EMPTY set: nothing a participant authored is overwritten
  // without their say-so. A set that exists but disagrees with the ledger is a
  // reconciliation case, handled by the banner below (ledger authoritative).
  //
  // C7, FIXED HERE: this used to run as soon as HOLDINGS arrived. Hooks run
  // before the component's loading early-return, and `trades` and `selections`
  // are two independent queries — so on a cold load where trades answered first,
  // `state.selections` was still the empty array it starts as, every open round
  // looked unmaterialised, and the insert went in on top of rows that already
  // existed. Postgres refused it (23505 on UNIQUE (team, round, player)), which
  // was correct, and /team showed the participant a server-refusal banner for
  // something they had not done. `selectionsLoaded` distinguishes "none" from
  // "not told yet"; the duplicate-key catch below makes the residual race benign.
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!state.team || !captaincy || state.holdings.length === 0) return;
    if (!state.selectionsLoaded) return;
    const teamId = state.team.id;
    const fingerprint = state.holdings.map((h) => h.playerId).sort().join(",");
    for (const round of state.openRounds) {
      const existing = state.selections.filter((s) => s.round_id === round.id);
      if (existing.length > 0) continue;
      const key = `${round.id}:${fingerprint}`;
      if (attempted.current.has(key)) continue;
      attempted.current.add(key);
      void syncSelectionsToHoldings({
        teamId,
        roundId: round.id,
        holdings: state.holdings,
        existing: [],
        captaincy,
      })
        .then(() => state.refetch())
        .catch((err: unknown) => {
          // Already materialised (another tab, or this tab racing its own
          // refetch): the round holds exactly what we were about to write, so
          // re-read and say nothing. Every other refusal is still surfaced.
          if (isAlreadyMaterialised(err)) {
            state.refetch();
            return;
          }
          setRefusal(translateRefusal(err));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.team?.id,
    state.holdings,
    state.openRounds,
    state.selections,
    state.selectionsLoaded,
    captaincy,
  ]);

  if (season.isLoading || state.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (state.error) return <ErrorState error={state.error} />;
  if (!season.data)
    return (
      <div className="page">
        <EmptyState>No season found yet.</EmptyState>
      </div>
    );

  const squad = state.config?.squad;

  // ── no team registered yet ────────────────────────────────────────────────
  if (!state.team) {
    return (
      <div className="page">
        <h1 className="page-title">My Team</h1>
        <TeamTabs />
        <RegisterTeam
          seasonId={season.data.id}
          ownerProfileId={session?.user?.id ?? ""}
          seasonLocked={seasonLocked}
          onRegistered={() => state.refetch()}
        />
      </div>
    );
  }

  if (!squad) {
    return (
      <div className="page">
        <h1 className="page-title">{state.team.name}</h1>
        <TeamTabs />
        <EmptyState>
          This season has no squad configuration, so nothing can be validated. That is
          a setup problem — the database refuses selections against an incomplete
          config rather than passing them silently (G15 partial-config guard).
        </EmptyState>
      </div>
    );
  }

  const carriers: RoleCarrier[] = state.holdings
    .filter((h) => h.player)
    .map((h) => ({ role: h.player!.role, wk_eligible: h.player!.wk_eligible }));

  // Ledger vs selection set for the open round (ledger is authoritative).
  const activeSelectionIds = new Set(state.selectionsForActiveRound.map((s) => s.player_id));
  const holdingIds = new Set(state.holdings.map((h) => h.playerId));
  const divergent =
    state.activeRound !== null &&
    state.selectionsForActiveRound.length > 0 &&
    (activeSelectionIds.size !== holdingIds.size ||
      [...holdingIds].some((id) => !activeSelectionIds.has(id)));

  const priceDivergence = state.holdings.some(
    (h) =>
      h.player &&
      h.player.priceEnteringRound !== null &&
      h.player.latestPrice !== null &&
      h.player.priceEnteringRound !== h.player.latestPrice,
  );

  const repair = async () => {
    if (!state.activeRound || !captaincy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await syncSelectionsToHoldings({
        teamId: state.team!.id,
        roundId: state.activeRound.id,
        holdings: state.holdings,
        existing: state.selectionsForActiveRound,
        captaincy,
      });
      state.refetch();
    } catch (err) {
      setRefusal(translateRefusal(err));
    } finally {
      setBusy(false);
    }
  };

  const changeCaptaincy = async (next: Captaincy) => {
    if (!state.activeRound) return;
    setBusy(true);
    setRefusal(null);
    try {
      await setCaptaincy({
        teamId: state.team!.id,
        roundId: state.activeRound.id,
        holdings: state.holdings,
        existing: state.selectionsForActiveRound,
        captaincy: next,
      });
      state.refetch();
    } catch (err) {
      setRefusal(translateRefusal(err));
    } finally {
      setBusy(false);
    }
  };

  const captaincyDisabledReason =
    state.activeRound === null
      ? "Captaincy cannot change — every round has locked (D6/G4)."
      : state.selectionsForActiveRound.length === 0
        ? "Captaincy becomes editable once this round's squad is on the board."
        : busy
          ? "Saving…"
          : null;

  return (
    <div className="page">
      <h1 className="page-title">{state.team.name}</h1>
      <TeamTabs />

      <LockNotice activeRound={state.activeRound} allRoundsLocked={state.allRoundsLocked} />
      {refusal ? <RefusalNotice refusal={refusal} /> : null}

      {state.capRemaining !== null &&
      state.investedValue !== null &&
      state.teamValue !== null ? (
        <CapStrip
          cap={squad.cap}
          capRemaining={state.capRemaining}
          investedValue={state.investedValue}
          teamValue={state.teamValue}
        />
      ) : null}

      {state.holdings.length === 0 ? (
        <InitialBuild
          state={state}
          onRefusal={setRefusal}
          onDone={() => {
            attempted.current.clear();
            state.refetch();
          }}
        />
      ) : (
        <>
          <CompositionMeter players={carriers} squad={squad} />
          <PriceBasisNote
            roundName={state.activeRound?.name ?? "this round"}
            divergent={priceDivergence}
          />

          {divergent ? (
            <div className="reconcile" role="alert">
              <strong>Your squad and your ledger disagree.</strong>
              <p>
                The ledger is authoritative: it holds{" "}
                <strong className="num">{holdingIds.size}</strong> player(s), while{" "}
                {state.activeRound?.name} lists{" "}
                <strong className="num">{activeSelectionIds.size}</strong>. This happens
                if a page or connection dropped between the two writes that make up a
                trade. Repairing rewrites the round's squad to match the ledger — never
                the other way round.
              </p>
              <button className="btn-primary" onClick={() => void repair()} disabled={busy}>
                {busy ? "Repairing…" : "Repair squad from ledger"}
              </button>
            </div>
          ) : null}

          <SquadTable
            holdings={state.holdings}
            captainId={captaincy?.captainId ?? null}
            viceCaptainId={captaincy?.viceCaptainId ?? null}
            captaincyDisabledReason={captaincyDisabledReason}
            onSetCaptain={(playerId) =>
              void changeCaptaincy({
                captainId: playerId,
                viceCaptainId:
                  captaincy?.viceCaptainId === playerId
                    ? null
                    : (captaincy?.viceCaptainId ?? null),
              })
            }
            onSetViceCaptain={(playerId) =>
              void changeCaptaincy({
                captainId: captaincy?.captainId ?? playerId,
                viceCaptainId: playerId,
              })
            }
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team registration — minimal, name only, pre-lock only (D21/G10)
// ---------------------------------------------------------------------------

function RegisterTeam({
  seasonId,
  ownerProfileId,
  seasonLocked,
  onRegistered,
}: {
  seasonId: string;
  ownerProfileId: string;
  seasonLocked: boolean;
  onRegistered: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  if (seasonLocked) {
    return (
      <EmptyState>
        You have no team this season, and the season is locked — fantasy-team
        registration is frozen (D21/G10), because the H2H fixture schedule is derived
        from a stable team set. Ask the league manager.
      </EmptyState>
    );
  }

  const submit = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await registerTeam({ seasonId, ownerProfileId, name });
      onRegistered();
    } catch (err) {
      setRefusal(translateRefusal(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card register-card">
      <h2 className="section-title">Register your team</h2>
      <p className="page-sub">
        One team per person per season. The name is cosmetic and can be changed later;
        registration itself is frozen when the season locks (D21/G10), because the
        fixture schedule is derived from the team set.
      </p>
      {refusal ? <RefusalNotice refusal={refusal} /> : null}
      <div className="register-row">
        <input
          className="picker-search"
          value={name}
          maxLength={60}
          placeholder="Team name"
          aria-label="Team name"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn-primary"
          disabled={busy || name.trim().length === 0}
          onClick={() => void submit()}
        >
          {busy ? "Registering…" : "Register"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initial build
// ---------------------------------------------------------------------------

function InitialBuild({
  state,
  onRefusal,
  onDone,
}: {
  state: ReturnType<typeof useTeamState>;
  onRefusal: (r: Refusal | null) => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const squad = state.config!.squad;

  const pickedPlayers = useMemo(
    () => [...picked].map((id) => state.poolById.get(id)).filter((p): p is PoolPlayer => !!p),
    [picked, state.poolById],
  );

  const spend = pickedPlayers.reduce((n, p) => n + (p.priceEnteringRound ?? 0), 0);
  const capLeft = squad.cap - spend;
  const problems = validateComposition(pickedPlayers, squad);
  const overCap = capLeft < 0;
  const complete = pickedPlayers.length === squad.teamSize;
  const legal = complete && problems.length === 0 && !overCap;

  const toggle = (playerId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const submit = async () => {
    if (!state.activeRound || !state.team) return;
    setBusy(true);
    onRefusal(null);
    try {
      // LEDGER FIRST: the cap is the binding constraint, so a refusal lands
      // before any selection row exists. Prices are prices-entering-the-round
      // (Rider 2) — recompute asserts exactly this value later.
      await buildInitialSquad({
        teamId: state.team.id,
        roundId: state.activeRound.id,
        buys: pickedPlayers.map((p) => ({
          playerId: p.id,
          price: p.priceEnteringRound ?? 0,
        })),
      });
      onDone();
    } catch (err) {
      onRefusal(translateRefusal(err));
    } finally {
      setBusy(false);
    }
  };

  if (!state.activeRound) {
    return (
      <EmptyState>
        There is no open round, so a squad cannot be built. Every write against a
        locked round is refused server-side (D6/G4).
      </EmptyState>
    );
  }

  return (
    <div className="build">
      <h2 className="section-title">Build your squad</h2>
      {state.budget ? <TradeBudgetNotice budget={state.budget} /> : null}

      <CompositionMeter players={pickedPlayers} squad={squad} />

      <div className="build-status">
        <span>
          Spend <strong className="num">{money(spend)}</strong> · cap left{" "}
          <strong className={`num${overCap ? " over" : ""}`}>{money(capLeft)}</strong>
        </span>
        <span>
          Picked <strong className="num">{pickedPlayers.length}</strong> of{" "}
          <strong className="num">{squad.teamSize}</strong>
        </span>
      </div>

      {(problems.length > 0 || overCap) && pickedPlayers.length > 0 ? (
        <ul className="problem-list">
          {overCap ? (
            <li>
              Over the salary cap by <strong className="num">{money(-capLeft)}</strong>.
            </li>
          ) : null}
          {problems.map((p) => (
            <li key={p.constraint + p.message}>{p.message}</li>
          ))}
        </ul>
      ) : null}

      <button
        className="btn-primary build-submit"
        disabled={!legal || busy}
        onClick={() => void submit()}
      >
        {busy ? "Building…" : `Confirm squad for ${state.activeRound.name}`}
      </button>
      {!legal && pickedPlayers.length > 0 ? (
        <p className="table-foot-note">
          The button stays disabled while the squad is illegal, and the reasons are
          listed above. The database enforces the same rules independently — a squad
          that got past this screen would still be refused (G15).
        </p>
      ) : null}

      <PoolPicker
        pool={state.pool}
        selectedIds={picked}
        onToggle={toggle}
        blockFor={(p) => {
          if (state.midMatchLocked.has(p.id)) {
            return { blocked: true, reason: "🔒 match in progress — cannot be bought (D7/G6)" };
          }
          if (picked.size >= squad.teamSize) {
            return { blocked: true, reason: `Squad is already ${squad.teamSize} players.` };
          }
          if ((p.priceEnteringRound ?? 0) > capLeft) {
            return { blocked: true, reason: "Not enough cap remaining." };
          }
          return { blocked: false, reason: null };
        }}
      />
    </div>
  );
}
