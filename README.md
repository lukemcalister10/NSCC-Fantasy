# NSCC Fantasy Cricket — full derived chain

Club fantasy cricket platform. Three slices landed: the **computational engine core**
(scoring, pricing, cap ledger, starting price), the **Supabase schema + persistence +
recompute** layer, and now the **full derived chain** — team-round scoring (captaincy),
H2H results, ladder and overall leaderboard — so `recomputeSeason` derives the ENTIRE
chain byte-identically. Config-driven throughout (THE PRIME INVARIANT); verified
against the frozen gates.

State-stamp: as-of 2026-07-09 · builds against DEFINITION_OF_DONE v1.1 /
**DECISION_LOG v1.2** / KICKOFF v1.1 · supersedes commit 5307187 · default branch is
now `main`. Companion docs (`DECISION_LOG.md`, `DEFINITION_OF_DONE.md`, `KICKOFF.md`)
live in the repo for cold-acceptance runs.

## Plain read + operator decisions (read first)
- **Bye median = median over ALL N teams' round totals, INCLUDING the bye team**
  (operator decision this session; whole-league "median game"). Odd N (the only case
  that byes) → true middle, an integer.
- **Ladder points = win 2 / tie 1 / loss 0** → `ladder_points = 2·wins + ties`
  (operator-confirmed **structural** convention, not economy config; flagged as a
  candidate config value if a season ever needs a different scale).
- **Captaincy now lives at the team-round layer (D10), not `scoreMatch`.** The ×2 is
  driven by `selections.is_captain / is_vice_captain` — never a scorecard captain
  field. `base` stays pre-captaincy and still drives pricing (D1/G7). **G8 is
  re-verified here** (`test/g8.captaincy-team-round.test.ts`).
- **Washout convention added (operator directive).** `abandoned` is now a
  `match_status`: a washout produces **no score rows and no price movements**
  (everyone DNP, prices frozen per D2) but still marks its round **active**. Noted for
  the locks slice: an abandoned match RELEASES the D7 mid-match trade lock. *This
  convention is not yet in DECISION_LOG — recommend logging it as a decision (e.g. D19)
  at the next operator sitting.*

## Build report (Standing Rule §1)

### What changed
- **Four deferred engines built** (`src/recompute/`, pure & deterministic, composing
  the existing engines — **no `src/engines/*` change**):
  - `teamRoundScoring.ts` — per `(team, round)` Σ of selected players' round-`base`,
    with **captaincy (D10) applied here**: effective captain = the `is_captain`
    selection if it has a score row that round, else the `is_vice_captain` selection
    if it does, else none (both DNP → no double). "DNP" = *no score row at all* (a
    lineup player always has `played=true`, so absence-of-row is what models a
    captain who did not play).
  - `roundRobin.ts` — deterministic repeated round-robin (circle method, ghost slot
    for odd counts). **`generateRound` is exported** so the UI renders upcoming
    fixtures directly, never by querying `h2h_results` (operator directive).
  - `h2h.ts` — derives fixtures per active round; settles on team-round totals; **bye
    scored against the round median** (all N teams, incl. the bye team).
  - `ladder.ts` / `overallLeaderboard.ts` — wins/points-for standings (a bye counts
    as played, settled vs its median) and the separate Σ-round-totals leaderboard.
- **`recomputeSeason` now derives the ENTIRE chain** and returns all four families
  populated; `DerivedState`'s `never[]` placeholders became real typed arrays.
- **Persistence extended** (`src/db/repository.ts`): `writeDerived` INSERTs the four
  new families (DELETEs already scoped them — no orphans); `readDerived` reads them
  back with `ORDER BY` matching recompute's emit order exactly, so the pglite
  round-trip is byte-identical. `h2h_results.id` stays a physical surrogate — never
  modelled, read back, or compared.
- **Washout convention** (`match_status` gains `abandoned`): no scores, no price
  movement, still marks the round active; an all-abandoned round → all-tie outcome.
- **Determinism**: every derived array is keyed on the exact string columns
  `readDerived` orders by (not `round.seq`), the one trap that would silently pass
  object-level idempotence but fail the DB round-trip.

