# NSCC Fantasy Cricket — engine core

Club fantasy cricket platform. This slice is the **computational engine core**:
the three engines (scoring, pricing, cap ledger) plus starting-price, built
config-driven per THE PRIME INVARIANT and verified against the frozen gates that
are pure logic. Stack/UI gates (Supabase auth, server-side lock enforcement,
season lock) come next and are not in this slice.

State-stamp: as-of 2026-07-08 · builds against DEFINITION_OF_DONE v1.1 /
DECISION_LOG v1.1 / KICKOFF v1.1 · supersedes nothing (first commit).

## Build report (Standing Rule §1)

### Operator decisions needed (read first)
1. **G2 "team value" definition.** DECISION_LOG D8 says *team value = Σ current
   prices*, but the frozen worked example G2 requires **$1,050,000** with cap
   remaining **$50,000** after one holding rises 100k→150k on $950,000 of
   purchases. Σ current prices alone is $1,000,000 there; only
   `cap_remaining + Σ current prices` reproduces $1,050,000. Implemented team
   value as the portfolio (cash + holdings) to satisfy the frozen gate;
   `investedValue()` still returns the D8-literal Σ-current figure. **Confirm or
   veto.** (`src/engines/capLedger.ts`)

### What changed
- New TypeScript engine core (Node 22, Vitest). Config-driven: every parameter
  reads from a `LeagueConfig`; the FIXTURE CONFIG is the only economy wired up.
- Engines: `scoring` (D10 captaincy, SR/economy bonuses, dismissal-string
  fielding), `pricing` (D1 EMA + floor + sequential movements), `startingPrice`
  (D4/A1 floor→performance interpolation), `capLedger` (D8), `rounding` (D4).
- Two hand-scored reference scorecards + full gate test suite (26 tests).

### What did NOT change / is NOT built yet
- No Supabase schema, no RLS, no React UI, no scorecard-entry form, no
  screenshot→LLM transcription. Gates **G3, G4, G6, G9, G10, G11, G12, G13, B1**
  are not addressed by this slice (they need the stack and/or operator
  O-decisions). Season economy values (O1–O5) remain deferred; schema is ready.

### Artifacts (by name)
- `src/config/{types,fixture}.ts` — config schema + FIXTURE CONFIG.
- `src/engines/{rounding,scoring,dismissal,pricing,startingPrice,capLedger}.ts`.
- `src/fixtures/reference-scorecards.ts` — G1 reference data.
- `test/{scoring,pricing,startingPrice,capLedger,rounding}.test.ts`.

### Gates moved (PROPOSED → DERIVED → BUILT → VERIFIED)
VERIFIED (green, fixture config, via named tests):
- **G1** REFERENCE_SCORECARD — `test/scoring.test.ts` (both cards; 9-ball SR-200
  edge; SR-exactly-150 and econ-≤3.0 boundaries).
- **G2** CAP_LEDGER — `test/capLedger.test.ts` (worked example, price-at-time).
- **G5** DNP_PRICE_FREEZE — `test/pricing.test.ts` ($60k→$48k; DNP excluded).
- **G7** PRICE_FORMULA — `test/pricing.test.ts` ($60k→$68k; rounding; floor;
  two sequential movements).
- **G8** CAPTAINCY — `test/scoring.test.ts` (VC inheritance; both-DNP no double).
- **G14** STARTING_PRICE — `test/startingPrice.test.ts` (22/35/48/61k; g caps at
  4; zero-history and low-average floor clamps; $x50 rounds up).

### Open hypotheses
- Economy bonus threshold "≥ 3 overs" read as ≥ 18 balls; SR/econ boundaries
  treated as inclusive (≥150, ≤3.0) — matches O5 wording, confirm at lock.
- `oversToBalls` reads `3.4` as 3 overs 4 balls (standard notation).

### Next action
- Stand up Supabase schema (raw scorecards, config tables, derived-state tables)
  so recompute-idempotence (G3) and server-side lock/season-lock (G4/G6/G10) can
  be built. Smallest next slice: one round persisted + recompute byte-identical.

### Burn report
One session: engine core + gate suite from empty repo; 26 tests green; 6 of 14
gates VERIFIED at fixture config; no stack code yet.

## Run it

```bash
npm install
npm test          # vitest run — the gate suite
npm run typecheck # tsc --noEmit
```

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED
requires the named gate and its verifying artifact. APPROVED is the operator's.
