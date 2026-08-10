import type { LeagueConfig, PlayerRole } from "../../src/config/types";

/**
 * SEASON-LOCK SUPPORT — the pure half of /admin/settings.
 *
 * Three disciplines this file exists to hold:
 *
 *   G11 — NO ECONOMY CONSTANTS. Every descriptor below names a config PARAMETER
 *   and cites the decision that governs it; not one carries a VALUE. Values are
 *   read from `seasons.config` and written back to it. Change the season row and
 *   the settings page changes with it, with no code change. The proof is
 *   mechanical: `test/settings-ui.config-driven.test.ts` walks LeagueConfig's own
 *   leaves and fails if any of them lacks a descriptor here, so a config key
 *   added later cannot quietly become un-editable.
 *
 *   D16 — THE DATABASE IS THE GATEKEEPER. Nothing here decides anything. The
 *   validation is so the operator sees a problem before the round-trip; the
 *   refusals that count are 0002/0008's triggers. Where the two could disagree
 *   the database is right and this file is the bug.
 *
 *   ANTI-DRIFT ON THE CAP. There is deliberately NO cap arithmetic in this file.
 *   The rehearsal preview's numbers come from `public.season_lock_preview()`,
 *   which calls the very functions the lock trigger calls (0008). A TypeScript
 *   mirror of the O3 mean and the D4 rounding would be a second implementation to
 *   keep honest; the point of the preview is that there isn't one.
 */

// ---------------------------------------------------------------------------
// Config field descriptors
// ---------------------------------------------------------------------------

/** How a value is rendered and validated. No value lives in the kind. */
export type FieldKind =
  | "money" // integer dollars
  | "points" // integer fantasy points
  | "count" // integer count (players, trades, games)
  | "rate" // 0..1 weight
  | "ratio"; // an unbounded non-negative decimal (economy, strike rate)

export interface ConfigField {
  /** Path into LeagueConfig, e.g. ["pricing", "alpha"]. */
  path: readonly string[];
  label: string;
  /** Decision / open-item this parameter answers to (Standing Rule 2). */
  decision: string;
  kind: FieldKind;
  /** Shown under the input — what the parameter MEANS, never what it is set to. */
  hint?: string;
  /**
   * True for values the SEASON LOCK computes rather than the operator typing
   * (O3's cap). Rendered read-only, with the preview's figure beside it.
   */
  computedAtLock?: boolean;
}

export const ROLES: readonly PlayerRole[] = ["BAT", "WK", "BWL", "AR"] as const;

/** Every leaf of ScoringConfig, in the order the entry form reads best. */
const SCORING_FIELDS: ConfigField[] = [
  { path: ["scoring", "perRun"], label: "Per run", decision: "O4", kind: "points" },
  { path: ["scoring", "perFour"], label: "Per four", decision: "O4", kind: "points", hint: "on top of the runs" },
  { path: ["scoring", "perSix"], label: "Per six", decision: "O4", kind: "points", hint: "on top of the runs" },
  { path: ["scoring", "perWicket"], label: "Per wicket", decision: "O4", kind: "points" },
  { path: ["scoring", "perCatch"], label: "Outfield catch", decision: "O4", kind: "points" },
  { path: ["scoring", "perKeeperCatch"], label: "Keeper catch", decision: "O4", kind: "points" },
  { path: ["scoring", "perStumping"], label: "Stumping", decision: "O4", kind: "points" },
  { path: ["scoring", "perRunOutUnassisted"], label: "Run out (unassisted)", decision: "O4", kind: "points" },
  { path: ["scoring", "perRunOutAssisted"], label: "Run out (assisted)", decision: "O4", kind: "points", hint: "credited to each participant" },
  { path: ["scoring", "srBonusPoints"], label: "Strike-rate bonus", decision: "O5", kind: "points", hint: "O5 superseded by O4 — held at zero in the season config" },
  { path: ["scoring", "srBonusMinStrikeRate"], label: "SR bonus threshold", decision: "O5", kind: "ratio" },
  { path: ["scoring", "srBonusMinBalls"], label: "SR bonus min balls", decision: "O5", kind: "count" },
  { path: ["scoring", "econBonusPoints"], label: "Economy bonus", decision: "O5", kind: "points" },
  { path: ["scoring", "econBonusMaxEconomy"], label: "Economy bonus threshold", decision: "O5", kind: "ratio" },
  { path: ["scoring", "econBonusMinOvers"], label: "Economy bonus min overs", decision: "O5", kind: "count" },
];

const PRICING_FIELDS: ConfigField[] = [
  { path: ["pricing", "alpha"], label: "α (EMA weight on the latest match)", decision: "D1/O7", kind: "rate" },
  { path: ["pricing", "dollarsPerPoint"], label: "$ per fantasy point", decision: "D1", kind: "money" },
  { path: ["pricing", "floor"], label: "Price floor", decision: "D1/O6", kind: "money", hint: "no price ever sits below this" },
  { path: ["pricing", "roundingIncrement"], label: "Rounding increment", decision: "D4", kind: "money", hint: "all price arithmetic rounds to this, halves up — including the cap" },
  { path: ["pricing", "startingPriceGamesCap"], label: "Starting-price games cap", decision: "D4/A1", kind: "count", hint: "g caps here in floor + (min(g,cap)/cap) × (perf − floor)" },
];

