/**
 * PLAYER NAME NORMALISATION (DECISION_LOG D22, ruling A9 of 07/08/2026).
 *
 * Applied IDENTICALLY on registry write and on every inbound match attempt
 * (manual scorecard entry, CSV import, screenshot transcription, any future
 * import). The normalised form is CANONICAL for storage; the raw source string is
 * retained alongside transcription records for audit.
 *
 * The rule, verbatim and in this order:
 *   1. Unicode NFKC
 *   2. curly apostrophes U+2018 / U+2019  -> ASCII apostrophe U+0027
 *   3. curly double quotes U+201C / U+201D -> ASCII quote U+0022
 *   4. non-breaking space U+00A0          -> space
 *   5. collapse internal whitespace runs to one space
 *   6. trim
 *
 * CASE and DIACRITICS are PRESERVED (display fidelity). Matching may fold case
 * (see `namesMatch`) but must NEVER fold diacritics into ASCII.
 *
 * Why this exists: a spreadsheet round-trip silently rewrote "Adam O'Callaghan"
 * from U+2019 to U+0027, which is exactly the G12 unresolved-name failure mode —
 * and one that would recur every week, invisibly, against a registry storing the
 * other form.
 *
 * THE DATABASE IS THE GATEKEEPER (D16): this TypeScript function is the client-
 * side half only. `app.normalise_name()` in supabase/migrations/0005 is the
 * authority and normalises on write no matter which client is talking. The two
 * implementations are held together by test/d22.name-normalisation.test.ts, which
 * runs the SAME case table through both.
 *
 * NOT frozen by season lock (structural convention, not economy config).
 */

const CURLY_SINGLE = /[‘’]/g;
const CURLY_DOUBLE = /[“”]/g;
const NBSP = / /g;
const WHITESPACE_RUN = /\s+/g;

/** D22 normalisation. Total function: never throws, empty in -> empty out. */
export function normaliseName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(NBSP, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

/**
 * Match key for name lookups: D22 normalisation plus a case fold. Diacritics
 * survive — "Renée" never collapses to "Renee", so two genuinely different
 * players cannot be silently merged.
 *
 * `toLowerCase()` (not `toLocaleLowerCase()`): locale-sensitive folding would
 * make the key depend on the operator's browser locale, and a key that differs
 * between the import machine and the entry machine is the same failure D22 exists
 * to kill. Mirrors SQL `lower(app.normalise_name(...))`.
 */
export function nameMatchKey(raw: string): string {
  return normaliseName(raw).toLowerCase();
}

/** True when two names denote the same registry entry under D22 + case fold. */
export function namesMatch(a: string, b: string): boolean {
  return nameMatchKey(a) === nameMatchKey(b);
}

/**
 * Resolve an inbound name against a registry, D22-canonically. Returns the single
 * matching entry, or null when there is NO match or an AMBIGUOUS one — the caller
 * must block and ask (KICKOFF: "unresolved names flagged, never guessed"; G12).
 */
export function resolveName<T extends { displayName: string }>(
  inbound: string,
  registry: readonly T[],
): T | null {
  const key = nameMatchKey(inbound);
  const hits = registry.filter((p) => nameMatchKey(p.displayName) === key);
  return hits.length === 1 ? hits[0]! : null;
}
