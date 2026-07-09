/**
 * H2H FIXTURE GENERATION — a pure, deterministic repeated round-robin (D11).
 *
 * There is no fixtures table: the schedule is DERIVED from the fantasy-team set
 * and the round index, so it recomputes byte-identically (basis of G3/G9) and
 * the UI can render UPCOMING fixtures by calling `generateRound` directly rather
 * than querying the derived `h2h_results` (operator directive).
 *
 * Classic circle method: sort team ids (determinism); if the count is odd, append
 * a ghost slot so exactly one real team draws a bye each round. The schedule
 * repeats every `paddedSlots - 1` rounds (= N for odd N, N-1 for even N), so
 * every team meets every other once per cycle and byes rotate through all teams.
 *
 * NOTE (operator, accepted trade-off): fixture determinism depends on a STABLE
 * team set — season lock freezes fantasy-team registration (locks slice / G10).
 * There is deliberately no manual matchup adjustment, ever.
 */

export interface Fixture {
  home: string;
  /** null = the home team has a bye this round (scored vs the round median). */
  away: string | null;
}

const GHOST = "__BYE__";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Fixtures for one round. `roundIndex` is 0-based (round seq − 1); it is reduced
 * modulo the cycle length, so a season longer than one round-robin cycle simply
 * repeats the schedule (a "repeated" round-robin, D11).
 */
export function generateRound(teamIds: string[], roundIndex: number): Fixture[] {
  const slots = [...teamIds].sort(cmp);
  if (slots.length === 0) return [];
  if (slots.length % 2 === 1) slots.push(GHOST); // a lone team (1) also byes vs the ghost

  const n = slots.length; // even
  const half = n / 2;
  const cycleLength = n - 1;
  const r = ((roundIndex % cycleLength) + cycleLength) % cycleLength;

  // Slot 0 is fixed; slots 1..n-1 rotate by r each round (the "circle").
  const ring = new Array<string>(n);
  ring[0] = slots[0]!;
  for (let i = 1; i < n; i++) {
    ring[i] = slots[1 + ((i - 1 + r) % (n - 1))]!;
  }

  const fixtures: Fixture[] = [];
  for (let i = 0; i < half; i++) {
    const home = ring[i]!;
    const away = ring[n - 1 - i]!;
    if (home === GHOST) fixtures.push({ home: away, away: null });
    else if (away === GHOST) fixtures.push({ home, away: null });
    else fixtures.push({ home, away });
  }
  return fixtures;
}

/** True iff `teamIds` is odd-sized, i.e. one team byes each round. */
export function hasBye(teamCount: number): boolean {
  return teamCount % 2 === 1;
}
