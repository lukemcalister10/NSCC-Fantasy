# REPORT — S-F ENGINE SLICE (O4 shape · D28 multiplier · D29 fixture index · D26 materialisation)

STATE-STAMP. Base: `main @ 672f749` (verified against GitHub at session start, per
Standing Rule 8; not inherited from the kickoff text). Branch:
`claude/engine-scoringconfig-o4-wxqkb9`. As-of 10/08/2026. Governance read in
full: KICKOFF v1.3, DEFINITION_OF_DONE v1.2 (FROZEN), DECISION_LOG v2.1.
Supersedes nothing; this is the first S-F report.

---

## PLAIN READ

The engine was in better shape than the kickoff's worst case, and one fact
determined the whole approach: **both G1 reference scorecards are single-innings
cards** — one batting line and one bowling line per player. Everything this slice
opened (per-innings vs per-match bonuses, the second-innings multiplier) is
therefore *structurally* incapable of touching G1, provided the new config keys
are neutral in the fixture config and the new line fields are optional. That is
how G1 is reported unmoved with the strongest evidence available: the gate's own
artifact and its expectations are **byte-for-byte untouched**, not merely
re-run green.

Three findings changed what got built:

1. **`base` was a promise the multiplier breaks.** `player_match_scores` stored
   five columns where `base` was the sum of the other four. Multiplying one
   innings falsifies that. The operator ruled: spend the column. Migration 0009
   stores the multiplier's whole effect as one auditable term.
2. **The client-side carry-forward lived in TWO places, not one.** S-E's spec
   reduced its removal to a single effect in `Team.tsx`. There was a second
   writer inside `Trades.tsx`, materialising every open round after each trade
   pair. Removing only the first would have left the exact two-writer divergence
   D26 forbids. Both are gone.
3. **D26's trigger tightens G15, on purpose, and the tightening is load-bearing.**
   Because holdings *are* the selection set, composition is now judged on every
   write that touches the ledger. A lone buy leaving a one-player team is refused
   at trade time — A12's decisive argument for the eager design, now a stated
   property rather than an emergent surprise.

## OPERATOR DECISIONS TAKEN THIS SESSION (for the DECISION_LOG)

Four rulings were made mid-slice and are recorded here so the log can absorb them:

- **O4 milestone bonuses are EXCLUSIVE.** A century scores `perCentury` alone —
  20, not 10 + 20. O4 lists the two as separate lines, which reads as cumulative
  unless someone says otherwise. Pinned in `test/o4.scoring-shape.test.ts`,
  including an explicit `.not.toBe(130)`.
- **O4's open per-innings/per-match sub-item is RESOLVED: per innings.**
  Operator, verbatim: "Each innings a separate instance, and then those two
  values added to the match score like all are." The economy bonus is floored and
  zero-clamped per innings and, being earned *in* an innings, is multiplied along
  with everything else in it. No component is exempt. **The builder's escalated
  concern disappears with it** — no bowler keeps a full economy bonus while their
  wickets are halved.
- **`second_innings_adjustment` is a stored component** (migration 0009), not a
  silent fold into `base`.
- **The player-page breakdown was fixed in-slice**, not deferred, so the screen
  does not start lying the moment the season locks at 0.5.

---

## WHAT CHANGED

### 1. ScoringConfig reshaped to O4 — BUILT, VERIFIED
`perFifty`, `perCentury`, `perDuck`, `perNotOut`, `perMaiden`,
`perFiveWicketHaul`, `econBonusPerNetBall`, `secondInningsMultiplier`. All
config, no constants (D13/G11). O5's threshold SR/economy fields are retained at
zero exactly as O5 specifies, not deleted.

In the **FROZEN fixture config** every new key is 0, and the multiplier is 1.0 —
so every frozen gate number is multiplied by 1 or added to 0. `/admin/settings`
gained a descriptor per key (the designed failure of
`settings-ui.config-driven.test.ts` fired as intended and was satisfied by adding
descriptors, not by weakening the test), plus a `signed` flag so the pre-flight
validator stops refusing O4's own −5 duck.

