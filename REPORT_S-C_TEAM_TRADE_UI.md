# S-C — TEAM & TRADE UI (+ C2 bye render). Build report, Standing Rule §1.

State-stamp: as-of **07/08/2026** · base **`main @ e698c77`** (re-checked against GitHub per
Standing Rule 8 — main moved from the kickoff's `2c62759` to `e698c77` while this session was
reading; the branch was rebased onto it before any code was written) · builds against
**KICKOFF v1.3 / DEFINITION_OF_DONE v1.2 (FROZEN) / DECISION_LOG v1.9** · branch
`claude/team-trade-ui-seed-50cgyk`.

**This report is a separate file, deliberately.** Standing Rule §1 puts the report in
`README.md`, but S-A is running concurrently against the same `README.md`; two sessions
rewriting it is the one guaranteed merge conflict in this round (Rule 9c). Folding this into
`README.md` is a one-paste job for the operator at merge time.

---

## Plain read + operator decisions (read first)

- **Scope (kickoff):** surface the already-VERIFIED enforcement layer — G15 selection
  validation, G4 round lock, G6 mid-match lock, the cap ledger — in a participant-facing
  squad/trade UI, and render the bye (C2) at last. **Not** reimplement any of it. Client-side
  checks are UX; every rejection is also provable server-side.
- **NO MIGRATIONS WERE ADDED.** `supabase/migrations/` is byte-for-byte untouched, diff-proven
  below. Standing Rule 9a honoured in full. No schema change was needed: RLS (0004) already
  lets a participant write their own team's `selections` and `trades` from the anon client.
- **SCOPE CHANGE, applied as ruled — selections are not a separate concept.** There is no bench
  and no emergency mechanic, so a participant's round selection IS their holdings, always. No
  weekly "confirm your round-N squad" flow was built. Where the database needs selection rows
  to exist for its composition check, they are **materialised from the ledger**, with captaincy
  carried forward from the previous round unless changed. **This needed no schema change** — it
  is the same `selections` table, written from holdings instead of from a prompt. One honest
  limit falls out of the no-migration fence, recorded under open hypotheses: with no trigger or
  scheduled job available, materialisation runs from the client, so it writes into **every open
  round** on any visit rather than being guaranteed server-side.
- **Decision 1 (atomicity) — accepted as ruled.** Ledger-first ordering; **the ledger is
  authoritative** when the two disagree; a reconciliation banner on `/team` with one-click
  repair that rewrites selections to match the ledger, never the reverse. No client-side
  papering-over. The RPC is named as a follow-up below, **not** escalated to S-A.
  The operator's read was right: making selections derived from the ledger shrank this surface
  materially — the only non-atomic seam left is "ledger written, materialisation lost", which
  is exactly what the banner detects and repairs.
- **Decision 2 (team registration) — included.** Minimal, name-only, pre-lock only, with the
  D21/G10 freeze stated on screen.
- **Decision 3 (results overlay) — as approved.** The schedule stays derived via
  `generateRound`; results overlay from `h2h_results` on completed rounds only. If the two ever
  disagree the view **says so and withholds the result** rather than attaching it to the wrong
  fixture — it does not patch itself. (No disagreement occurs on the seeded scenario; the
  latent case is documented under open hypotheses.)
- **Decision 4 (fence edges) — as blessed.** New seed generator and new dev seed files only;
  `supabase/seed/seed_raw.sql` and `seed_derived.sql` diff-proven byte-identical. Playwright run
  via a scratchpad install, **no `package.json` dependency change**.
- **D25 taken into the seed.** A10's fielding defect is that dismissal-string tokens must be the
  canonical player id the lineup holds, or no fielding credit lands through the database path.
  The new dev seed is written that way and asserts non-zero fielding — so this slice's scenario
  exercises the seam D25 records rather than repeating the defect.
- **O4 second-innings multiplier: no effect on this slice, by construction.** Every score figure
  displayed (round totals, points-for, the bye median, ladder points) is read from the derived
  tables, never recomputed in the UI. When the multiplier lands in the scoring engine the
  figures change underneath these views with no code change here.

### THE FINDING THAT SHOULD REACH THE DECISION LOG — price-entering-round (Rider 2)

`orchestrator.ts:135` asserts that **`trades.price` equals the price the player carries
ENTERING the trade's round** — the last movement recorded in a round with `seq` strictly less
than the trade's round — and **throws** on mismatch. It is not the latest price in
`price_history`.

- **A trade written at the latest price does not fail at write time.** No trigger checks it.
  It fails later, at recompute, and it takes the whole season's recompute down with it — the
  prime invariant's "recompute from scratch" stops working until the bad row is found.
- **The two figures are equal in the ordinary case** and diverge only once a round contains a
  finalised match while that round is **still open**. That is not exotic: it is any round whose
  matches finalise before its lock time, which the demo seed already produces.
