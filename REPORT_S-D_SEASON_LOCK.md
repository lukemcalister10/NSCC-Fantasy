# S-D — SEASON LOCK (C5). Build report, Standing Rule §1

State-stamp: as-of **10/08/2026** · slice **S-D season lock** · builds against KICKOFF **v1.3** /
DEFINITION_OF_DONE **v1.2 (frozen)** / DECISION_LOG **v2.0** · continues from `main @ eca2109`
(re-checked against GitHub before starting, Standing Rule 8) · branch
`claude/season-lock-settings-action-88hqgq`.

Status: **BUILT + VERIFIED in-repo**; the operator half of G10 is **PROPOSED** until step S9 of
MANAGER_VERIFY is signed off. "Done" is banned (Standing Rule 3).

---

## Plain read + operator decisions (read first)

### C5 OVERSTATES THE GAP, AND THE DECISION LOG SHOULD BE CORRECTED

C5 reads *"SEASON LOCK IS UNBUILT."* It is not, and the difference matters for how the next
reader budgets this area.

**The enforcement half has existed and been green since the locks slice, in `0002_locks.sql`.**
Before this slice, on `main @ eca2109`, all of the following were already triggers and already
verified by `test/g10.season-lock.test.ts` and `test/g10.cap-at-lock.test.ts`:

| C5 says the lock must… | Already enforced in 0002 by |
|---|---|
| freeze league settings, scoring rules, α, floor, $/pt, trades-per-round | `trg_seasons_lock` (the whole `seasons.config` jsonb) |
| freeze starting prices, roles, wk_eligible | `trg_players_lock` |
| freeze fantasy-team registration (D21) | `trg_fantasy_teams_registration_lock` |
| compute the salary cap (O3) | the lock transition itself, hand-checked at $115,700 |
| be a one-way door | `trg_seasons_lock` rejects clearing or moving `locked_at` |
| block on an unpriced player | the lock transition (Rider 3) |

What was genuinely missing was **the operator's access to it**: `/admin/settings` was six lines
of `<Placeholder>`, unlinked from `/admin`, so the only route to a locked season was
`UPDATE seasons SET locked_at = now()` in the SQL editor — with no way to see beforehand what
cap that would compute, and no rehearsal.

C5's own last sentence is the accurate one and the rest of the entry should be brought into line
with it: *"G10 is currently verified against the enforcement layer, not against an
operator-facing action — so MANAGER_VERIFY step 9 is BLOCKED, not failed."* **Suggested
correction: C5 is not "season lock is unbuilt" but "season lock has no operator-facing action;
enforcement is built and verified."** That is a materially smaller slice than the entry implies,
which is why the budget went into preview fidelity and per-category proof instead.

### Operator decisions honoured this slice

- **Pool = ALL players, literally (O3), reached by REMOVING withdrawals before lock.** Built as
  ruled. The verified cap arithmetic is untouched; a removal mechanism now exists so "all
  players" needs no qualification at lock. The active/inactive split stays on the preview as the
  pre-lock check that the removal work has actually been done. `active = false` continues to
  mean *not selectable*, not *not in the pool* — and the page says so in those words.
- **What "remove" means, per your instruction to state the reasoning rather than choose
  silently.** A `DELETE`, permitted **only when the player carries no raw history**, refused
  post-lock, and logged. The reasoning, in full:
  - *Why delete at all:* it is the only thing that actually takes a player out of the mean
    without changing what the mean is over.
  - *Why "no raw history":* derived scores, prices and ladder rows reference players, so
    deleting someone who has played breaks D15's recomputability. Worse,
    `dismissals.resolved_text` carries player ids as **text** (D25) with **no foreign key** —
    deleting a fielder named only there would silently orphan a fielding credit, which is the
    exact defect D25 was written to close. The guard therefore checks the dismissal strings
    explicitly, alongside lineups, batting and bowling lines, selections and trades, and the
    refusal **names which one blocks it**.
  - *Why NOT the "otherwise, a status that excludes from the cap mean" branch you offered:* any
    such status changes the arithmetic from *mean over all players* to *mean over players where
    status ≠ …*, which is precisely the change to verified arithmetic you declined. And it would
    buy nothing real: **season lock precedes round 1** (KICKOFF), so in a real season no player
    has raw history at lock and the delete path covers 100% of cases. The only way to reach the
    "otherwise" branch is a scratch season with matches already entered, where the cap does not
    matter. A pre-lock player who genuinely has history stays in the pool and in the mean, and
    the preview makes that visible rather than silent.
  - *Why removal is refused post-lock while mid-season **additions** stay legal (C4):* the cap is
    a claim about the pool at one instant. An addition cannot change a cap already computed and
    frozen; a removal makes the claim unreproducible. Adding to a record versus editing one.