### What did NOT change
- **`src/engines/*` — byte-for-byte untouched** (the standing constraint). Zero-change
  proof: `git diff --stat 5307187..HEAD -- src/engines` prints **nothing**.
- No React UI, no RLS/auth wiring, no server-side lock enforcement, no screenshot→LLM
  transcription. `scoreMatch`'s own captain fields remain (unused by the orchestrator,
  which reads `base`); captaincy is now proven at the team-round layer instead.

### Artifacts (by name)
- Engines: `src/recompute/{roundRobin,teamRoundScoring,h2h,ladder,overallLeaderboard}.ts`;
  `src/recompute/{orchestrator,types}.ts`; `src/db/repository.ts`; `src/index.ts`;
  `supabase/migrations/0001_init.sql` (`abandoned` enum value).
- Gate tests: `test/g8.captaincy-team-round.test.ts`, `test/g9.h2h-bye-ladder.test.ts`,
  `test/washout.test.ts`, `test/recompute.idempotence.test.ts` (extended to full chain).

### Gates moved (PROPOSED → DERIVED → BUILT → VERIFIED)
- **G3** RECOMPUTE_IDEMPOTENCE → **VERIFIED** — full chain byte-identical (object-level
  and pglite) with no orphaned rows across all seven derived families;
  `test/recompute.idempotence.test.ts`.
- **G9** BYE_MEDIAN → **VERIFIED** — 5-team H2H round, bye vs round median, ladder +
  points-for reconciled against a hand-worked example; `test/g9.h2h-bye-ladder.test.ts`.
- **G8** CAPTAINCY → **RE-VERIFIED at the team-round layer** (captain DNP → VC doubled;
  both DNP → no double; captain played-but-0 still doubled), driven by selections;
  `test/g8.captaincy-team-round.test.ts`.
- Still VERIFIED: G1, G2, G5, G7, G11, G14. **52 tests green** (was 34).

### Open hypotheses
- Team-round scores are emitted for **active rounds only** (≥1 finalised OR abandoned
  match); future/empty rounds produce no rows. If the UI wants a full team×round grid
  including unplayed rounds, that is a display-layer fill, not a recompute change.
- Home/away is by circle-method orientation (deterministic, balances over a cycle); it
  labels `outcome` only and never affects W/L. A 2-team league keeps the same team
  home each round — cosmetic, revisit if it matters.
- Bye median is **inclusive** of the bye team (operator decision). Even-N leagues never
  bye, so the lower-median even-count rule is defined but never exercised by a gate.

### Next action / next slices
1. **Locks slice (G4 / G6 / G10):** server-side lock enforcement against
   `rounds.lock_at` / `matches.status` / `seasons.locked_at`. **Now also in scope:
   season lock freezes fantasy-team registration** (fixture determinism depends on a
   stable team set — accepted trade-off: *no manual matchup adjustment, ever*),
   **alongside starting-price materialisation** (Rider 3 / G10). Includes the
   mandatory-captain (≥1) commit-time check (Rider 1's other half) and the **abandoned
   match RELEASING the D7 mid-match trade lock**.
2. **Auth/RLS (G13)** and **transcription guardrail (G12)** against a real Supabase
   instance; then the React/Vite app and baseline B1.
3. **Housekeeping:** log the washout/`abandoned` convention as a DECISION (D19);
   consider promoting `ladder_points` weights to config if a season needs a different
   scale.

### Burn report
One session: built the four deferred engines (team-round captaincy, round-robin H2H,
ladder, overall leaderboard) + washout convention, extending `recomputeSeason` to a
byte-identical FULL chain from the persistence baseline; 34 → 52 tests; three gates
moved (G3 VERIFIED, G9 VERIFIED, G8 re-verified at the team-round layer);
`src/engines/*` untouched (diff-proven). Context capacity: ~55% of window used at
hand-off — comfortable margin remaining; a cold-acceptance run of the full gate suite
would fit well within a fresh session.

## Run it

```bash
npm install
npm test          # vitest run — the gate suite (52 tests, incl. pglite-backed full-chain G3)
npm run typecheck # tsc --noEmit
```

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED
requires the named gate and its verifying artifact. APPROVED is the operator's.
