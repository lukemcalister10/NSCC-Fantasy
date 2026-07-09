import type { PlayerRole } from "../../src/config/types";
import { ROLE_LABEL } from "../lib/format";

/**
 * Role badge (BAT / WK / BWL / AR), one role per player per season (D9). A
 * `wk_eligible` non-WK shows a small "wk" hint — the only dual eligibility.
 */
export function RoleBadge({
  role,
  wkEligible = false,
}: {
  role: PlayerRole;
  wkEligible?: boolean;
}) {
  return (
    <span className={`role-badge role-${role.toLowerCase()}`}>
      {ROLE_LABEL[role]}
      {wkEligible && role !== "WK" ? <em className="role-wk-hint">wk</em> : null}
    </span>
  );
}
