# NSCC Fantasy Cricket — locks slice (G4 / G6 / G10)

Club fantasy cricket platform. Four slices landed: the **computational engine core**
(scoring, pricing, cap ledger, starting price), the **Supabase schema + persistence +
recompute** layer, the **full derived chain** (team-round scoring, H2H, ladder,
overall leaderboard), and now **DB-level lock enforcement** — the round lock (G4), the
mid-match trade lock (G6), and the season lock (G10), plus the mandatory-captain and
starting-price-materialisation riders. The database is the gatekeeper: every rule is a
trigger/constraint that runs against pglite in the gate suite exactly as on real
Supabase, un-bypassable by any future client.

State-stamp: as-of 2026-07-09 · builds against DEFINITION_OF_DONE v1.1 /
**DECISION_LOG v1.7** / KICKOFF v1.1 · continues from commit 8b83903 (main HEAD;
v1.5–v1.7 resolved economy open items O1–O5 / composition semantics — none touch the
lock gates, and D19/D20/D21 + Riders 1/3 are unchanged) · default branch is `main`.
Companion docs (`DECISION_LOG.md`, `DEFINITION_OF_DONE.md`, `KICKOFF.md`) live in the
repo for cold-acceptance runs.

## Plain read + operator decisions (read first)
- **The database is the gatekeeper for locks.** All lock enforcement is Postgres
  triggers/constraints in `supabase/migrations/0002_locks.sql`, so G4/G6/G10 run
  against pglite like everything else and cannot be bypassed by a client. App-level
  friendly errors may duplicate these later; the DB stays authoritative.
- **Write-time vs derive-time.** Lock triggers compare `rounds.lock_at` /
  `matches.status` / `seasons.locked_at` against `now()` at WRITE time — correct.
  Recompute stays a pure function of raw data and never consults the clock; `src/`
  is untouched this slice (diff-proven below).
- **G4 repair hatch (`app.locks_bypass`).** The round-lock guards (selections/trades
  ONLY) honour a session GUC `app.locks_bypass` (`current_setting(...,true)`, default
  off): the manager's escape hatch for a post-lock correction when the recompute
  price-integrity assert (Rider 2) forces one. No bypass on the mid-match, season,
  config, starting-price, or team-registration guards. WHO may set the GUC is G13's job.
- **AUTHORISATION is temporary (until G13/RLS).** These triggers enforce WHEN a write
  is allowed, not WHO may write — any DB role can trip them. Role-gating arrives with
  the auth/RLS slice. Known, temporary state.
- **G6 operational requirement** (also in KICKOFF Definition of Healthy): the mid-match
  lock bites only once a lineup exists for the in_progress match, so lineups must be
  entered when a match goes in_progress — day-one entry for two-day matches.
- **Abandoned releases the mid-match lock (D19), team registration freezes at season
  lock (D21)** — both now enforced in the DB, both gate-tested.

## Build report (Standing Rule §1)

### What changed
- **New migration `supabase/migrations/0002_locks.sql`** — all lock enforcement, as
  Postgres triggers/constraints (plpgsql). Six objects:
  - `enforce_round_lock()` on `selections` **and** `trades` (BEFORE INSERT/UPDATE/
    DELETE): rejects writes to a round once `now() >= rounds.lock_at`. UPDATE checks
    **both OLD and NEW** round locks, so a row cannot be moved across the boundary in
    either direction. Honours the `app.locks_bypass` session GUC (default off) — the
    G4 repair hatch. NOT on scorecards (G3 "correct the scorecard, recompute" must
    keep working post-lock).
  - `enforce_midmatch_trade_lock()` on `trades` (BEFORE INSERT/UPDATE): rejects a
    buy/sell of any player in the lineup of an `in_progress` match. `finalised` and
    `abandoned` (D19) both release — the guard fires only on `in_progress`. No bypass.
  - `enforce_season_lock()` on `seasons` (BEFORE UPDATE): once `locked_at` is set,
    `config`/`locked_at` are immutable; the lock transition is **refused while any
    player has a NULL `starting_price`** (Rider 3 / the 0001 COMMENT binding).
  - `enforce_player_lock()` on `players` (BEFORE UPDATE): post-lock `starting_price`,
    `role`, `wk_eligible` frozen. INSERT still allowed (mid-season registry additions).
  - `enforce_team_registration_lock()` on `fantasy_teams` (BEFORE INSERT/DELETE):
    post-lock the team SET is frozen (D21 — fixture determinism). Name UPDATE untouched.
  - `enforce_mandatory_captain()` — a **DEFERRABLE INITIALLY DEFERRED** constraint
    trigger on `selections`: at COMMIT, every `(team, round)` with any selection must
    have exactly one `is_captain` (Rider 1's "≥1" half; the "≤1" half is 0001's
    partial unique index). Deferred so a team's selections insert in any order.
