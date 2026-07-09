# NSCC Fantasy Cricket — selection-validation slice (Gate G15)

Club fantasy cricket platform. Prior slices landed: the **computational engine core**
(scoring, pricing, cap ledger, starting price), the **Supabase schema + persistence +
recompute** layer, the **full derived chain** (team-round scoring, H2H, ladder,
overall leaderboard), **DB-level lock enforcement** (round lock G4, mid-match trade
lock G6, season lock G10 + mandatory-captain / starting-price riders), and the **A7
squad reshape + cap-at-lock** (composition typed as role minimums + size; cap computed
by the lock action). This slice implements **Gate G15** (DoD v1.2 amendment A8) — the
first **write-time validation of a team's selection set and its trades**:

1. **Selection composition / size / WK** enforced at commit as a DEFERRABLE constraint
   trigger on `selections` (same family as the mandatory-captain rider): count = `teamSize`;
   strict per-role `roleMinimums`; the WK minimum satisfiable by a WK-role OR a spare
   `wk_eligible` player, **no double-counting** (O2/A7/D9).
2. **Trade limits** enforced at commit on `trades`: sell+buy pairs per `(team, round)` ≤
   `tradesPerRound`, with **initial squad construction (no prior holdings) exempt from the
   count** but still cap- and composition-checked; plus the **first write-time salary-cap
   guard** (`cap_remaining ≥ 0` over the team ledger).
3. **Partial-config guard**: a config missing `squad.teamSize` / `roleMinimums` /
   `tradesPerRound` / `cap` fails **loudly** at validation time, never a silent pass.

