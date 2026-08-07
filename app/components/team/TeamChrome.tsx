import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { SquadConfig } from "../../../src/config/types";
import { money, dateTime } from "../../lib/format";
import type { Refusal } from "../../lib/teamMutations";
import {
  compositionProgress,
  flexSlots,
  type RoleCarrier,
  type TradeBudget,
} from "../../lib/squad";
import type { RoundBasic } from "../../lib/teamQueries";

/** Tabs for the team area. Trades live INSIDE /team rather than beside it. */
export function TeamTabs() {
  return (
    <nav className="team-tabs" aria-label="Team sections">
      <NavLink
        to="/team"
        end
        className={({ isActive }) => `team-tab${isActive ? " team-tab-active" : ""}`}
      >
        Squad
      </NavLink>
      <NavLink
        to="/team/trades"
        className={({ isActive }) => `team-tab${isActive ? " team-tab-active" : ""}`}
      >
        Trades
      </NavLink>
    </nav>
  );
}

/**
 * CAP DISPLAY (C3, D8 as amended by A2). The three figures are labelled
 * separately and deliberately — Gate G2 is the authority, and it is the reason
 * TEAM VALUE and INVESTED VALUE must never share a label:
 *
 *   cap remaining  = starting cap − Σ purchase prices + Σ sale proceeds
 *   invested value = Σ CURRENT prices of holdings, alone
 *   team value     = cap remaining + invested value
 *
 * A price rise while held moves team value and invested value; it never moves
 * the cap.
 */
export function CapStrip({
  cap,
  capRemaining,
  investedValue,
  teamValue,
}: {
  cap: number;
  capRemaining: number;
  investedValue: number;
  teamValue: number;
}) {
  const over = capRemaining < 0;
  return (
    <div className="cap-strip" aria-label="Cap position">
      <div className={`cap-cell${over ? " cap-cell-over" : ""}`}>
        <span className="cap-label">Cap remaining</span>
        <span className="cap-figure num">{money(capRemaining)}</span>
        <span className="cap-note">of {money(cap)} salary cap</span>
      </div>
      <div className="cap-cell">
        <span className="cap-label">Team value</span>
        <span className="cap-figure num">{money(teamValue)}</span>
        <span className="cap-note">cap remaining + current prices</span>
      </div>
      <div className="cap-cell">
        <span className="cap-label">Invested value</span>
        <span className="cap-figure num">{money(investedValue)}</span>
        <span className="cap-note">current prices of holdings only</span>
      </div>
    </div>
  );
}

/**
 * Composition progress against the CONFIG minimums (O2). Nothing here knows what
 * the numbers are: team size, every role minimum and the flex remainder are read
 * from the season config, so changing the config row changes this display with
 * no code change (the G11 discipline, applied to the UI).
 */
export function CompositionMeter({
  players,
  squad,
}: {
  players: RoleCarrier[];
  squad: SquadConfig;
}) {
  const rows = compositionProgress(players, squad);
  const flex = flexSlots(squad);
  const sizeMet = players.length === squad.teamSize;
  return (
    <div className="composition" aria-label="Squad composition">
      <div className={`comp-chip${sizeMet ? " comp-met" : ""}`}>
        <span className="comp-role">SIZE</span>
        <span className="comp-count num">
          {players.length}/{squad.teamSize}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.role} className={`comp-chip${r.met ? " comp-met" : ""}`}>
          <span className="comp-role">{r.role}</span>
          <span className="comp-count num">
            {r.count}/{r.minimum}
          </span>
        </div>
      ))}
      <div className="comp-chip comp-flex">
        <span className="comp-role">FLEX</span>
        <span className="comp-count num">{flex}</span>
      </div>
    </div>
  );
}

/**
 * ROUND LOCK STATE, VISIBLY (D6/G4). The UI must explain WHY an action is
 * unavailable — never disable silently. The lock time is read PER ROUND from the
 * row; there is no global lock and no hardcoded Saturday.
 */
export function LockNotice({
  activeRound,
  allRoundsLocked,
}: {
  activeRound: RoundBasic | null;
  allRoundsLocked: boolean;
}) {
  if (allRoundsLocked) {
    return (
      <div className="lock-notice lock-closed" role="status">
        <strong>Every round has locked.</strong> Team changes and trades are refused —
        the database rejects any write against a locked round (D6/G4), not just this
        screen.
      </div>
    );
  }
  if (!activeRound) {
    return (
      <div className="lock-notice" role="status">
        No open round yet. Changes become possible once a round with a future lock time
        exists.
      </div>
    );
  }
  return (
    <div className="lock-notice lock-open" role="status">
      Changes apply to <strong>{activeRound.name}</strong>, which locks{" "}
      <strong>{dateTime(activeRound.lock_at)}</strong>. After that moment every team
      change and trade for this round is refused server-side (D6/G4).
    </div>
  );
}

/** Trades used / remaining for the round, from config (O1). */
export function TradeBudgetNotice({ budget }: { budget: TradeBudget }) {
  if (budget.initialBuild) {
    return (
      <div className="trade-budget trade-budget-initial">
        <strong>Initial squad construction.</strong> You held nothing entering this
        round, so buys made in it are founding buys and consume{" "}
        <strong>zero trades</strong> (G15) — including changes of mind while you build.
        They are still bound by team size, composition and the salary cap, and by this
        round&rsquo;s lock.
      </div>
    );
  }
  return (
    <div className="trade-budget">
      <span>
        Trades this round: <strong className="num">{budget.used}</strong> used ·{" "}
        <strong className="num">{budget.remaining}</strong> remaining of{" "}
        <strong className="num">{budget.limit}</strong>
      </span>
    </div>
  );
}

/** A rejection, with the failing constraint named AND the server's own words. */
export function RefusalNotice({ refusal }: { refusal: Refusal }) {
  return (
    <div className="refusal" role="alert">
      <strong className="refusal-reason">{refusal.reason}</strong>
      <span className="refusal-authority">{refusal.authority}</span>
      <details className="refusal-detail">
        <summary>Server response</summary>
        <code>{refusal.serverMessage}</code>
      </details>
    </div>
  );
}

/** A blocked action explained inline — the padlock never stands on its own. */
export function BlockedReason({ children }: { children: ReactNode }) {
  return <span className="blocked-reason">{children}</span>;
}

/**
 * PRICE-ENTERING-ROUND footnote (Rider 2). Shown only when the price a trade
 * must be struck at differs from the most recent price on record — which happens
 * once a round contains a finalised match while that round is still open.
 */
export function PriceBasisNote({
  roundName,
  divergent,
}: {
  roundName: string;
  divergent: boolean;
}) {
  if (!divergent) return null;
  return (
    <p className="price-basis" role="note">
      Prices shown are the prices <strong>entering {roundName}</strong>. A movement has
      already been recorded inside this round, so the most recent price on record
      differs — trades are struck, and validated, at the entering-round price.
    </p>
  );
}