const SQUAD_FIELDS: ConfigField[] = [
  { path: ["squad", "teamSize"], label: "Team size", decision: "O2", kind: "count", hint: "also the cap multiplier: cap = team size × mean starting price" },
  ...ROLES.map(
    (role): ConfigField => ({
      path: ["squad", "roleMinimums", role],
      label: `Minimum ${role}`,
      decision: "O2/A7",
      kind: "count",
      hint: "strict counting — a player fills only its own role's minimum",
    }),
  ),
  {
    path: ["squad", "cap"],
    label: "Salary cap",
    decision: "O3",
    kind: "money",
    computedAtLock: true,
    hint: "computed BY the lock as team size × mean starting price, 1.0× with no headroom — never typed in",
  },
  { path: ["squad", "tradesPerRound"], label: "Trades per round", decision: "O1", kind: "count" },
];

export interface ConfigGroup {
  key: keyof LeagueConfig;
  title: string;
  blurb: string;
  fields: ConfigField[];
}

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    key: "squad",
    title: "Team, cap and trades",
    blurb:
      "Team size and role minimums are O2's contingency table — pick the row for the number of club teams entered. Σ minimums must fit inside the team; the remainder is flex, the only wildcard slot.",
    fields: SQUAD_FIELDS,
  },
  {
    key: "pricing",
    title: "Pricing",
    blurb:
      "The D1 movement is new = (1−α)·old + α·(match score × $/pt), rounded to the increment and floored. α and the floor are flagged revisitable pre-lock (O6/O7).",
    fields: PRICING_FIELDS,
  },
  {
    key: "scoring",
    title: "Scoring",
    blurb:
      "One frozen rule set per season, no mid-season changes and no effective-date versioning (D12).",
    fields: SCORING_FIELDS,
  },
];

export const CONFIG_FIELDS: ConfigField[] = CONFIG_GROUPS.flatMap((g) => g.fields);

export const fieldPathKey = (path: readonly string[]): string => path.join(".");

// ---------------------------------------------------------------------------
// Reading and writing values by path
// ---------------------------------------------------------------------------

/** Read a leaf. Returns undefined for a path the config does not carry. */
export function getConfigValue(
  config: LeagueConfig,
  path: readonly string[],
): number | undefined {
  let node: unknown = config;
  for (const step of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[step];
  }
  return typeof node === "number" ? node : undefined;
}

/**
 * Write a leaf, returning a NEW config. Structurally shared clones only along the
 * touched path — the caller holds a draft, and the season row is only written
 * when the operator saves.
 */
export function setConfigValue(
  config: LeagueConfig,
  path: readonly string[],
  value: number,
): LeagueConfig {
  if (path.length === 0) return config;
  const [head, ...rest] = path as [string, ...string[]];
  const clone: Record<string, unknown> = { ...(config as unknown as Record<string, unknown>) };
  if (rest.length === 0) {
    clone[head] = value;
  } else {
    const child = clone[head];
    clone[head] = setConfigValue(
      (child ?? {}) as unknown as LeagueConfig,
      rest,
      value,
    ) as unknown;
  }
  return clone as unknown as LeagueConfig;
}

/** Every leaf path present in a config object, as dotted keys. Depth-first. */
export function configLeafPaths(value: unknown, prefix: readonly string[] = []): string[] {
  if (typeof value === "number") return [prefix.join(".")];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    configLeafPaths(v, [...prefix, k]),
  );
}

// ---------------------------------------------------------------------------
// Pre-flight validation (courtesy only — see D16 note at the top)
// ---------------------------------------------------------------------------

export interface ConfigProblem {
  /** Dotted path, or "" for a whole-config invariant. */
  path: string;
  message: string;
}

const isInt = (n: number) => Number.isInteger(n);

/**
 * What the operator should know BEFORE saving. Two kinds:
 *   * shape — a value that cannot be what it is (negative team size, α outside
 *     0..1, a non-integer count)
 *   * cross-field — Σ role minimums must fit inside teamSize, or 0003's
 *     composition guard fails loudly later, at a participant's first save
 *     rather than at the operator's.
 */
