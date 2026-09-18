import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { PlayerRole } from "../../../src/config/types";
import { money } from "../../lib/format";
import { PriceMovement } from "../PriceMovement";
import { RoleBadge } from "../RoleBadge";
import { PlayerAvatar } from "../PlayerAvatar";
import { PlayerAvailabilityDot } from "../PlayerAvailabilityDot";
import type { PlayerAvailabilityStatus } from "../../lib/playerAvailability";
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
  availability,
}: {
  holdings: HoldingView[];
  captainId: string | null;
  viceCaptainId: string | null;
  onSetCaptain: (playerId: string) => void;
  onSetViceCaptain: (playerId: string) => void;
  captaincyDisabledReason: string | null;
  availability: Map<string, PlayerAvailabilityStatus>;
}) {
  const location = useLocation();
  const squadRoleOrder: PlayerRole[] = ["BAT", "WK", "AR", "BWL"];
  const sortedHoldings = useMemo(
    () =>
      [...holdings].sort((a, b) => {
        const aRole = a.player?.role;
        const bRole = b.player?.role;
        const roleDifference =
          (aRole ? squadRoleOrder.indexOf(aRole) : squadRoleOrder.length) -
          (bRole ? squadRoleOrder.indexOf(bRole) : squadRoleOrder.length);
        if (roleDifference !== 0) return roleDifference;

        const priceDifference = (b.currentPrice ?? 0) - (a.currentPrice ?? 0);
        if (priceDifference !== 0) return priceDifference;

        return (a.player?.display_name ?? "").localeCompare(
          b.player?.display_name ?? "",
        );
      }),
    [holdings],
  );

  return (
    <div className="card table-card">
      <table className="table squad-table">
        <colgroup>
          <col className="squad-photo-column" />
          <col className="squad-player-column" />
          <col className="squad-role-column" />
          <col className="squad-money-column" />
          <col className="squad-money-column" />
          <col className="squad-change-column" />
          <col className="squad-captain-column" />
        </colgroup>
        <thead>
          <tr>
            <th className="squad-photo-col" aria-label="Player photo" />
            <th>Player</th>
            <th className="squad-role-col">Role</th>
            <th className="squad-money-cell">
              <span className="squad-money-content">Bought</span>
            </th>
            <th className="squad-money-cell">
              <span className="squad-money-content">Current</span>
            </th>
            {/* Named precisely: this is gain/loss against the PURCHASE price, not
                the last price step shown on the player list (Standing Rule 2). */}
            <th className="col-num squad-price-change">Price Change</th>
            <th className="col-captain-select">
              CAPTAIN (<strong>2x</strong>)
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedHoldings.map((h) => {
            const gain =
              h.currentPrice !== null ? h.currentPrice - h.purchasePrice : 0;
            return (
              <tr key={h.playerId} className={h.midMatchLocked ? "row-locked" : undefined}>
                <td className="squad-photo-col">
                  {h.player ? (
                    <PlayerAvatar
                      name={h.player.display_name}
                      size={40}
                      photoUrl={h.player.photo_url}
                    />
                  ) : null}
                </td>
                <td className="team-name">
                  <span className="squad-player">
                    <span className="squad-player-name-row">
                      {h.player ? (
                        <Link
                          to={`/players/${h.player.id}`}
                          state={{ backgroundLocation: location }}
                          className="squad-player-link"
                        >
                          {h.player.display_name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      <PlayerAvailabilityDot status={availability.get(h.playerId)} />
                    </span>
                    {h.midMatchLocked ? (
                      <BlockedReason>
                        <span aria-hidden="true">🔒</span> match in progress
                      </BlockedReason>
                    ) : null}
                  </span>
                </td>
                <td className="squad-role-col">
                  {h.player ? (
                    <RoleBadge role={h.player.role} wkEligible={h.player.wk_eligible} />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="squad-money-cell num">
                  <span className="squad-money-content">{money(h.purchasePrice)}</span>
                </td>
                <td className="squad-money-cell num">
                  <span className="squad-money-content">{money(h.currentPrice)}</span>
                </td>
                <td className="col-num num squad-price-change">
                  <PriceMovement delta={gain} />
                </td>
                <td className="col-captain-select">
                  <div
                    className="captain-selector"
                    role="group"
                    aria-label={`Captaincy for ${h.player?.display_name ?? h.playerId}`}
                  >
                    <button
                      type="button"
                      className={`captain-choice${
                        captainId === h.playerId ? " captain-choice-active" : ""
                      }`}
                      aria-pressed={captainId === h.playerId}
                      disabled={captaincyDisabledReason !== null}
                      onClick={() => onSetCaptain(h.playerId)}
                    >
                      CAPT
                    </button>
                    <button
                      type="button"
                      className={`captain-choice${
                        viceCaptainId === h.playerId ? " captain-choice-active" : ""
                      }`}
                      aria-pressed={viceCaptainId === h.playerId}
                      disabled={captaincyDisabledReason !== null || captainId === h.playerId}
                      onClick={() => onSetViceCaptain(h.playerId)}
                    >
                      VICE
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {captaincyDisabledReason ? (
        <p className="table-foot-note">{captaincyDisabledReason}</p>
      ) : null}
    </div>
  );
}

export interface PickerBlock {
  blocked: boolean;
  reason: string | null;
  priceUnavailable?: boolean;
}

export type RoleFilter = PlayerRole | "ALL";

export function PickerRoleFilters({
  value,
  onChange,
}: {
  value: RoleFilter;
  onChange: (role: RoleFilter) => void;
}) {
  return (
    <div className="picker-roles" role="group" aria-label="Filter by role">
      {(["ALL", ...ROLE_ORDER] as const).map((role) => (
        <button
          key={role}
          type="button"
          className={`picker-role${value === role ? " picker-role-active" : ""}`}
          onClick={() => onChange(role)}
        >
          {role}
        </button>
      ))}
    </div>
  );
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
  roleFilter,
  onRoleFilterChange,
  showRoleFilters = true,
  showSearch = true,
  availability = new Map<string, PlayerAvailabilityStatus>(),
}: {
  pool: PoolPlayer[];
  selectedIds: Set<string>;
  onToggle: (playerId: string) => void;
  blockFor: (player: PoolPlayer) => PickerBlock;
  emptyLabel?: string;
  mode?: "multi" | "single";
  roleFilter?: RoleFilter;
  onRoleFilterChange?: (role: RoleFilter) => void;
  showRoleFilters?: boolean;
  showSearch?: boolean;
  availability?: Map<string, PlayerAvailabilityStatus>;
}) {
  const [internalRole, setInternalRole] = useState<RoleFilter>("ALL");
  const [search, setSearch] = useState("");
  const role = roleFilter ?? internalRole;
  const setRole = onRoleFilterChange ?? setInternalRole;

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
      {showRoleFilters || showSearch ? (
        <div className="picker-controls">
          {showRoleFilters ? <PickerRoleFilters value={role} onChange={setRole} /> : null}
          {showSearch ? (
            <input
              className="picker-search"
              type="search"
              placeholder="Search players"
              value={search}
              aria-label="Search players"
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : null}
        </div>
      ) : null}

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
                  <span className="picker-name">
                    {p.display_name} <PlayerAvailabilityDot status={availability.get(p.id)} />
                  </span>
                  <RoleBadge role={p.role} wkEligible={p.wk_eligible} />
                  <span
                    className={`picker-price num${
                      block.priceUnavailable ? " picker-price-unavailable" : ""
                    }`}
                  >
                    {money(p.priceEnteringRound)}
                  </span>
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