- **Scoring values (O4):** exposed exactly the keys `ScoringConfig` carries today. The O4 draft
  shape (50/100 bonuses, duck, not-out, maiden, 5WI, continuous economy bonus,
  `second_innings_multiplier`) is **not** invented here — it needs `src/config/types.ts` and
  `src/engines/*` reshaped, which is D28's named engine slice and outside this slice's fences.
  Recorded as an open hypothesis below.
- **G10 not claimed.** Report says the gate moves when you run MANAGER_VERIFY §Season lock and
  sign step S9 off. Not before.

### Three defects found while reading, all fixed

1. **The empty-pool / partial-config refusal was illegible.** `avg()` over an empty pool is
   NULL → `jsonb_set` (strict) returns NULL → the UPDATE died on `seasons.config`'s NOT NULL
   with *"null value in column config"*. A true refusal that told the operator nothing. Same
   path for a config missing `squad.teamSize`. Both now name themselves.
2. **The preview could drift from the lock.** Fixed structurally rather than by discipline — see
   below.
3. **Lock-plus-config-edit in one statement** would have computed the cap from a team size no
   preview ever showed. Refused.

### The one design decision worth reading twice

`0008` factors the cap arithmetic into `app.season_pool_stats()` and the refusal into
`app.season_lock_blocker()`, and **both `public.season_lock_preview()` and
`enforce_season_lock()` call them**. The rehearsal panel is therefore not a mirror of the lock's
arithmetic that has to be kept honest — it *is* that arithmetic, run without the write. There is
no second implementation to drift, in TypeScript or anywhere else. `test/g10.lock-preview.test.ts`
proves the property directly across four hand-worked pools: the cap the preview **promises** is
the cap the lock **writes**, and the reason the preview gives for refusing is the exception the
lock raises, word for word.

---

## What changed

### Migration (one, `0008` — `0007` is C12's scorecard freeze, so this is the next free number)

- **`supabase/migrations/0008_season_lock_action.sql`** — append-only; `0002` is not edited and
  `enforce_season_lock()` is rebound by name via `CREATE OR REPLACE`, the same technique `0004`
  used for `enforce_round_lock()`, so the existing trigger picks up the new body.
  - `app.season_pool_stats(season, config)` — pool size, priced/unpriced, active/inactive, mean
    starting price, at-floor count, and the O3 cap. NULL-safe throughout.
  - `app.season_lock_blocker(season, config)` — the single source of both the preview's
    explanation and the trigger's exception text.
  - `enforce_season_lock()` rebound: same-statement config guard; legible blockers; cap computed
    via the shared function.
  - `app.enforce_player_removal()` + `trg_players_removal` — the pre-lock pool-removal rule.
    SECURITY DEFINER so it can clear a removed player's stale derived rows (a recompute leaves a
    seq-0 price seed for *every* player, so "has derived rows" must not be read as "has
    history") without granting managers write access to derived tables.
  - `app.log_registry_removal()` + `trg_players_removal_log`; `player_registry_events.event`
    CHECK widened to include `'delete'`.
  - `public.season_lock_preview(uuid)` — the RPC the settings page calls. In `public` because
    PostgREST exposes only that schema; SECURITY INVOKER; EXECUTE revoked from PUBLIC/anon.
  - **G11 improvement:** `0002` wrote the $100 rounding step as a literal
    (`/100 + 0.5) * 100`). It now reads `pricing.roundingIncrement`, so the lock path carries no
    economy constant at all. No verified number moves — the fixture's increment *is* $100, and
    `g10.cap-at-lock` still computes $115,700.

### Frontend

- **`app/routes/admin/AdminSettings.tsx`** (was a 6-line stub) — four panels: economy
  parameters; the pool; the rehearsal; fire. Post-lock the whole page becomes a read-only record
  with no unlock control, because there is no unlock.
- **`app/lib/seasonLock.ts`** (new, pure) — the config field descriptors (path + label +
  decision id + kind, and **no values**), path get/set, pre-flight validation, `LOCK_CATEGORIES`,
  the disable predicates, and `isArmed`. Deliberately contains **no cap arithmetic**.
- **`app/lib/seasonLockQueries.ts`** (new) — the preview RPC hook, `staleTime: 0`.
- **`app/lib/seasonLockMutations.ts`** (new) — `saveSeasonConfig`, `fireSeasonLock`,
  `removePlayerFromPool`, `explainLockError`. There is no `unlockSeason` export; the absence is
  the feature.