- **Implemented as directed:** `priceEnteringRound()` (`app/lib/squad.ts`) mirrors the
  orchestrator's walk exactly, and every buy and sell is struck at that value.
- **On the label** — my recommendation, for the operator's call: **keep "Current price"** as the
  kickoff specifies. It is the price you transact at, which is what a participant means by
  "current", and renaming it to something literal ("price entering Round 3") would be accurate
  and unusable. What the UI does instead is show a footnote **only when the two diverge**:
  *"Prices shown are the prices entering Round 1. A movement has already been recorded inside
  this round, so the most recent price on record differs — trades are struck, and validated, at
  the entering-round price."* Silent in the ordinary case, explicit in the case that would
  otherwise look like a bug to a participant watching a price move. If the operator would rather
  the column read "Trade price", that is a one-word change.
- The dev seed pins this: its round 1 is open **and** already contains a finalised match, so the
  divergent case is exercised on every render, and `test/c2-bye-display.test.ts` asserts the two
  readings genuinely differ.

---

## Build report

### What changed

**Read/derive layer (new)**
- `app/lib/squad.ts` — the client-side MIRROR of the database's own arithmetic: holdings from
  the ledger, cap remaining / invested value / team value (D8+A2, G2), the G15(a) composition
  check including STRICT no-double-count WK capacity, the G15(b) trade budget with the
  founding-build exemption, and `priceEnteringRound` (Rider 2). Carries **no economy constants**
  — every limit is read from the config passed in.
- `app/lib/teamQueries.ts` — `useLeagueConfig` (reads `seasons.config`, the same accessor the
  triggers use), rounds+matches, my team, ledger, selections, the pool priced two ways, the
  mid-match padlock set (via `scorecard_lineup` of `in_progress` matches — the same link the DB
  guard uses), and `h2h_results` for the C2 overlay.
- `app/lib/useTeamState.ts` — assembles the above once, so `/team` and `/team/trades` cannot
  drift apart.

**Write layer (new)**
- `app/lib/teamMutations.ts` — team registration; initial build (all founding buys in ONE
  request); a trade as an atomic **sell+buy pair** in one request; materialisation/reconciliation
  of selections from holdings; captaincy changes. Also `translateRefusal`, which names the
  failing constraint in plain English **and keeps the database's own message verbatim**, so a
  refusal is visibly server-side.

**Routes**
- `app/routes/Team.tsx` (replaces the S0 stub) — squad table (purchase price, current price,
  gain since bought), the three cap figures each **separately labelled** per D8/A2, composition
  progress against config minimums with flex shown as the remainder, captain/vice picker (D10),
  per-round lock banner with the real `lock_at`, mid-match padlocks with "match in progress",
  the reconciliation banner, and the initial-build flow.
- `app/routes/Trades.tsx` (replaces the S0 stub) — sell+buy pairing, trades used/remaining from
  config, both-direction mid-match padlocks, projected cap and post-trade composition, every
  blocker listed by name.
- `app/routes/Rounds.tsx` — results overlaid onto the derived schedule; bye shown as
  `points v median → W/L/T`; an explicit note that a bye is a game played; a visible warning if
  schedule and results ever disagree.
- `app/routes/Ladder.tsx` — a legend stating that P counts byes and Pts = 2×wins + ties (D20).
- `app/lib/queries.ts` — `useRounds` fixtures now carry team **ids** alongside names, so a
  result can be matched to its fixture. Additive; the schedule is still `generateRound` (D21).
- `app/styles/team.css` (new) — this slice's styles live in their own sheet, imported by the
  routes that use it, so nothing was added to the shared `components.css` a concurrent session
  may be editing (Rule 9c).

**C2 dev seed (new files only)**
- `scripts/oddSeasonScenario.ts` — the five-team scenario as data, shared by the generator and
  the test so the seed cannot drift from the test proving it. Built in **two passes**: pass 1
  learns the round-2 prices from the engine, pass 2 strikes the trade at exactly those values
  and runs the real recompute, which throws if they are wrong.
- `scripts/generate-seed-odd.ts` → `supabase/seed/dev/seed_odd_raw.sql` +
  `seed_odd_derived.sql`. `npm run seed:generate:odd`.

**Tests (new)**
- `test/team-ui.server-rejections.test.ts` (24) — every write shape the UI issues, replayed as a
  **direct database write by the signed-in participant** (`SET LOCAL ROLE authenticated` + JWT
  `sub`, one transaction, no bypass GUC).
- `test/team-ui.config-driven.test.ts` (9) — the same body against **two distinct economies**,
  sampling squads of size `teamSize−1/teamSize/teamSize+1` and asserting the client mirror
  reaches the **same verdict as the trigger** every time.
