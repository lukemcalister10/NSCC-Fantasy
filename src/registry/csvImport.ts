import type { PlayerRole, PricingConfig } from "../config/types.js";
import { startingPrice } from "../engines/startingPrice.js";
import { normaliseName, nameMatchKey } from "./nameNormalisation.js";

/**
 * PROVISIONAL REGISTRY SEED IMPORT (D23, kickoff scope 1a).
 *
 * Parses the operator's 25/26-derived registry CSV and prepares it for a
 * review-then-commit import. This module PARSES and PRICES; it never writes —
 * the admin UI shows the result, the operator confirms, and only then does a
 * write happen.
 *
 * THE PRICE COLUMN IS NOT TRUSTED (binding, kickoff 1a). `starting_price_reference`
 * is treated as a CROSS-CHECK, not as input: every price is recomputed from
 * `total_fantasy_pts_2526` and `g_matches_2526` through the existing verified D4 /
 * G14 `startingPrice` engine, and any row where the two disagree is surfaced for
 * the operator. The engine is the source of truth; the column is a witness.
 *
 * DATA HANDLING (D17 / Law 11, binding): the CSV is chosen through a browser file
 * picker at import time and parsed IN MEMORY. Nothing here reads from or writes to
 * disk, and no real player data file belongs in this repository. Every fixture in
 * the tests uses invented names.
 *
 * NAMES are normalised on the way in (D22) so what the operator reviews is exactly
 * what will be stored and later matched against.
 */

export const SEED_COLUMNS = [
  "player",
  "role",
  "wk_eligible",
  "g_matches_2526",
  "total_fantasy_pts_2526",
  "starting_price_reference",
] as const;

const ROLES: readonly PlayerRole[] = ["BAT", "WK", "BWL", "AR"];

export interface SeedRow {
  /** 1-based line number in the source file, for pointing the operator at it. */
  line: number;
  /** D22-normalised name — what would be stored. */
  name: string;
  /** Exactly as it appeared in the file, when normalisation changed something. */
  rawName: string | null;
  role: PlayerRole;
  wkEligible: boolean;
  games: number;
  totalPoints: number;
  /** Per-match average fed to the D4 engine (0 when the player has no games). */
  average: number;
  /** Recomputed through the D4/G14 engine — the value that would be written. */
  computedPrice: number;
  /** The file's own price column, parsed. NULL when blank/unparseable. */
  referencePrice: number | null;
  /** True when the file's price disagrees with the engine (operator must look). */
  priceDisagrees: boolean;
  /** Row-level problems. A row with errors is NOT importable. */
  errors: string[];
}

export interface SeedParseResult {
  rows: SeedRow[];
  /** File-level problems (missing/misspelled headers, empty file, duplicates). */
  errors: string[];
  /** Rows with no errors — the set a commit would write. */
  importable: SeedRow[];
  /** Rows whose recomputed price differs from the file's reference column. */
  disagreements: SeedRow[];
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC4180-shaped: quoted fields, doubled quotes, CRLF, BOM)
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

/** Spreadsheet truthiness: blank is FALSE (the seed leaves non-keepers empty). */
function parseFlag(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "") return false;
  if (["y", "yes", "true", "t", "1"].includes(v)) return true;
  if (["n", "no", "false", "f", "0"].includes(v)) return false;
  return null;
}

/** Tolerates "$99,400" / "99400.0" / blank. NULL means "not a number". */
function parseNumber(raw: string): number | null {
  const v = raw.trim().replace(/[$,\s]/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Parse + price a registry seed CSV against the season's PRICING CONFIG (never
 * against constants in this file — G11). `pricing` comes from the season row the
 * import is targeting, so a pre-lock config change reprices the whole import with
 * no code change.
 */
export function parseRegistrySeed(
  text: string,
  pricing: PricingConfig,
): SeedParseResult {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length === 0) {
    return { rows: [], errors: ["file is empty"], importable: [], disagreements: [] };
  }

  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const index: Record<string, number> = {};
  for (const col of SEED_COLUMNS) {
    const at = header.indexOf(col);
    if (at === -1) errors.push(`missing required column "${col}"`);
    index[col] = at;
  }
  if (errors.length > 0) {
    return { rows: [], errors, importable: [], disagreements: [] };
  }

  const rows: SeedRow[] = [];
  const seen = new Map<string, number>(); // match key -> first line seen on

  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const line = r + 1; // 1-based, header is line 1
    const get = (col: string): string => cells[index[col]!] ?? "";
    const rowErrors: string[] = [];

    const rawName = get("player");
    const name = normaliseName(rawName);
    if (name === "") rowErrors.push("player name is empty");

    const roleRaw = get("role").trim().toUpperCase();
    const role = (ROLES as readonly string[]).includes(roleRaw)
      ? (roleRaw as PlayerRole)
      : null;
    if (role === null) {
      rowErrors.push(`role "${get("role").trim()}" is not one of ${ROLES.join("/")}`);
    }

    const wkEligible = parseFlag(get("wk_eligible"));
    if (wkEligible === null) rowErrors.push(`wk_eligible "${get("wk_eligible")}" is not a yes/no value`);

    const games = parseNumber(get("g_matches_2526"));
    if (games === null || games < 0 || !Number.isInteger(games)) {
      rowErrors.push(`g_matches_2526 "${get("g_matches_2526")}" is not a whole number of matches`);
    }

    const totalPoints = parseNumber(get("total_fantasy_pts_2526"));
    if (totalPoints === null) {
      rowErrors.push(`total_fantasy_pts_2526 "${get("total_fantasy_pts_2526")}" is not a number`);
    }

    const referencePrice = parseNumber(get("starting_price_reference"));

    // D22: two rows that normalise to the same name would make every future
    // inbound match ambiguous — and the registry's unique index refuses the
    // second anyway. Catch it here so the operator sees WHICH lines collide.
    const key = nameMatchKey(name);
    if (name !== "") {
      const first = seen.get(key);
      if (first !== undefined) rowErrors.push(`duplicate of the player on line ${first}`);
      else seen.set(key, line);
    }

    const g = games ?? 0;
    const total = totalPoints ?? 0;
    // D4: the per-match average uses g as its denominator — the SAME g that drives
    // the ramp. g = 0 is a zero-history player and prices at the floor.
    const average = g > 0 ? total / g : 0;
    const computedPrice = startingPrice(average, g, pricing);

    rows.push({
      line,
      name,
      rawName: rawName === name ? null : rawName,
      role: role ?? "BAT",
      wkEligible: wkEligible ?? false,
      games: g,
      totalPoints: total,
      average,
      computedPrice,
      referencePrice,
      priceDisagrees: rowErrors.length === 0 && referencePrice !== null && referencePrice !== computedPrice,
      errors: rowErrors,
    });
  }

  const importable = rows.filter((r) => r.errors.length === 0);
  return {
    rows,
    errors,
    importable,
    disagreements: importable.filter((r) => r.priceDisagrees),
  };
}