The database stays the gatekeeper: both rules are triggers, un-bypassable by any client —
G15 has **no** escape hatch (unlike the round-lock's manager repair GUC).

State-stamp: as-of 2026-07-09 · builds against DEFINITION_OF_DONE **v1.2** /
DECISION_LOG v1.7 / KICKOFF **v1.2** · continues from `f57397b` (operator's v1.2 doc
upload) atop `6328ff3` (A7 reshape) · `src/engines/*` and `src/recompute/*` untouched
(diff-proven below).

## Plain read + operator decisions (read first)

- **Approved plan, both recommendations taken.** (B) **fixture expansion** (no new bypass
  GUC — keeps G15 genuinely un-bypassable), and (2) **strict, no-double-count WK counting**.
- **Rider 1 (honoured):** the G3 gate's hand-worked values are **byte-identical** after the
  expansion — `recompute.idempotence` was padded with **DNP** players (never in the match
  lineup → score 0), so totals (266 / 208), ladder, H2H and overall are unchanged. *Inputs
  expanded, zero expected-value change; no expectation moved.*
- **Rider 2 (honoured):** every rejection assertion matches its **specific** message —
  `/team size/`, `/role minimum/`, `/WK minimum/`, `/trades/`, `/cap/`, `/config missing/`
  (and the pre-existing `/locked/`, `/exactly one captain/`, `/unique/`). No bare throws.
- **Founding-round churn is uncounted BY DESIGN** — still bounded by the round lock (G4),
  still cap-checked, and its selections still composition-checked (recorded per approval).
- **Strict WK counting** rejects a squad where a `wk_eligible` player is needed to *meet* its
  own role minimum and therefore has no spare capacity to keep wicket (e.g. `{2 BAT(1 wke),
  2 BWL, 2 AR, 0 WK}` under the fixture) — a naive `count(WK OR wk_eligible)` would false-pass it.

## Build report (Standing Rule §1)

### What changed
- **`supabase/migrations/0003_selection_validation.sql`** (new) — two DEFERRABLE INITIALLY
  DEFERRED constraint triggers:
  - `enforce_selection_composition()` on `selections`: reads `seasons.config #>> '{squad,…}'`;
    partial-config guard first; skip when the set is empty; `n = teamSize`; strict BAT/BWL/AR
    minimums; WK capacity `= #WKrole + Σ_R min(#R − minR, #wke_in_R) ≥ minWK` (reserve each
    own-role minimum, then keepers come from WK-role players plus *surplus* wk_eligible).
  - `enforce_trade_limits()` on `trades`: trade count per `(team, round)` with the
    initial-construction exemption (`NOT EXISTS` a trade in any earlier `rounds.seq`); salary
    cap `starting_cap − (Σ buy.price − Σ sell.price) ≥ 0` over the whole team ledger.
- **`test/g15.selection-validation.test.ts`** (new) — 12-case pglite gate, hand-worked
  doc-comment, direct-write accept/reject with specific-message assertions.
- **`test/recompute.idempotence.test.ts`** — both fantasy teams padded to legal 6-player
  squads with DNP players; **all G3 expected values unchanged** (verified byte-identical).
- **`test/mandatory-captain.test.ts`**, **`test/g4.lock-enforcement.test.ts`** — seed legal
  fixture squads where a selection write must succeed; rejection cases unchanged (they fire on
  the immediate `BEFORE` round-lock / unique-index guard, before any deferred check).

### What did NOT change
- **`src/engines/*` and `src/recompute/*` — byte-for-byte untouched.** Zero-change proof:
  `git diff -- src/engines src/recompute` prints **nothing**. All enforcement is SQL triggers;
  the reshaped `roleMinimums`/`teamSize`/`tradesPerRound`/`cap` are read from the config jsonb
  in the DB, never in engine code (G11).
- No new bypass GUC (Path B); no React UI, no RLS/auth (G13), no transcription (G12).

### Artifacts (by name)
- Enforcement: `supabase/migrations/0003_selection_validation.sql`
  (`enforce_selection_composition`, `enforce_trade_limits`).
- Gate test: `test/g15.selection-validation.test.ts` (valid squad passes; size-short rejected;
  minimums-short rejected; WK-via-`wk_eligible` passes; strict-count double-use rejected; initial
  full-squad build = 0 trades; trades at limit pass / limit+1 rejected; over-cap buy rejected /
  within-cap passes; partial-config rejected loudly).
- Fixture expansions: `test/recompute.idempotence.test.ts` (DNP-padded, arithmetic preserved),
  `test/mandatory-captain.test.ts`, `test/g4.lock-enforcement.test.ts`.

### Gates moved (PROPOSED → DERIVED → BUILT → VERIFIED)
- **G15 SELECTION_VALIDATION** → **VERIFIED** by `test/g15.selection-validation.test.ts`
  (all DoD case-list items green as direct-write accept/reject). Closes the A7 open hypothesis
  "composition minimums are unenforced".
- **G3 RECOMPUTE_IDEMPOTENCE stays VERIFIED** — inputs expanded to legal squads via DNP
  padding, every expected value byte-identical.
- **G4 / Rider 1 (mandatory captain) stay VERIFIED** — reseeded with legal squads; the lock /
  captain / unique guards fire exactly as before.
- Still VERIFIED: G1–G2, G5–G11, G14 + Riders 1/3. **82 tests green** (was 70).

### Open hypotheses
- **Selections vs holdings are not cross-checked.** Composition validates `selections`; the cap
  and trade count validate `trades`. Nothing yet asserts a team's selection set equals its
  holdings — a later slice (or the app layer) may add that tie.
- **Trade count = number of buys** (trade-ins) per `(team, round)`. With size enforced at
  `teamSize`, a non-founding round's buys and sells balance, so counting buys is faithful; a
  sell-only "trade" is not counted against the limit (non-banking, O1 default).
- **Cap read from `squad.cap` at write time.** Pre-lock this is the tunable placeholder; post-lock
  the cap-at-lock value. Both are guarded; a config lacking `cap` fails loudly.

### Next action / next slices
1. **Auth/RLS (G13)** and **transcription guardrail (G12)** — both want real Supabase.
2. **React/Vite app** and baseline **B1** (full round ≤ 30 min operator time), incl. friendlier
   app-level echoes of these DB guards.

### Burn report
One session: added `0003_selection_validation.sql` (two DEFERRABLE constraint triggers —
composition/size/strict-WK on `selections`, trade-count-with-founding-exemption + write-time
salary cap on `trades`, plus a loud partial-config guard); added the 12-case G15 gate; expanded
three pre-existing DB fixtures to legal squads (G3 via DNP padding, arithmetic byte-identical).
No bypass — G15 is un-bypassable. Engines and recompute untouched (diff-proven). 70 → 82 tests
green; typecheck clean.

## Run it

```bash
npm install
npm test          # vitest run — the gate suite (82 tests, incl. pglite-backed G3 + G15)
npm run typecheck # tsc --noEmit
```

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED
requires the named gate and its verifying artifact. APPROVED is the operator's.