- **`app/routes/admin/AdminHome.tsx`** — three lines: the `/admin/settings` link replaces the
  comment at line 86 explaining why there wasn't one.
- **`app/routes/admin/AdminPlayers.tsx`** — a per-row **Remove…** control (pre-lock only), with
  its refusals surfaced through `explainLockError`.

### Tests (+48, all new files)

- **`test/g10.season-lock-action.test.ts`** — ten categories, each proved twice: the write
  **succeeds pre-lock** and is **refused post-lock**, as a **signed-in league manager** under
  RLS (`asAuthed`, `SET LOCAL ROLE authenticated` + JWT `sub`), not as the superuser the existing
  G10 files use. Both halves matter: a post-lock rejection proves nothing if the write was
  impossible all along. Plus the one-way door, the same-statement guard, and the C4 mid-season
  add that must still work. The case table is driven from `LOCK_CATEGORIES`, so a category added
  to the page without a proof fails the coverage assertion.
- **`test/g10.lock-preview.test.ts`** — preview ≡ lock across four hand-worked pools including
  the $x50 half-up boundary; every blocker named identically in both places; the empty-pool and
  missing-key refusals with the old NOT-NULL failure mode explicitly ruled out; the rounding
  step proved config-driven by moving it; and the pool-removal rules including the
  dismissal-string case that no foreign key guards.
- **`test/settings-ui.config-driven.test.ts`** — walks `LeagueConfig`'s own leaves and demands an
  exact two-way match with the page's field list (a config key added later cannot quietly become
  un-editable); proves no value is written in code by round-tripping two distinct economies
  through the page's own accessors from a deliberately scrambled base; proves an edit made the
  page's way reaches the recompute; and greps the migrations to confirm every trigger the freeze
  table names actually exists.

### Documents

- **`MANAGER_VERIFY.md`** — new appended section **"SEASON LOCK (S-D)"**, steps S0–S9, written
  against a scratch season. Step 9's `~~strikethrough~~` note now points at it. Existing S-A text
  is untouched (appended, not edited, to stay clear of a concurrent hand).
- **`REPORT_S-D_SEASON_LOCK.md`** — this file.

---

## What did NOT change

- **`src/engines/*` and `src/recompute/*` — byte-for-byte untouched.** Proof:
  `git diff -- src/engines src/recompute` prints **nothing**. G11's discipline holds: no economy
  constant entered either tree, and none left it.
- **`0002_locks.sql` — not edited.** The rebind is append-only in `0008`.
- **S-E's fenced files — untouched:** nothing under `/team`, no ladder or fixtures display
  component, no `vercel.json`, no `src/db/pgClient.ts`. `git status` lists eleven paths, all
  inside this slice's fences.