- `test/c2-bye-display.test.ts` (15) — the bye, the ladder reconciliation, schedule/result
  agreement, and the two seams (D25 fielding, Rider 2 pricing).

### What did NOT change

- **`src/engines/*`, `src/recompute/*`, `supabase/migrations/*` — byte-for-byte untouched.**
  Proof: `git diff -- src/engines src/recompute supabase/migrations` prints **nothing**.
- **`supabase/seed/seed_raw.sql` and `supabase/seed/seed_derived.sql` — byte-for-byte
  untouched.** Same proof, same result.
- **No route under `/admin` was touched**, and no admin file was opened for edit.
- `package.json` gained exactly one line: the `seed:generate:odd` script. **No dependency
  change** — Playwright ran from a scratchpad install.
- No service-role usage anywhere; the app still holds only the anon client.

### Artifacts by name + fingerprint (`git hash-object`, first 12)

| Artifact | Fingerprint | Lines |
|---|---|---|
| `app/lib/squad.ts` | `30fdb0a6fe24` | 359 |
| `app/lib/teamQueries.ts` | `79718954ff48` | 346 |
| `app/lib/teamMutations.ts` | `38947138ce09` | 453 |
| `app/lib/useTeamState.ts` | `b87ec99354e9` | 205 |
| `app/components/team/TeamChrome.tsx` | `88bae8241344` | 221 |
| `app/components/team/SquadPicker.tsx` | `11d69d11e5a0` | 217 |
| `app/routes/Team.tsx` | `d330a6eeb2cd` | 502 |
| `app/routes/Trades.tsx` | `b26b0d720f85` | 339 |
| `app/routes/Rounds.tsx` | `e0be96e22189` | 260 |
| `app/routes/Ladder.tsx` | `f6dc4f1a83d8` | 125 |
| `app/lib/queries.ts` | `0a5feac59817` | 389 |
| `app/styles/team.css` | `be3ed3360a61` | 304 |
| `scripts/oddSeasonScenario.ts` | `76cf6d65bfcf` | 336 |
| `scripts/generate-seed-odd.ts` | `80e01f440504` | 299 |
| `supabase/seed/dev/seed_odd_raw.sql` | `2e761cd561f8` | 209 |
| `supabase/seed/dev/seed_odd_derived.sql` | `281ffda0d2da` | 101 |
| `test/team-ui.server-rejections.test.ts` | `cdcc2ed8bb1f` | 465 |
| `test/team-ui.config-driven.test.ts` | `1072de5f9f87` | 280 |
| `test/c2-bye-display.test.ts` | `09d6126b9b4e` | 282 |

### Gates moved

**NONE**, as expected. G2 / G4 / G6 / G15 / G13 stay VERIFIED and untouched — this slice
surfaces them, it does not re-enforce them. DEFINITION_OF_DONE v1.2 remains FROZEN and
UNCHANGED. **141 tests green** (93 pre-existing + 48 new); `npm run typecheck` clean;
`npm run build` clean.

### Slice definition of done

| Item | Status | Verifying artifact |
|---|---|---|
| Participant builds an initial legal squad; illegal ones refused **with the failing constraint named** | **VERIFIED** | `Team.tsx` build flow; `translateRefusal`; render check |
| Valid squad passes | **VERIFIED** | server-rejections test |
| One short rejected | **VERIFIED** | server-rejections test |
| Minimums short rejected | **VERIFIED** | server-rejections test |
| WK satisfied by a `wk_eligible` non-WK passes | **VERIFIED** | server-rejections test |
| Strict no-double-count rejected | **VERIFIED** | server-rejections test |
| Trades at the limit pass, limit+1 rejected | **VERIFIED** | server-rejections test |
| Initial build consumes zero trades | **VERIFIED** | server-rejections test |
| Each rejection **also provable server-side**, bypassing the UI | **VERIFIED** | all 24 cases are direct DB writes as `authenticated` |
| Cap / team value / invested value reconcile by hand against G2 | **VERIFIED** | see worked reconciliation below |
| Bye renders correctly on an odd seed, **ladder and fixtures agreeing** | **VERIFIED** | C2 test + browser render, reconciled by hand below |
| Composition and trade limits follow config with **no code change** | **VERIFIED** | config-driven test, two economies |
| `npm run build` clean; typecheck clean; existing tests green | **VERIFIED** | 141/141 |

**G2 reconciliation, by hand, from the rendered page.** Adelaide Antics hold
150+120+110+140+105+130 = **$755,000** of purchases against the fixture cap of $1,000,000.
The page shows *Cap remaining* **$245,000** (= 1,000,000 − 755,000), *Invested value*
**$755,000** (Σ current prices alone), *Team value* **$1,000,000** (= 245,000 + 755,000).
The three are distinct figures under three distinct labels, which is the whole point of D8/A2 —
Σ current prices alone would have been the wrong number to call "team value".

