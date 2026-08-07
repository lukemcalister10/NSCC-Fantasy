import { parseDismissal } from "../../src/engines/dismissal";
import { resolveName, normaliseName } from "../../src/registry/nameNormalisation";

/**
 * DISMISSAL ENTRY — turning what the operator types into what the engine scores.
 *
 * D25 (DECISION_LOG v1.9): "fielders named in dismissal strings are identified by
 * the SAME canonical player identifier used for batting and bowling lines,
 * resolved at entry time (D22 normalise → registry lookup). An unresolved fielder
 * name BLOCKS the commit and is never guessed (G12 discipline). If a scorecard
 * genuinely does not name the catcher, no fielding credit is awarded."
 *
 * That is exactly what this module does, and it is forced by the engine: a
 * fielder is credited only when the token parsed out of the dismissal string is a
 * member of the lineup, and the lineup is a set of player IDs.
 *
 * What gets stored (migration 0006):
 *   resolved_text — canonical, engine-facing, ids in the fielder positions
 *   source_text   — exactly what the operator typed, kept for audit (D22)
 *
 * The BOWLER token is deliberately dropped from the canonical form (a literal
 * "-"): bowler wickets come from the bowling figures, never from the dismissal
 * string, so carrying a second, parallel record of who bowled would be a second
 * source of truth. The operator's own text keeps it verbatim in source_text.
 */

export type DismissalKind =
  | "caught"
  | "caught_and_bowled"
  | "stumped"
  | "run_out"
  | "run_out_assisted"
  | "no_credit";

export const DISMISSAL_LABEL: Record<DismissalKind, string> = {
  caught: "Caught",
  caught_and_bowled: "Caught & bowled",
  stumped: "Stumped",
  run_out: "Run out",
  run_out_assisted: "Run out (assisted)",
  no_credit: "Bowled / LBW / other (no fielding credit)",
};

export interface RegistryEntry {
  id: string;
  displayName: string;
}

/** Build the canonical engine-facing string from a kind + resolved fielder ids. */
export function buildResolvedText(kind: DismissalKind, fielderIds: string[]): string {
  const ids = fielderIds.filter((id) => id !== "");
  switch (kind) {
    case "caught":
    case "caught_and_bowled":
      return ids[0] ? `c ${ids[0]} b -` : "b -";
    case "stumped":
      return ids[0] ? `st ${ids[0]} b -` : "b -";
    case "run_out":
      return ids[0] ? `run out (${ids[0]})` : "b -";
    case "run_out_assisted":
      return ids.length > 1 ? `run out (${ids.join("/")})` : ids[0] ? `run out (${ids[0]})` : "b -";
    case "no_credit":
      return "b -";
  }
}

export interface ParsedDismissal {
  kind: DismissalKind;
  /** Resolved registry ids, in the order they appeared. */
  fielderIds: string[];
  /** Names the registry could not resolve — the save is blocked until these go. */
  unresolved: string[];
  /** Canonical engine-facing string (only meaningful when `unresolved` is empty). */
  resolvedText: string;
}

/**
 * Parse a typed dismissal ("c Sam Hollis b Tomas Reiner") and resolve its fielders
 * against the registry. Uses the SAME engine parser that scores the stored string,
 * so what the operator is shown at entry is what will be credited — no second
 * grammar, no divergence.
 *
 * `registry` should be the MATCH LINEUP, not the whole pool: a fielding credit can
 * only go to someone who played, and narrowing it here turns a typo into an
 * "unresolved name" prompt rather than a silent credit to a namesake.
 */
export function parseTypedDismissal(
  text: string,
  registry: readonly RegistryEntry[],
): ParsedDismissal {
  const credits = parseDismissal(normaliseName(text));
  if (credits.length === 0) {
    return { kind: "no_credit", fielderIds: [], unresolved: [], resolvedText: "b -" };
  }

  const fielderIds: string[] = [];
  const unresolved: string[] = [];
  for (const credit of credits) {
    const hit = resolveName(credit.fielder, registry);
    if (hit) fielderIds.push(hit.id);
    else unresolved.push(credit.fielder);
  }

  const first = credits[0]!;
  const kind: DismissalKind =
    first.kind === "catch"
      ? "caught"
      : first.kind === "stumping"
        ? "stumped"
        : first.assisted
          ? "run_out_assisted"
          : "run_out";

  return {
    kind,
    fielderIds,
    unresolved,
    resolvedText: unresolved.length === 0 ? buildResolvedText(kind, fielderIds) : "",
  };
}

/** Human-readable rendering of a stored canonical string, for review screens. */
export function describeResolved(
  resolvedText: string,
  registry: readonly RegistryEntry[],
): string {
  const nameOf = (id: string) =>
    registry.find((p) => p.id === id)?.displayName ?? "unknown player";
  const credits = parseDismissal(resolvedText);
  if (credits.length === 0) return "no fielding credit";
  if (credits[0]!.kind === "catch") return `caught by ${nameOf(credits[0]!.fielder)}`;
  if (credits[0]!.kind === "stumping") return `stumped by ${nameOf(credits[0]!.fielder)}`;
  const names = credits.map((c) => nameOf(c.fielder)).join(" and ");
  return credits[0]!.assisted ? `run out by ${names} (assisted)` : `run out by ${names}`;
}
