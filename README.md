# NSCC Fantasy Cricket — engine core + persistence

Club fantasy cricket platform. Two slices landed: the **computational engine core**
(scoring, pricing, cap ledger, starting price) and now the **Supabase schema +
persistence + recompute** layer that makes the prime invariant real. Config-driven
throughout (THE PRIME INVARIANT); verified against the frozen gates.

State-stamp: as-of 2026-07-09 · builds against DEFINITION_OF_DONE v1.1 /
**DECISION_LOG v1.2** / KICKOFF v1.1 · supersedes commit 531338a. Companion docs
(`DECISION_LOG.md`, `DEFINITION_OF_DONE.md`, `KICKOFF.md`) now live in the repo for
cold-acceptance runs.

## Plain read + operator decisions (read first)
- **Branch:** work moved onto `main` (created from `claude/new-session-09z8sk` at
  531338a — identical content, nothing to merge) per operator instruction. Open
  item: the GitHub *default branch* is still `claude/new-session-09z8sk`; flipping it
  to `main` is a repo setting, awaiting confirmation.
- **G2 "team value" — RESOLVED (A2).** DECISION_LOG is now v1.2: team value =
  `cap remaining + Σ current prices` (Gate G2 authoritative); `Σ current prices`
  alone is invested value. Already implemented (`CapLedger.teamValue`); no longer an
  open question.
- **Captaincy placement (design call in effect).** The recomputed shared per-player
  value is `base` (pre-captaincy), which is what pricing keys on (D1/G7). Captain ×2
  moves to the fantasy-team round layer (a deferred engine) — so **G8 will be
  re-verified there** in the next slice.

## Build report (Standing Rule §1)

### What changed
- **G11 CONFIG_ECONOMY is now executable** (was asserted). A shared G1 driver plus a
  second, fully distinct `LeagueConfig` (alternate scoring values, cap, team size,
  composition) re-run the G1/G2 logic green with **zero change to `src/engines/*` or
  `src/config/types.ts`** — the proof that the economy is config-driven.
- **Supabase schema** (`supabase/migrations/0001_init.sql`): the entire derived
  chain's tables — config/identity, raw truth (registry, rounds, matches,
  scorecards), raw user actions (teams, selections, trades) and every derived table.
- **Pure recompute orchestrator** (`src/recompute/`): `recomputeSeason(raw)` composes
  the existing engines deterministically → player match scores, sequential price
  history, and cap snapshots. Byte-identical on re-run (basis of G3).
- **Persistence** (`src/db/repository.ts`): `loadRawSeason` / `writeDerived`
  (transactional delete-then-insert — no orphaned derived rows) / `readDerived`,
  verified against **pglite** (in-process Postgres, no Docker).
- Three riders folded in: price-at-time integrity assert in recompute (loud failure
  on mismatch); partial unique indexes for ≤1 captain / ≤1 VC per team-round; a
  `starting_price` COMMENT binding the season-lock (G10) behaviour.

### What did NOT change / is NOT built yet
- Engines are untouched (that is the G11 proof). No H2H, ladder, or team-round
  scoring engine yet; those derived tables exist but are unpopulated. No React UI, no
  RLS/auth wiring, no server-side lock enforcement, no screenshot→LLM transcription.

### Artifacts (by name)
- `supabase/migrations/0001_init.sql` — full-chain schema.
- `src/recompute/{types,orchestrator}.ts`, `src/db/repository.ts`.
- `test/g11.config-economy.test.ts`, `test/fixtures/alt-config.ts`,
  `test/helpers/{references,pgliteDb}.ts`, `test/recompute.idempotence.test.ts`.

### Gates moved (PROPOSED → DERIVED → BUILT → VERIFIED)
- **G11** CONFIG_ECONOMY → **VERIFIED** — `test/g11.config-economy.test.ts`.
- **G3** RECOMPUTE_IDEMPOTENCE → **PARTIAL** (scores / prices / cap byte-identical +
  no orphaned rows, object-level and via pglite) — `test/recompute.idempotence.test.ts`.
  H2H + ladder remain, so G3 is not yet fully VERIFIED.
- Still VERIFIED from the prior slice: G1, G2, G5, G7, G8, G14. **34 tests green.**

### Open hypotheses
- Recompute snapshots the *current* cap position per team (one row at the latest
  round); per-round cap history is a later refinement if the ladder view needs it.
- Fantasy captaincy is per-team, so `scoreMatch`'s captain fields are unused by the
  orchestrator (it reads `base`); confirmed harmless, re-verified at G8-next.

### Next action / next slices
1. **Full-chain G3 + G9 + G8 (re-verified at the team-round layer):** build
   team-round scoring (captain ×2), H2H results, and ladder engines to populate the
   remaining derived tables and make recompute byte-identical across the whole chain.
2. **Locks slice (G4 / G6 / G10):** server-side lock enforcement against
   `rounds.lock_at` / `matches.status` / `seasons.locked_at`. **Includes the
   mandatory-captain (≥1) commit-time check** that the partial unique indexes cannot
   express (Rider 1's other half), and the G10 starting-price materialisation.
3. **Auth/RLS (G13)** and **transcription guardrail (G12)** against a real Supabase
   instance; then the React/Vite app and baseline B1.

### Burn report
One session: G11 made executable + Supabase schema, persistence and deterministic
recompute (partial G3) from the engine-core baseline; 8 → 34-ish tests, +pglite; two
gates moved (G11 VERIFIED, G3 PARTIAL); engines untouched.

## Run it

```bash
npm install
npm test          # vitest run — the gate suite (incl. pglite-backed G3)
npm run typecheck # tsc --noEmit
```

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED
requires the named gate and its verifying artifact. APPROVED is the operator's.