- **No DoD gate text changed.** DEFINITION_OF_DONE v1.2 remains FROZEN (Law 3).
- **No `ScoringConfig` reshape** (D28's slice), no photos, no transcription (G12), no C6–C10
  work (S-E's).
- **No round-lock, mid-match-lock or selection-validation behaviour** — 0002/0003 untouched
  beyond the named rebind.

---

## Artifacts, by name and fingerprint

| Artifact | Lines | sha1 (first 12) |
|---|---:|---|
| `supabase/migrations/0008_season_lock_action.sql` | 405 | `b6b19602d730` |
| `app/routes/admin/AdminSettings.tsx` | 711 | `93b92d435249` |
| `app/lib/seasonLock.ts` | 334 | `fd0c285aa187` |
| `app/lib/seasonLockQueries.ts` | 108 | `4577dd58acfa` |
| `app/lib/seasonLockMutations.ts` | 114 | `8c3d51dcc985` |
| `test/g10.season-lock-action.test.ts` | 271 | `38215a33f0c2` |
| `test/g10.lock-preview.test.ts` | 421 | `474a42ab01c0` |
| `test/settings-ui.config-driven.test.ts` | 285 | `553b25be0f9a` |

**Suite: 263 passed / 30 files** (base was 215 / 27 — +48, no existing test edited or skipped).
`npm run build` clean. `npm run typecheck` clean.

---

## Slice definition of done, item by item

| Slice DoD item | State | Evidence |
|---|---|---|
| Pre-lock: every economy parameter editable; a change propagates | **VERIFIED** | `settings-ui.config-driven` — two-way leaf coverage; `perRun` edit → recompute changes the score |
| Rehearsal preview shows the cap the lock computes, matching what it then computes | **VERIFIED** | `g10.lock-preview` — four pools, preview ≡ lock ≡ hand calculation. Structural: one function, two callers |
| Firing freezes all nine categories; each refused in UI **and** on a direct authenticated write, per category | **VERIFIED (db) / PARTIAL (ui)** | `g10.season-lock-action` — ten categories × {pre-lock succeeds, post-lock refused} as a signed-in manager, plus the UI predicate asserted beside each. **The rendering itself has no test** — this repo has no DOM harness — so the screens are operator-verified at MANAGER_VERIFY S8. Stated, not implied |
| Computed cap matches a hand calculation, half-up to $100 | **VERIFIED** | `g10.lock-preview` — the $x50 boundary case ($115,650 → $115,700) and three others |
| Fantasy-team registration refused post-lock (D21) | **VERIFIED** | `g10.season-lock-action`, category 10 (INSERT and DELETE) |
| An unpriced player blocks the lock | **VERIFIED** | `g10.lock-preview` — blocked, named, then unblocked by pricing them |
| MANAGER_VERIFY extended to close its blocked step 9 | **BUILT** | `MANAGER_VERIFY.md` §Season lock, S0–S9 |
| Build clean; typecheck clean; existing tests green | **VERIFIED** | 263/263; 215 base tests all still green |

---

## Gates moved

- **G10 SEASON_LOCK — NOT claimed as operator-action-verified.** Standing Rule 3 requires the
  artifact, and the artifact for an *operator* action is the operator performing it. What moved
  in-repo: the action now exists and is reachable; the preview and the lock provably share one
  arithmetic; and enforcement is proven **per category against a direct authenticated write**,
  which is stronger than the superuser-level proof that existed before. The gate's remaining
  half is MANAGER_VERIFY §Season lock step S9, signed off by you on a live project.
- **G11 CONFIG_ECONOMY** — not moved, but strengthened incidentally: the last economy constant
  in the lock path (the $100 rounding step) is now read from config, and
  `settings-ui.config-driven` mechanically forbids a value entering the settings layer.
- No other gate touched. DoD stays frozen.

---

## Open hypotheses

1. **O4's scoring shape is still unreachable from the settings page** — and lock day needs it.
   The page can edit `perRun`, `perFour`, the SR/economy threshold fields and so on, because
   that is what `ScoringConfig` carries. It cannot edit the 50/100 bonuses, duck, not-out,
   maiden, 5WI, the continuous economy bonus, or `second_innings_multiplier`, because those
   fields do not exist yet. **D28's engine slice must land before you lock the real season**, or
   you will freeze an economy that is not O4. This is the highest-consequence item in this
   report.
2. **C13's second half is untouched.** The unpriced player is now surfaced and blocking; the
   *"every player fell in the demo recompute"* question is not addressed here. If hypothesis
   (ii) in C13 is right — right-skewed scores mean most players fall most weeks — α (O7) is the
   pre-lock lever, and the settings page now makes moving it a one-minute job.
3. **The active/inactive split is a workflow signal, not a guard.** Nothing forces the operator
   to remove withdrawals before locking; the preview only shows the count. That is deliberate —
   an inactive player may be a legitimate registrant who is injured — but it means a careless
   lock can still freeze a cap computed over people who are not playing. The mitigation is
   MANAGER_VERIFY S4, i.e. procedure, not enforcement.
4. **Bundle is now 556 kB / 158 kB gzipped** (was 532 / 151). F4's code-split advisory is
   correspondingly slightly more pressing. Still advisory.
5. **Merge order with S-E is unproven** (Standing Rule 9e). Two green reports do not imply the
   merged result works; integration is B1's and the cold run's to prove. Contact surface is
   small: `AdminHome.tsx` (three lines) and `AdminPlayers.tsx` (one row control) are the only
   files this slice touched that S-E might also want.

---

## Next action

1. Apply `0008` on the live project and work MANAGER_VERIFY §Season lock **S1–S6 on a scratch
   season**. Do not fire S7 on the real season until item 1 under Open hypotheses is closed.
2. Correct C5 in the decision log per the plain read above.
3. Land D28's engine slice (O4 shape + second-innings multiplier), then re-read the settings
   page — the new keys appear automatically only if descriptors are added for them, and
   `settings-ui.config-driven` will fail loudly until they are. That failure is the reminder.

---

## Burn report

One session: read governance + the existing lock enforcement, found C5 overstated and three
defects in `0002`'s lock path, then built the operator-facing action (one migration, one page,
three lib modules, three test files, +48 tests) with the preview and the lock sharing a single
Postgres implementation so preview-matches-lock is structural rather than a matter of my
discipline.