### 2. D28 second-innings multiplier — BUILT, VERIFIED
```
base = firstInningsEarnings + round_half_up(secondInningsEarnings × m)
```
ONE multiplication, ONE rounding, per player per match, producing `base` so
captain doubling (D10) lands after it. `innings ≥ 2` is the multiplied bucket;
lines carrying no innings are innings 1 (D27 — the club's own sequence).

**THE HAND-WORKED CASE** (season O4 values, m = 0.5, player is captain), so the
arithmetic can be checked without reading code:

| | innings 1 | innings 2 |
|---|---|---|
| batting | 62 runs + 10 fifty + 7 fours + 3 six = **82** | 16 + 2 fours + 5 not-out = **23** |
| bowling | 2 wkt × 19 + 1 maiden = **39** | 1 wkt × 19 = **19** |
| fielding | 1 outfield catch = **10** | 1 run-out = **15** |
| economy (per innings) | floor(0.25 × (48 − 22)) = floor(6.5) = **6** | floor(0.25 × (30 − 19)) = floor(2.75) = **2** |
| **innings total** | **137** | **59** |

- ONE multiplication, ONE rounding: `59 × 0.5 = 29.5 → 30` (half **up**)
- `second_innings_adjustment = 30 − 59 = −29`
- `base = 137 + 59 − 29 = **167**` (equivalently 137 + 30)
- captain ×2 → `total = **334**`, applied to `base`, i.e. **after** the multiplier

The rounding boundary is deliberate. Halving and rounding each component
separately would give 12 + 10 + 8 + 1 = **31**, not 30 — one point, every
two-innings match, forever. That difference is asserted directly.

### 3. Three type-contract gaps closed — BUILT, VERIFIED
`RawBattingLine` gains `innings` + `notOut`; `RawBowlingLine` gains `innings` +
`maidens`; `RawScorecard.dismissals` became `{innings, text}[]` instead of a bare
`string[]`. `repository.ts` stopped dropping `not_out` and `maidens` in transit.
Required in the raw contract (the columns are NOT NULL), optional on the engine's
input types — which is what leaves the G1 fixture untouched.

The seed emitters and the pglite helper now write **every 0006 column
explicitly** rather than relying on DEFAULTs. That is the C11 lesson applied: the
emitted `.sql` is what the operator pastes, and a seed leaning on defaults drifts
from the scenario object with every test still green.

### 4. D29 fixture index — BUILT, VERIFIED
`computeH2hResults` takes `{id, seq}` and indexes on `seq − 1`;
`orchestrator.ts` is the only call site; `generateRound` is unchanged (its own
doc already specified `seq − 1`).

**Control run performed.** With the positional rule restored, `test/d29` fails on
exactly the retroactive-rewrite assertions **while G9 stays green** — which is
precisely why the defect survived this long. Fix restored, both green.

### 5. D26 materialisation — BUILT, VERIFIED (migration 0010)
`app.materialise_selections(team, round)`, SECURITY DEFINER: open rounds only
(so the set freezes at lock and D26(d) falls out), holdings replayed from the
ledger with the same ordering as `holdingsFromLedger` and the orchestrator,
captaincy carried forward in `resolveCaptaincy`'s exact preference order,
DELETE-then-INSERT to sidestep the captain partial-unique index mid-statement.

Three trigger points as ruled, **plus a one-time backfill** — without it the live
scratch season's existing holdings and rounds would sit unmaterialised until
somebody happened to trade, with the client writer already deleted.

**Statement-level, not row-level**, and this was a real finding: the app writes a
squad (`buildInitialSquad`) and a trade pair (`executeTradePair`) as single
inserts. Per-row firing materialises from half-built ledger states, and because
"this round's existing flags win" is the first carry-forward rule, the captaincy
derived from a one-player intermediate state then *sticks*. Per statement, the
function only ever sees a finished ledger.

Removed: the `Team.tsx` effect, the second writer in `Trades.tsx`, and C7's
`isAlreadyMaterialised` duplicate-key tolerance (its cause is gone; a helper that
swallows a unique-constraint refusal is exactly what should not be left lying
around). The `/team` repair control now calls a new
`public.materialise_selections(round)` RPC — own team or manager only — which
**closes follow-up F1** and leaves exactly one piece of code in the system that
writes a selection set.

### 6. The tightening D26 brings — BUILT, VERIFIED, and STATED
Composition is now judged at trade time. `test/g15` gains five cases asserting it
outright: a lone buy leaving one player, a buy taking a squad to seven, a lone
sell leaving five, the paired sell+buy the UI actually writes, and a pair that
keeps the size right but breaks a role minimum.

Six gate test files wrote lone trades as a convenience and now write complete
builds or pairs — which is what the UI issues anyway. Two incidental improvements
fell out: `team-ui`'s over-the-limit case was passing on whichever deferred guard
happened to raise first, and now the composition guard is satisfied so only the
trade-count guard can speak; and G4's repair-hatch case is written as a genuine
swap rather than relying on a uuid tiebreak between a same-player sell and buy.

## WHAT DID **NOT** CHANGE

- `src/fixtures/reference-scorecards.ts` — **`git diff` EMPTY**
- `test/scoring.test.ts` (G1 expectations) — **`git diff` EMPTY**
- `test/g11.config-economy.test.ts` (G11 expectations) — **`git diff` EMPTY**
- `test/g9.h2h-bye-ladder.test.ts` — input shape only; not one expectation moved
- `test/sa.scorecard-innings-e2e.test.ts:217`'s `bonuses === 10` pin — **stands
  unmoved**, because the per-innings ruling preserves exactly what the code did
- Migrations 0001–0008 — untouched; 0009 and 0010 are append-only
- Photos, transcription (G12), any new participant-facing feature — out of scope
- S-C's fixture disagreement banner — now dead code (D29 makes the two
  derivations the same derivation), **left in place**: it is not this slice's
  file, and the kickoff asked that it be reported rather than necessarily removed

