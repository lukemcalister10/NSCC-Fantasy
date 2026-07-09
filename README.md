# NSCC Fantasy Cricket — league-config squad + cap-at-lock slice (A7 / O2 / O3)

Club fantasy cricket platform. Prior slices landed: the **computational engine core**
(scoring, pricing, cap ledger, starting price), the **Supabase schema + persistence +
recompute** layer, the **full derived chain** (team-round scoring, H2H, ladder,
overall leaderboard), and **DB-level lock enforcement** (round lock G4, mid-match trade
lock G6, season lock G10 + the mandatory-captain / starting-price riders). This slice
implements **DECISION_LOG A7 (O2/O3)** ahead of any validation layer — a cheap
type/schema reshape plus one extension of the season-lock action:

1. **`LeagueConfig.squad` composition reshaped** from exact per-role counts to **role
   MINIMUMS + total SIZE**, with `flex = teamSize − Σ minimums` (O2/A7). Type/schema
   only — no selection-validation engine yet (that has no gate).
2. **Salary cap computed AT SEASON LOCK** (O3/A7): the same lock action, after the
   starting-price materialisation-completeness check passes, writes
   `cap = team_size × mean(starting_price)` (nearest $100, halves up) into the frozen
   config.

The database stays the gatekeeper: the cap is computed inside the season-lock trigger,
un-bypassable by any client.

State-stamp: as-of 2026-07-09 · builds against DEFINITION_OF_DONE v1.1 /
**DECISION_LOG v1.7** / KICKOFF v1.1 · continues from commit c6d2b8b (locks slice HEAD)
· `src/engines/*` untouched (diff-proven below). Companion docs (`DECISION_LOG.md`,
`DEFINITION_OF_DONE.md`, `KICKOFF.md`) live in the repo for cold-acceptance runs;
builder process notes in `CLAUDE.md`.

## Plain read + operator decisions (read first)
- **Two A7 items, done together, before any validation layer.** O2 reshapes the
  composition type; O3 makes the season-lock action compute the cap. Both are cheap
  now and awkward later (a stored-config migration), so they land ahead of the
  selection-validation and app slices that will consume them.
- **Composition is now MINIMUMS + SIZE, flex derived.** `SquadConfig.composition`
  (exact per-role counts) becomes `SquadConfig.roleMinimums` (per-role *minimums*)
  alongside `teamSize`; `flex = teamSize − Σ roleMinimums` is DERIVED, never stored.
  Strict role counting (an AR never counts toward BAT; flex is the only wildcard);
  the WK minimum is satisfiable by a WK-role OR a `wk_eligible` player (D9). **No
  enforcement engine this slice** — composition validation has no gate (named scope
  for the later selection-validation slice). Type/schema change only.
- **The cap is computed BY the lock action (DB is the gatekeeper).** O3:
  `cap = team_size × mean(starting_price over all players)`, nearest $100, halves up
  (D4/G14), 1.0× with no headroom (stars funded by basement filler — a knowing
  choice). It is computed inside `enforce_season_lock()` in the SAME transition that
  freezes the season, immediately AFTER the Rider-3 materialisation-completeness check
  (so the mean is well-defined), and written into the config jsonb being frozen. It is
  therefore post-lock immutable "as the rest of config" for free.
- **`src/engines/*` untouched (diff-proven below).** The engines carry no economy
  constants; the reshape is confined to `src/config/*` (the type + the fixture) and
  the cap logic lives in SQL. `git diff -- src/engines` prints nothing.

## Build report (Standing Rule §1)

### What changed
- **`src/config/types.ts`** — `SquadConfig.composition: Record<PlayerRole, number>`
  (exact counts, "keys sum to teamSize") reshaped to
  `SquadConfig.roleMinimums: Record<PlayerRole, number>` (per-role minimums; flex =
  `teamSize − Σ minimums`, derived). Doc comment states the strict-counting and
  WK/`wk_eligible` semantics (O2/A7/D9) and that enforcement is deferred (no gate).
  `cap` doc updated to "computed by the season-lock action" (O3).
- **`src/config/fixture.ts`** — `composition:` → `roleMinimums:` (values unchanged:
  BAT 2 / WK 1 / BWL 2 / AR 1, summing to teamSize 6 → flex 0, faithful to the DoD
  fixture). `cap` left as the tunable placeholder overwritten at lock.
- **`test/fixtures/alt-config.ts`** — same rename (values unchanged; G11 reads only
  `squad.cap`, so the rename is inert to it).