**C2 reconciliation, by hand, ladder against fixtures.** Round 1: Adelaide BYE 382 v median 271
→ **W**; Brighton 105 – 306 Enfield; Croydon 48 – 271 Dulwich. Round 2: Adelaide 13 – 207
Brighton; Croydon BYE 249 v median 91 → **W**; Dulwich 81 – 91 Enfield. Ladder therefore:
Enfield 2W = **4 pts**, PF 306+91 = **397**; Adelaide 1W 1L = **2 pts**, PF 382+13 = **395**;
Dulwich 2, PF 352; Brighton 2, PF 312; Croydon 2, PF 297. Every row matches the rendered ladder
exactly, byes included, with Pts = 2×wins + ties (D20).

### Verification performed

- **Server-side rejection suite** — 24 direct-write cases as an authenticated participant
  through pglite with the real migrations applied.
- **Config-driven mirror sweep** — 36 sampled squads × 2 economies; client verdict === database
  verdict in every case, with both accepts and rejects exercised (a vacuous all-accept sweep
  would pass trivially, so that is asserted too).
- **Browser render** — the real built app, served, driven headless, with its Supabase calls
  answered by **real `recomputeSeason` output** from the odd scenario. 33 checks: cap labels and
  the G2 arithmetic on-screen, composition from config, the Rider-2 footnote, the trade pair
  summary, the bye and its median, the ladder legend and the byed team's 2 games played, and the
  D17 logged-out redirect on `/team`, `/team/trades`, `/rounds` and `/`. **Zero console or page
  errors.** Screenshots retained in the session scratchpad.
- **Fence proof** — `git diff` empty for engines, recompute, migrations and the existing seed pair.

### Open hypotheses

1. **Materialisation is client-side, and therefore best-effort.** Carry-forward writes into
   *every* open round on any visit, so one visit covers every round on the board — but a
   participant who never opens the app before a round they have never seen is not covered, and
   nothing server-side will do it for them. This is a direct consequence of the no-migration
   fence, not a design preference. **Named follow-up: a `materialise_round_selections` RPC (or a
   round-lock trigger) that does this in the database**, which would also close the last
   atomicity seam (Decision 1) by wrapping ledger + selections in one transaction. Not escalated
   to S-A, as directed.
2. **Latent schedule-index divergence.** The UI derives fixtures with `generateRound(teamIds,
   round.seq − 1)` while the engine settles them with the index of the round among *active*
   rounds. These coincide whenever active rounds are contiguous from seq 1 — true for both seeds
   — and diverge if an inactive round ever precedes an active one. Per the kickoff I did **not**
   patch the view: the fixtures page detects the disagreement and withholds the result with a
   visible notice. It is reported here rather than fixed because the fix is an engine/display
   contract question, not a display bug.
3. **Live-authed render is still operator-confirmed, not builder-confirmed.** The browser run
   uses real engine output but stubbed transport; no test-user credentials or DB secrets were
   provided (by design). Writing against a live Supabase instance is unproven in-repo.
4. **Registration assumes a provisioned `profiles` row.** A participant with no profile row gets
   a clear message pointing at the league manager, because RLS grants the client no INSERT on
   `profiles` — correct, but it means signup provisioning has to exist before registration works.
5. **Founding churn is uncounted by design** (0003's own note): while a team has no trade in any
   earlier round, changes of mind during the initial build consume no trades. The UI now says so
   explicitly rather than leaving it as a surprise.

### Next action

1. **Operator:** merge S-C, then apply `supabase/seed/dev/seed_odd_raw.sql` +
   `seed_odd_derived.sql` (replacing `__OWNER_A..E__`) to see the bye on the deployed site and
   close C2 by inspection.
2. **Operator decision:** the "Current price" label (recommendation: keep it, with the divergence
   footnote as built) and whether the Rider-2 finding should be written into the decision log.
3. **Follow-up slice:** the `materialise_round_selections` RPC — server-side carry-forward plus
   one-transaction trades.
4. Fold this report into `README.md` at merge time (kept separate to avoid an S-A conflict).

### Burn report

One session: read the three governance docs plus DECISION_LOG v1.9 and all four migrations
before writing anything; rebased onto the main that moved mid-session; built the squad/trade UI
against the existing enforcement layer with a client-side mirror of the database's own
arithmetic and zero economy constants; implemented holdings-derived selections per the operator's
scope change with no schema change; found and implemented the Rider-2 price-entering-round rule;
added an odd-team-count dev seed that renders the bye and exercises the D25 fielding seam; wrote
48 tests including a two-economy mirror sweep that caught one bug (in the test's own uuid
generator, not the mirror); drove the real app headless against real engine output. No
migrations, no engine changes, no admin routes, no dependency changes.
