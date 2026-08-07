import { useMemo, useState } from "react";
import type { PlayerRole } from "../../../src/config/types";
import { money } from "../../lib/format";
import { PriceMovement } from "../PriceMovement";
import { RoleBadge } from "../RoleBadge";
import { ROLE_ORDER } from "../../lib/squad";
import type { PoolPlayer } from "../../lib/teamQueries";
import type { HoldingView } from "../../lib/useTeamState";
import { BlockedReason } from "./TeamChrome";

/**
 * THE SQUAD (holdings). There is no bench and no emergency mechanic (operator
 * ruling): the round's selection IS the holdings, so this table is both "who you
 * own" and "who you field". Purchase price comes from the ledger; current price
 * is the price entering the open round (Rider 2); movement is the last recorded
 * step.
 */
export function SquadTable({
  holdings,
  captainId,
  viceCaptainId,
  onSetCaptain,
  onSetViceCaptain,
  captaincyDisabledReason,
}: {
  holdings: HoldingView[];
  captainId: string | null;
  viceCaptainId: string | null;
  onSetCaptain: (playerId: string) => void;
  onSetViceCaptain: (playerId: string) => void;
  captaincyDisabledReason: string | null;
}) {
  return (
    <div className="card table-card">
      <table className="table squad-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Role</th>
            <th className="col-num">Bought</th>
            <th className="col-num">Current</th>
            {/* Named precisely: this is gain/loss against the PURCHASE price, not
                the last price step shown on the player list (Standing Rule 2). */}
            <th className="col-num">Since bought</th>
            <th className="col-cap">C</th>
            <th className="col-cap">VC</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const gain =
              h.currentPrice !== null ? h.currentPrice - h.purchasePrice : 0;
            return (
              <tr key={h.playerId} className={h.midMatchLocked ? "row-locked" : undefined}>
                <td className="team-name">
                  <span className="squad-player">
                    {h.player?.display_name ?? "—"}
                    {h.midMatchLocked ? (
                      <BlockedReason>
                        <span aria-hidden="true">🔒</span> match in progress
                      </BlockedReason>
                    ) : null}
                  </span>
                </td>
                <td>
                  {h.player ? (
                    <RoleBadge role={h.player.role} wkEligible={h.player.wk_eligible} />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-num num">{money(h.purchasePrice)}</td>
                <td className="col-num num">{money(h.currentPrice)}</td>
                <td className="col-num num">
                  <PriceMovement delta={gain} />
                </td>
                <td className="col-cap">
                  <input
                    type="radio"
                    name="captain"
                    aria-label={`Captain: ${h.player?.display_name ?? h.playerId}`}
                    checked={captainId === h.playerId}
                    disabled={captaincyDisabledReason !== null}
                    onChange={() => onSetCaptain(h.playerId)}
                  />
                </td>
                <td className="col-cap">
                  <input
                    type="radio"
                    name="vice-captain"
                    aria-label={`Vice-captain: ${h.player?.display_name ?? h.playerId}`}
                    checked={viceCaptainId === h.playerId}
                    disabled={captaincyDisabledReason !== null || captainId === h.playerId}
                    onChange={() => onSetViceCaptain(h.playerId)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {captaincyDisabledReason ? (
        <p className="table-foot-note">{captaincyDisabledReason}</p>
      ) : (
        <p className="table-foot-note">
          Captain scores double; the vice-captain inherits if the captain does not
          play. Both absent means nobody is doubled (D10). Captaincy carries forward
          to the next round unless you change it.
        </p>
      )}
    </div>
  );
}

export interface PickerBlock {
  blocked: boolean;
  reason: string | null;
}

/**
 * The pool, filterable by role and searchable, with every unavailable player
 * carrying its reason on the row. Used for the initial build and for choosing a
 * trade-in.
 */
export function PoolPicker({
  pool,
  selectedIds,
  onToggle,
  blockFor,
  emptyLabel = "No players in the pool.",
  mode = "multi",
}: {
  pool: PoolPlayer[];
  selectedIds: Set<string>;
  onToggle: (playerId: string) => void;
  blockFor: (player: PoolPlayer) => PickerBlock;
  emptyLabel?: string;
  mode?: "multi" | "single";
}) {
  const [role, setRole] = useState<PlayerRole | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return pool.filter(
      (p) =>
        (role === "ALL" || p.role === role) &&
        (needle === "" || p.display_name.toLowerCase().includes(needle)),
    );
  }, [pool, role, search]);

  return (
    <div className="picker">
      <div className="picker-controls">
        <div className="picker-roles" role="group" aria-label="Filter by role">
          {(["ALL", ...ROLE_ORDER] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`picker-role${role === r ? " picker-role-active" : ""}`}
              onClick={() => setRole(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          className="picker-search"
          type="search"
          placeholder="Search players"
          value={search}
          aria-label="Search players"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="round-empty">{emptyLabel}</p>
      ) : (
        <ul className="picker-list">
          {shown.map((p) => {
            const selected = selectedIds.has(p.id);
            const block = blockFor(p);
            const disabled = block.blocked && !selected;
            return (
              <li
                key={p.id}
                className={`picker-item${selected ? " picker-item-selected" : ""}${
                  disabled ? " picker-item-blocked" : ""
                }`}
              >
                <button
                  type="button"
                  className="picker-button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => onToggle(p.id)}
                >
                  <span className="picker-name">{p.display_name}</span>
                  <RoleBadge role={p.role} wkEligible={p.wk_eligible} />
                  <span className="picker-price num">{money(p.priceEnteringRound)}</span>
                  <PriceMovement delta={p.movement} showValue={false} />
                  <span className="picker-mark" aria-hidden="true">
                    {selected ? "✓" : mode === "single" ? "" : "+"}
                  </span>
                </button>
                {disabled && block.reason ? (
                  <BlockedReason>{block.reason}</BlockedReason>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