- **`supabase/migrations/0002_locks.sql`** — `enforce_season_lock()` extended: in the
  lock-transition branch, AFTER the NULL-`starting_price` refusal, it computes
  `avg(starting_price)` over the season's players, multiplies by the config's
  `teamSize`, rounds to the nearest $100 with halves up
  (`floor(raw/100 + 0.5) * 100`), and `jsonb_set`s it into `NEW.config` at
  `{squad,cap}`. Post-lock the existing "config is immutable" guard covers it.

### What did NOT change
- **`src/engines/*` — byte-for-byte untouched.** Zero-change proof:
  `git diff -- src/engines` prints **nothing**; `git status --short` lists no
  `src/engines/` path. The engines carry no economy constants (G11), so the reshape
  never reached them — the only source touched is `src/config/*` (type + fixture),
  and the cap arithmetic lives in the SQL trigger.
- No selection-validation engine (composition minimums are unenforced by design this
  slice), no React UI, no RLS/auth (G13), no transcription (G12).

### Artifacts (by name)
- Type reshape: `src/config/types.ts`, `src/config/fixture.ts`,
  `test/fixtures/alt-config.ts`.
- Cap-at-lock enforcement: `supabase/migrations/0002_locks.sql`
  (`enforce_season_lock()`).
- New gate test: `test/g10.cap-at-lock.test.ts` — locks a seeded season, asserts the
  written cap equals a hand-computed mean (worked arithmetic in comments:
  pool $50,000 / $9,000 / $9,000 / $9,100 → mean $19,275 → 6 × $19,275 = $115,650 →
  halves-up to **$115,700**), and asserts the computed cap is post-lock immutable
  exactly like the rest of config.

### Gates moved (PROPOSED → DERIVED → BUILT → VERIFIED)
- **O2 composition reshape** → **BUILT** (type/schema; no gate — enforcement is the
  later selection-validation slice's scope). **G11 CONFIG_ECONOMY stays VERIFIED**
  under the reshaped type (`test/g11.config-economy.test.ts` green).
- **O3 cap-at-lock** → **VERIFIED** by a new G10-family test
  (`test/g10.cap-at-lock.test.ts`): the lock action overwrites the placeholder with
  `team_size × mean(starting_price)` rounded nearest $100 (halves up), and the value
  is rejected on any post-lock mutation.
- **G10 SEASON_LOCK stays VERIFIED** — the cap write is additive to the existing lock
  transition; the full `test/g10.season-lock.test.ts` suite is unchanged and green.
- Still VERIFIED: G1–G9, G11, G14 + Riders 1/3. **70 tests green** (was 68).

### Open hypotheses
- **Composition minimums are unenforced.** The reshaped type is inert until the
  selection-validation slice reads it (strict counting, flex, WK/`wk_eligible`). That
  slice needs its own gate (composition enforcement currently has none — DECISION_LOG
  O2 build note).
- **`teamSize` is read from the config jsonb at lock.** If a future season's stored
  config ever lacked `squad.teamSize`, the cap would compute as NULL; every current
  config carries it, and the app writes the whole `LeagueConfig`. A NOT-NULL-ish guard
  could be added if hand-authored partial configs become a thing.
- **1.0× cap, no headroom (O3).** Gun-concentration is an accepted knowing choice; if
  the operator later wants headroom it is a config multiplier, a pre-lock decision.

### Next action / next slices
1. **Selection-validation slice** — consume `roleMinimums` + `teamSize`: strict role
   counting, flex remainder, WK-by-`wk_eligible`; give composition enforcement its
   gate. Also enforce team size and the O1 trades-per-round cap at write time.
2. **Auth/RLS (G13)** and **transcription guardrail (G12)** — both want real Supabase.
3. **React/Vite app** and baseline **B1** (full round ≤ 30 min operator time).

### Burn report
One session: reshaped `LeagueConfig.squad` from exact counts to role minimums + size
(`composition` → `roleMinimums`, flex derived; O2/A7), updated the fixture + alt config
and the type doc — engines untouched (diff-proven), G11 still green. Extended
`enforce_season_lock()` to compute the O3 cap (`team_size × mean(starting_price)`,
nearest $100 halves up) into the frozen config at the lock transition, after the
Rider-3 completeness check. Added `test/g10.cap-at-lock.test.ts` with hand-worked
arithmetic ($115,700) and a post-lock-immutability assertion. 68 → 70 tests green;
typecheck clean. Cheap slice by design (type + one SQL branch + one test); comfortable
context margin at hand-off.

## Run it

```bash
npm install
npm test          # vitest run — the gate suite (70 tests, incl. pglite-backed full-chain G3)
npm run typecheck # tsc --noEmit
```

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED
requires the named gate and its verifying artifact. APPROVED is the operator's.