## ARTIFACTS

| Artifact | Fingerprint / evidence |
|---|---|
| `supabase/migrations/0009_second_innings_adjustment.sql` | new column, DEFAULT 0, NOT NULL |
| `supabase/migrations/0010_selection_materialisation.sql` | 2 app functions, 3 triggers, backfill, 1 public RPC |
| `test/o4.scoring-shape.test.ts` | 19 cases; O4 hand-scored incl. the worked example |
| `test/d28.second-innings-e2e.test.ts` | 10 cases; DB path, G3 two-innings, G11 on new keys |
| `test/d29.fixture-index.test.ts` | 6 cases; fails on the old rule (control run performed) |
| `test/d26.selection-materialisation.test.ts` | 10 cases; never-opens-the-app, under RLS |
| `test/fixtures/o4-config.ts` | O4's actual draft values as a test economy |
| Seed regeneration | **mechanically verified additive** — undoing this slice's column/config additions reproduces all four committed `.sql` files exactly; no derived number moved |
| Commit | `5d587fc` on `claude/engine-scoringconfig-o4-wxqkb9` |

## GATES MOVED

| Gate | Status | Basis |
|---|---|---|
| **G1** | VERIFIED, **UNMOVED** | Green with fixture + expectations byte-identical (`git diff` empty on both) |
| **G3** | VERIFIED | Idempotence green, incl. a two-innings case through storage with a 0.5 multiplier |
| **G9** | VERIFIED, **UNMOVED byte-identically** | seq 1 → index 0 either way; only the input shape changed |
| **G11** | VERIFIED, extended | Existing expectations untouched; new keys proven config-driven via DB-stored config edits |
| **G5, G7, G8, G14** | VERIFIED, unmoved | Re-run green |
| **G15** | VERIFIED, strengthened | +5 cases pinning the trade-time composition check |
| **G4, G6, G13** | VERIFIED | Re-run green against complete-squad / paired writes |
| **G10** | unchanged | Still awaiting the operator's live MANAGER_VERIFY S9 sign-off |
| G2, G12, B1 | untouched by this slice | |

Full suite: **348 passed** (263 at base, +85). `npm run build` clean. Typecheck
clean on both projects.

## OPEN HYPOTHESES / THINGS THE OPERATOR SHOULD KNOW

1. **The tightening is a behaviour change for participants.** After this lands, a
   trade transaction must leave a legal squad. No UI path breaks (both writers
   send complete sets), but a participant cannot build a squad incrementally
   across separate requests. Believed correct and intended (A12); flagged because
   it is participant-visible.
2. **`app.current_price` reads derived state** (`price_history`) for the
   "dearest holding" captaincy tie-break only. It never touches cap arithmetic —
   the ledger's price-at-time remains authoritative (D8). Called only when a team
   has no captaincy history at all.
3. **A degenerate ledger case is order-dependent**: a sell and a buy of the *same
   player* in one statement share `created_at`, so the random uuid decides which
   wins. Not reachable through the UI (pairs always name two different players),
   and the client's `holdingsFromLedger` has the identical property, so the two
   agree. Recorded, not fixed.
4. **F4 still stands**: the bundle is 560 kB (up from 532 kB). Advisory.
5. **G1's audit consequence (D25) is unchanged** and still binding on the cold
   run: the full path — entry → storage → recompute → displayed score — must be
   exercised, not the engine in isolation. `test/d28.second-innings-e2e.test.ts`
   now does this for the multiplier specifically.

## NEXT ACTION

The ENGINE-SLICE PRECONDITION is satisfied: the O4 shape, the D28 multiplier, the
D29 fixture index and D26's trigger have all landed. **The ordering the operator
set now permits season lock** — after the registration list, roles and prices are
final, and after the four rulings above are absorbed into the DECISION_LOG.

Before firing the lock on the real season, the operator still owes themselves:
the O3 pool-completeness mitigation (enter expected registrants as floor-priced
entries so the mean reflects the real pool), the O1/O2 contingency rows once
nominations close, and MANAGER_VERIFY S0–S9 for G10.

## BURN REPORT

One session, plan-first with an explicit stop for approval; four operator rulings
resolved mid-slice; two migrations; +85 tests; no gate adjusted to fit code, and
one control run performed specifically to prove a new test can fail.