- **Test harness (`test/helpers/pgliteDb.ts`)**: `makeTestDb` now applies **all**
  `supabase/migrations/*.sql` in filename order (picks up 0002), and `seedSeason` wraps
  its writes in one transaction so the deferred captain constraint checks the completed
  seed atomically. No production `src/` change.

### What did NOT change
- **`src/` — byte-for-byte untouched this slice** (recompute stays a pure function of
  raw data; the clock lives only in the write-time triggers). Zero-change proof:
  `git status --short` lists no `src/` path; `git diff -- src/recompute src/engines`
  prints **nothing**. Recompute already seeds price from the stored `starting_price`
  (`orchestrator.ts:84`, `player.startingPrice ?? floor`) and never re-derives from
  last-season data — so "recompute reads only stored values post-lock" was already
  structurally true; 0002 just guarantees the seed is non-null at lock.
- No React UI, no RLS/auth wiring (G13), no screenshot→LLM transcription (G12).

### Artifacts (by name)
- Enforcement: `supabase/migrations/0002_locks.sql`.
- Harness: `test/helpers/pgliteDb.ts` (all-migrations apply + transactional seed).
- Gate tests: `test/g4.lock-enforcement.test.ts`, `test/g6.midmatch-trade-lock.test.ts`,
  `test/g10.season-lock.test.ts`, `test/mandatory-captain.test.ts` — all with
  hand-worked cases in comments and direct-write (not-UI) rejections.

### Gates moved (PROPOSED → DERIVED → BUILT → VERIFIED)
- **G4** LOCK_ENFORCEMENT → **VERIFIED** — selection/trade succeed pre-lock, rejected
  at `lock+1s` via direct write; per-round lock; cross-boundary UPDATE rejected both
  ways; `app.locks_bypass` permits, default rejects; `test/g4.lock-enforcement.test.ts`.
- **G6** MIDMATCH_TRADE_LOCK → **VERIFIED** — buy AND sell rejected while `in_progress`;
  both succeed once `finalised`; both succeed once `abandoned` (D19 release);
  `test/g6.midmatch-trade-lock.test.ts`.
- **G10** SEASON_LOCK → **VERIFIED** — pre-lock config change propagates through
  recompute; lock refused while a seed is NULL then succeeds; post-lock `seasons.config`,
  `players.starting_price`, and `fantasy_teams` INSERT/DELETE all rejected; recompute
  seeds from the stored value only; `test/g10.season-lock.test.ts`.
- **Rider 1 mandatory captain** (both halves) and **Rider 3 starting-price
  materialisation** enforced in the DB; `test/mandatory-captain.test.ts` + G10 suite.
- Still VERIFIED: G1, G2, G3, G5, G7, G8, G9, G11, G14. **68 tests green** (was 52).

### Open hypotheses
- Mid-match membership is via `scorecard_lineup`; the lock is only as good as timely
  lineup entry (recorded as an operational requirement in KICKOFF Definition of Healthy).
- `app.locks_bypass` is enforcement-scoped, not authorisation-scoped: until G13 any DB
  role can set it. G13 must gate both the GUC and who may write at all.
- Post-lock the `players` guard freezes `starting_price`/`role`/`wk_eligible` but allows
  INSERT (mid-season additions). If mid-season additions should also be blocked once
  locked, that's a separate operator call — currently allowed per KICKOFF registry note.

### Next action / next slices
1. **Auth/RLS (G13)** — role-gate WHO may write (manager-only settings/scorecards),
   wire `profiles.id = auth.users.id`, and authorise/restrict `app.locks_bypass`;
   **transcription guardrail (G12)**. Both want a real Supabase instance.
2. **React/Vite app** and baseline **B1** (full round ≤ 30 min operator time).
3. **Housekeeping:** consider promoting `ladder_points` weights to config if a season
   needs a different scale (D20 flagged it structural, revisitable).

### Burn report
One session: built `0002_locks.sql` — six trigger/constraint objects enforcing the
round lock (G4, incl. cross-boundary + `app.locks_bypass` repair hatch), the mid-match
trade lock (G6, both directions + abandoned release), and the season lock (G10: config
+ starting-price + team-registration immutability, plus the materialise-at-lock check),
with the mandatory-captain ≥1 as a deferred constraint trigger. Harness now applies all
migrations and seeds transactionally. 52 → 68 tests; three gates VERIFIED (G4/G6/G10);
`src/` untouched (diff-proven). Linchpin (plpgsql + deferrable constraint triggers +
GUC bypass in pglite) probed green before writing. Context capacity: ~60% of window
used at hand-off — comfortable margin; a cold-acceptance run of the full 68-test gate
suite fits within a fresh session.

## Run it

```bash
npm install
npm test          # vitest run — the gate suite (52 tests, incl. pglite-backed full-chain G3)
npm run typecheck # tsc --noEmit
```

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED
requires the named gate and its verifying artifact. APPROVED is the operator's.