export function validateConfig(config: LeagueConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  for (const field of CONFIG_FIELDS) {
    const key = fieldPathKey(field.path);
    const value = getConfigValue(config, field.path);
    if (value === undefined || !Number.isFinite(value)) {
      problems.push({ path: key, message: `${field.label} must be a number` });
      continue;
    }
    if (value < 0) {
      problems.push({ path: key, message: `${field.label} cannot be negative` });
      continue;
    }
    if ((field.kind === "count" || field.kind === "money" || field.kind === "points") && !isInt(value)) {
      problems.push({ path: key, message: `${field.label} must be a whole number` });
    }
    if (field.kind === "rate" && value > 1) {
      problems.push({ path: key, message: `${field.label} is a weight between 0 and 1` });
    }
  }

  const squad = config.squad;
  if (squad) {
    const teamSize = getConfigValue(config, ["squad", "teamSize"]);
    const total = totalRoleMinimums(config);
    if (teamSize !== undefined && total > teamSize) {
      problems.push({
        path: "squad.roleMinimums",
        message: `role minimums total ${total}, which does not fit inside a team of ${teamSize} (O2/A7). Flex is what is left over, so it cannot be negative.`,
      });
    }
    if (teamSize !== undefined && teamSize < 1) {
      problems.push({ path: "squad.teamSize", message: "a team needs at least one player" });
    }
    const increment = getConfigValue(config, ["pricing", "roundingIncrement"]);
    if (increment !== undefined && increment <= 0) {
      problems.push({
        path: "pricing.roundingIncrement",
        message: "the rounding increment must be positive — the cap is rounded to it (D4)",
      });
    }
  }

  return problems;
}

export function totalRoleMinimums(config: LeagueConfig): number {
  return ROLES.reduce(
    (sum, role) => sum + (getConfigValue(config, ["squad", "roleMinimums", role]) ?? 0),
    0,
  );
}

export function flexSlots(config: LeagueConfig): number {
  return (getConfigValue(config, ["squad", "teamSize"]) ?? 0) - totalRoleMinimums(config);
}

// ---------------------------------------------------------------------------
// What the lock freezes, and where the refusal lives
// ---------------------------------------------------------------------------

/**
 * The categories the season lock freezes (KICKOFF §SEASON LOCK, D13, D21). Each
 * names the table the freeze acts on and the trigger that enforces it, so the
 * settings page can show the operator what is about to become immutable and the
 * gate suite can prove one refusal per category against a direct authenticated
 * write. `test/g10.season-lock-action.test.ts` iterates this list — a category
 * added here without a proof fails that test.
 */
export interface LockCategory {
  key: string;
  label: string;
  decision: string;
  /** Where the frozen value lives. */
  target: string;
  /** The trigger that refuses the post-lock write. */
  enforcedBy: string;
}

export const LOCK_CATEGORIES: LockCategory[] = [
  { key: "league-settings", label: "League settings (team size, role minimums)", decision: "D13/O2", target: "seasons.config", enforcedBy: "trg_seasons_lock" },
  { key: "scoring", label: "Scoring rules", decision: "D12/O4", target: "seasons.config", enforcedBy: "trg_seasons_lock" },
  { key: "starting-prices", label: "Starting prices", decision: "D4", target: "players.starting_price", enforcedBy: "trg_players_lock" },
  { key: "roles", label: "Player roles", decision: "D9", target: "players.role", enforcedBy: "trg_players_lock" },
  { key: "wk-eligible", label: "WK-eligible flags", decision: "D9", target: "players.wk_eligible", enforcedBy: "trg_players_lock" },
  { key: "alpha", label: "α", decision: "D1/O7", target: "seasons.config", enforcedBy: "trg_seasons_lock" },
  { key: "floor", label: "Price floor", decision: "D1/O6", target: "seasons.config", enforcedBy: "trg_seasons_lock" },
  { key: "dollars-per-point", label: "$ per point", decision: "D1", target: "seasons.config", enforcedBy: "trg_seasons_lock" },
  { key: "trades-per-round", label: "Trades per round", decision: "O1", target: "seasons.config", enforcedBy: "trg_seasons_lock" },
  { key: "team-registration", label: "Fantasy-team registration", decision: "D21", target: "fantasy_teams", enforcedBy: "trg_fantasy_teams_registration_lock" },
];

/**
 * The predicates that disable controls once the season is locked, one per
 * category. The UI reads these; the database enforces the same thing
 * independently (D16), and the gate suite proves both halves.
 */
export const isConfigEditable = (lockedAt: string | null): boolean => lockedAt === null;
export const isPlayerEconomyEditable = (lockedAt: string | null): boolean => lockedAt === null;
export const isRegistrationOpen = (lockedAt: string | null): boolean => lockedAt === null;
export const isPoolRemovalAllowed = (lockedAt: string | null): boolean => lockedAt === null;

/** Which categories a given lock state has frozen. Empty pre-lock. */
export function frozenCategories(lockedAt: string | null): LockCategory[] {
  return lockedAt === null ? [] : LOCK_CATEGORIES;
}

// ---------------------------------------------------------------------------
// Arming the one-way door
// ---------------------------------------------------------------------------

/**
 * The lock is one-way and has no undo, so the confirmation must not be
 * click-through-able (kickoff, verbatim: "no 'are you sure' that can be clicked
 * past casually"). The operator types the season's name. Compared on trimmed,
 * case-folded text — this is a speed bump against reflex, not a password.
 */
export function isArmed(typed: string, seasonName: string): boolean {
  return typed.trim().toLocaleLowerCase() === seasonName.trim().toLocaleLowerCase();
}
