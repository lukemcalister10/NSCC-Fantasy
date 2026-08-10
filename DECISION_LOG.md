# DECISION LOG v2.0, 10/08/2026 (supersedes v1.9; delta = A11: selection materialisation D26; innings numbering semantics D27; second-innings multiplier deferred to a named engine slice D28; C2/C3/C4 closed; C5-C11 opened from the S-A/S-C reports and the live MANAGER_VERIFY run)
### Locked = operator-approved in spec sessions of 08/07/2026. Open items carry a
### DEFAULT (applies automatically at expiry unless overridden) and an EXPIRY.
### One batched decision sitting per session; no thread proceeds without naming
### which gate or definition-of-done item it moves.
### AMENDMENT NUMBERING NOTE (A9, 07/08/2026): A8 was issued against
### DEFINITION_OF_DONE v1.2 (gate G15) but was never recorded in this log, so
### v1.7's header understates the amendment count. A8 is therefore SPENT and this
### delta takes A9. No content is missing — G15 is intact in the DoD — but the
### gap is recorded here so a future reader does not reuse A8.

## LOCKED
- D1  Pricing formula: new = (1−α)·old + α·(score × $/pt). α 0.20, $/pt $1,000
      (A5's $500 halving SUPERSEDED by A6 — the operator's final scoring scale
      is ×1 integer, so no pairing adjustment is needed), round nearest $100,
      floor $9,000. Floor and α remain config (see O6/O7).
- D2  DNP = not named in lineup: 0 fantasy points, price frozen, match excluded
      from pricing history.
- D3  Played = named in the lineup of a finalised match. Price adjusts even on 0.
- D4  Starting prices (AMENDED A1, 08/07/2026, supersedes v1.0 phantom-game
      shrinkage): perf = $/pt × last-season per-match average; starting price =
      floor + (min(g,4)/4) × (perf − floor), where g = matches in lineup last
      season (same denominator as the average). g=0 → floor; g≥4 → full perf
      pricing; clamp at floor if perf < floor. Rounding convention (applies to
      ALL price arithmetic incl. D1): nearest $100, half rounds up.
      Hand-adjustable pre-season-lock only.
      RIDER (A9, 07/08/2026) — ECONOMY APPROXIMATION IN STARTING PRICES ONLY.
      D4's "last-season per-match average" is an average of FANTASY points, and
      the 25/26 source data (see D23) is season-aggregate, not per-match. Every
      O4 component is exactly recoverable from aggregates EXCEPT the economy
      bonus, which O4 defines per match with the fractional remainder discarded
      and a zero-clamp applied each game. Computed from season totals the two
      distortions run in opposite directions (per-match flooring pushes the true
      value DOWN, the per-match zero-clamp pushes it UP) and do not cancel
      predictably. Accepted, knowingly: the resulting bias is confined to 26/27
      STARTING prices, is material only for high-volume bowlers (e.g. 75 of
      Darke's 994 implied points, 73 of Kannan's 542), and is washed out by the
      D1 EMA within a few rounds. In-season scoring is unaffected — the engine
      computes the economy bonus per match per O4, as specified. If per-match
      25/26 data becomes available pre-lock, recomputing starting prices from it
      is preferred but not required.
- D5  Score at match completion; points land in the round containing the final day.
      No day-diffing of two-day matches.
- D6  Rounds are league-manager-defined containers with per-round lock datetimes
      (default Sat 11:00 Adelaide). Hybrid 1/2-week rounds crafted post-fixture.
- D7  Mid-match trade lock, BOTH directions (buy and sell), until match finalised
      and repriced. Rationale: day-1 information exploit is two-sided — buying
      known runs at stale prices and selling known failures pre-drop.
- D8  Cap ledger: cap remaining = starting cap − Σ purchase prices + Σ sale
      proceeds at time-of-sale price. TEAM VALUE (AMENDED A2, 09/07/2026) =
      cap remaining + Σ current prices of holdings (total franchise worth,
      per the operator's worked example frozen as Gate G2 — the gate is
      authoritative); Σ current prices alone is INVESTED VALUE. Both
      display-only; neither touches the cap. Trade-in at current price.
- D9  One role per player per season (BAT/WK/BWL/AR), frozen at season lock;
      WK-ELIGIBLE flag is the only dual eligibility. No DPP.
- D10 Captain ×2; VC inherits on captain DNP; both DNP = no double.
- D11 H2H repeated round-robin; ladder on wins, points-for tiebreak; bye scored
      against round median; separate overall-points leaderboard.
- D12 Scoring rules: single frozen config per season, no mid-season changes, no
      effective-date versioning. SR/economy bonuses gated by min-sample thresholds.
- D13 Economy parameters (team size, composition, cap, scoring values, trades,
      α, floor) live in config tables, tunable pre-lock, frozen by SEASON LOCK.
- D14 Data entry: manual form is v1 core; screenshot→LLM→review→commit is v1
      automation; LLM output never auto-commits. PlayHQ API import = V-NEXT;
      live webhooks out of scope (partner-tier).
- D15 Prime invariant: raw scorecards + config are sole truth; all derived state
      recomputable and never hand-edited (Gate G3).
- D16 Stack: Supabase (Postgres, magic-link auth, storage, RLS) + React/Vite on
      Vercel/Netlify. Manager role enforced in DB.
- D17 Data class INTERNAL (Law 11): auth-walled profiles and photos; club/parental
      consent for photos before upload; no public player pages.
- D18 Bye = round median (subsumed in D11). CLARIFIED A3, 09/07/2026: the median
      is taken over ALL fantasy teams' round scores that round, INCLUDING the
      bye team's own. Byes exist only at odd team counts, so this median is
      always a true integer middle value — no interpolation convention. Known
      consequence, accepted: the bye team wins only from the top half incl.
      itself (e.g. top 2 of 5), slightly harsher than a coin-flip matchup.

## LOCKED — SESSION RULINGS OF 09/07/2026 (A4)
- D19 Washouts/abandonment: 'abandoned' is a match_status. Abandoned matches
      produce no score rows and no price movements (all players DNP, prices
      frozen per D2), and RELEASE the D7 mid-match trade lock (enforcement
      lands in the locks slice). A round is active if it has ≥1 finalised or
      abandoned match; an all-abandoned round is active with all-zero totals →
      all pairings tie, bye ties vs median 0. A round with no entered matches
      does not exist for H2H/ladder/leaderboard purposes.
- D20 Ladder points: win 2 / tie 1 / loss 0 (ladder_points = 2·wins + ties).
      Structural convention, not economy config.
- D21 H2H fixtures are DERIVED, not stored: deterministic round-robin (circle
      method) over the sorted fantasy-team-id set; generateRound is exported so
      the UI renders upcoming fixtures by calling it, never by reading
      h2h_results. BINDING on the G10 slice: season lock freezes fantasy-team
      registration (fixture determinism requires a stable set). Accepted
      trade-off, recorded: no manual matchup adjustment, ever. Home/away labels
      come from circle orientation and never affect results.

## LOCKED — SESSION RULINGS OF 07/08/2026 (A9)
- D22 PLAYER NAME NORMALISATION. Player names are stored and matched in a
      normalised form. Normalisation, applied identically on registry write and
      on every inbound match attempt (manual entry, screenshot transcription,
      any future import): Unicode NFKC; curly apostrophes U+2018/U+2019 → ASCII
      apostrophe U+0027; curly double quotes U+201C/U+201D → U+0022; non-breaking
      space U+00A0 → space; collapse internal whitespace runs to one space; trim.
      Case and diacritics are PRESERVED (display fidelity; matching may fold case
      but must not fold diacritics into ASCII). Rationale: a spreadsheet
      round-trip silently rewrote "Adam O'Callaghan" from U+2019 to U+0027, which
      is exactly the G12 unresolved-name failure mode — and one that would recur
      every week, invisibly, against a registry storing the other form. The
      normalised form is canonical for storage; the raw source string is retained
      alongside transcription records for audit. This is a structural convention,
      not economy config, and is NOT frozen by season lock.
- D23 REGISTRY SEED PROVENANCE (26/27). The 25/26 club performance workbook
      (NSCC_25-26_Performance_Data.xlsx, 53 players, season-aggregate) is the
      confirmed calibration source for the economy: recomputation from it
      reproduces O3's illustrative mean starting price ($32,000) and O4's
      calibration split (BAT 45.2% / BOWL 43.1% / FIELD 11.7%) exactly, which is
      recorded here so the O4 balance figures are auditable rather than asserted.
      Derived from it, and edited by the operator on 27/07/2026, is the
      provisional registry seed: 53 players with role, wk_eligible, g, 25/26
      per-match fantasy average, and D4 starting price. Distribution after
      operator edits: BAT 21 / BWL 15 / AR 13 / WK 4, plus 1 wk_eligible.
      STATUS: PROVISIONAL. Roles and starting prices are hand-adjustable until
      season lock (D4, D9, D13); the 26/27 pool is a REGISTRATION list, not the
      25/26 performance list, so the seed is neither complete nor a superset.
      Two operator edits are recorded as deliberate and pending final
      confirmation at lock: Andrew de Roos carries NO wk_eligible flag despite a
      25/26 keeping appearance (he is the 3rd-priciest player; flagging him would
      materially widen WK supply), and Joshua Smythe carries wk_eligible with no
      25/26 keeping record (operator knowledge). KNOWN THINNESS, accepted:
      keeper supply is 4 WK + 1 wk_eligible, of whom only A. Castellano
      ($29,800) scores meaningfully — the WK slot is close to a forced pick.
      Widening wk_eligible when the 26/27 pool is finalised is the cheap remedy.

## LOCKED — OPERATOR RULINGS OF 07/08/2026 (A10)
- D24 SCORECARD FREEZE. A round's scorecards are amendable until the operator
      manually ENDS LOCKOUT for that round; from that moment they are FROZEN and
      no correction is made, even if an error is later discovered. Rationale
      (operator, verbatim in substance): once lockout ends, participants trade on
      prices derived from those scorecards, so a retrospective correction would
      change past match results with hindsight, move prices retrospectively, and
      potentially invalidate trades already made. The cost of a wrong scorecard
      standing is accepted as smaller than the cost of that cascade.
      THIS DOES NOT WEAKEN THE PRIME INVARIANT (D15). Derived state remains fully
      recomputable and byte-identical on re-run (G3); the policy governs whether
      RAW data may be edited, not whether derived state is derived. A frozen
      wrong scorecard recomputes to the same wrong answer every time, which is
      correct behaviour.
      CONSEQUENCE, recorded: purchase prices and cap balances can never be
      retrospectively invalidated, because the prices they were struck at can
      never move. No trade can go bad after the fact.
      ESCAPE HATCH: a frozen scorecard may be amended ONLY by a deliberate,
      logged operator override (who, when, why), for catastrophic errors such as
      an innings recorded against the wrong team. Frozen by default in policy and
      in the UI; overridable by explicit action, never silently.
- D25 DISMISSAL FIELDER IDENTIFICATION. Fielders named in dismissal strings are
      identified by the SAME canonical player identifier used for batting and
      bowling lines, resolved at entry time (D22 normalise → registry lookup).
      An unresolved fielder name BLOCKS the commit and is never guessed (G12
      discipline). If a scorecard genuinely does not name the catcher, no
      fielding credit is awarded — accepted, operator ruling.
      DEFECT THIS FIXES (found by the S-A builder, 07/08/2026): the scoring
      engine credits a fielder only when the token parsed from the dismissal
      string appears in the match lineup; lineups hold canonical player ids while
      the seeded dismissal strings held registry keys, so NO fielding credit
      landed through the database path. Every catch, stumping and run-out in the
      deployed demo scored zero — roughly 12% of all points (O4 calibration),
      silently. The engine is correct; the seam feeding it was untested.
      AUDIT CONSEQUENCE, binding on the cold acceptance run: G1 was verified
      against the ENGINE, not against the database path. The cold run must
      exercise the full path — scorecard entry → storage → recompute → displayed
      score — not the engine in isolation.

## LOCKED — OPERATOR RULINGS OF 10/08/2026 (A11)
- D26 SELECTION MATERIALISATION IS SERVER-SIDE AND AUTOMATIC. Operator ruling:
      "You shouldn't need to open the app. Your team can be set and forget and
      the trades are a choice. If you have a valid team at round 0, it's
      submitted; and carries over." Therefore:
      a. Selections and holdings are ONE AND THE SAME (no bench, no emergency —
         V-NEXT, intentionally). A participant's round selection set IS their
         holdings at that round's lock. There is no per-round selection choice
         and NO weekly confirm flow may be built.
      b. At each round's LOCK time, the database materialises every fantasy
         team's current holdings into that round's selection set, carrying
         captain and vice-captain forward from the previous round unless the
         participant changed them. Server-side (trigger or scheduled action);
         it MUST NOT depend on a participant opening the app.
      c. Lock is the correct moment, not round start: trades are legal until
         lock, so holdings-at-lock is the team that plays. This also keeps the
         selection set DERIVED rather than authored, consistent with D15.
      d. A participant who registers after a round's lock has no selections for
         that round and scores zero. Operator ruling: "registering after the
         lock means you miss the round." Accepted.
      e. The ONLY way to score zero is to hold nobody. Forgetting to act is not
         a failure mode that exists in this game.
      SUPERSEDES the client-side carry-forward built in S-C, which writes on
      app visit and therefore cannot cover a participant who never opens the
      app. That code is to be REMOVED when the trigger lands, not kept as a
      fallback — two writers of the same rows is how they diverge.
      DEFECT IT ALSO CLOSES (C7): the client-side attempt re-inserts already
      materialised rows on every load, tripping the unique constraint on
      (fantasy_team_id, round_id, player_id) and surfacing a server-refusal
      banner on /team. The refusal is correct; the attempt is not.
- D27 INNINGS NUMBERING SEMANTICS (binding on the engine slice). The `innings`
      integer added to batting_lines / bowling_lines / dismissals in migration
      0006 is the CLUB's own innings sequence (1, 2, …) — batting, bowling and
      dismissals sharing an index are the same phase of the match. It is NOT the
      ICC-style absolute four-innings numbering. This is precisely the grouping
      "their team's second innings" requires for the O4 multiplier. A future
      reader must not reinterpret it.
- D28 SECOND-INNINGS MULTIPLIER DEFERRED TO A NAMED ENGINE SLICE. The O4
      multiplier could not be built in S-A: scoreMatch (src/engines/scoring.ts)
      accumulates all lines into one flat per-player figure and
      orchestrator.buildCard flattens all lines into one card, so per-innings
      totalling cannot live outside the verified engine fences. S-A correctly
      stopped and reported rather than editing. Recorded so it cannot fall
      through the gap between sessions. The engine slice must:
      a. Produce the multiplier inside `base`, so captain doubling (D10) lands
         after the multiplier as the ruling requires.
      b. RE-RUN G1. The fixture config holds second_innings_multiplier = 1.0, so
         both hand-scored reference scorecards must come out BYTE-IDENTICAL. If
         G1 moves, the implementation is wrong — most likely by rounding per
         event or multiplying before summing.
      c. Close three type-contract gaps outside S-A's fences: RawScorecard
         (src/recompute/types.ts) has nowhere to carry `innings` (its dismissals
         are a bare string[]), and `not_out` / `maidens` exist in the database
         but are dropped in transit by repository.ts. Storage is sufficient; the
         type contract is not.
      d. Resolve the per-innings vs per-match bonus question (O4 sub-item). The
         S-A e2e test pins today's behaviour explicitly so the change is visible.

## OPEN — DEFAULTS APPLY AT EXPIRY
- O1 Trades per round (A7, 09/07/2026 — resolved to a contingency table, keyed
    on club teams entered, decided when nominations close): 3 club teams →
    2 trades/round; 4 or 5+ club teams → 3 trades/round. Non-banking (default
    stands, flippable pre-lock). EXPIRY: season lock (pick the row).
- O2 Team size & composition (A7 — contingency table; composition semantics
    are now ROLE MINIMUMS + TOTAL SIZE, with FLEX = the unconstrained remainder):
      3 club teams:  size 7  = BAT ≥3, BWL ≥2, AR ≥1, WK ≥1 (no flex)
      4 club teams:  size 9  = BAT ≥3, BWL ≥3, AR ≥1, WK ≥1, 1 flex
      5+ club teams: size 11 = BAT ≥4, BWL ≥4, AR ≥1, WK ≥1, 1 flex
    Strict role counting: a player fills only their own role's minimum (AR is
    never a BAT); flex is the only wildcard slot. WK minimum satisfiable by
    WK-role or wk_eligible players (D9). BUILD NOTE: LeagueConfig.squad
    composition type reshapes from exact counts to minimums+size BEFORE any
    selection-validation layer is built (cheap now, a migration later);
    composition enforcement is gated by G15 (DoD v1.2) and surfaced in the
    team/trade UI slice. EXPIRY: season lock (pick the row).
    FEASIBILITY CHECK (A9, against the D23 seed): all three rows are satisfiable
    from current supply (BAT 21 / BWL 15 / AR 13 / WK 4+1). Recorded consequence,
    not a blocker: at size 11 a team may hold at most 2 allrounders (AR ≥1 plus
    the single flex), and 5 of the 12 priciest players are ARs, so elite AR
    talent is structurally bottlenecked; at size 7 the minimums total exactly 7,
    so there is no flex at all and a team holds exactly 1 AR. If that
    concentration is unwanted, the AR minimum is the pre-lock lever.
- O3 Salary cap (A7): cap = team_size × MEAN STARTING PRICE across ALL players
    in the pool at season lock (i.e. 1.0×, no headroom — stars funded by
    basement filler; gun-concentration accepted as a knowing choice), computed
    BY the season-lock action itself (starting prices materialise at lock per
    Rider 3, so the mean is well-defined at that moment), rounded to nearest
    $100. ILLUSTRATION REFRESHED (A9) on the D23 seed (53 players, mean
    $31,998): size 7 → $224,000; size 9 → $288,000; size 11 → $352,000.
    These are ILLUSTRATIONS, not the cap: the cap is whatever the lock action
    computes over the actual 26/27 pool at that moment.
    POOL-COMPLETENESS WARNING (A9): unknown/newcomer registrants price at the
    D4 floor ($9,000) and therefore pull the mean — and the cap — DOWN. Locking
    on a pool skewed toward established performers yields a cap that is
    systematically too GENEROUS relative to the 1.0× intent (indicative: adding
    20 floor-priced players to the current 53 drops the mean to roughly $25,700
    and cap@11 to roughly $283,000 — a ~20% swing in purchasing power).
    MITIGATION, recommended: before firing season lock, enter expected
    registrants as floor-priced registry entries so the mean reflects the real
    pool. EXPIRY: season lock (computed).
- O4 Scoring values. OPERATOR-CHOSEN DRAFT (A6, 09/07/2026, supersedes the ×2
    scale): run 1, 50 bonus 10, 100 bonus 20, duck −5, not-out 5, four 1,
    six 3, wicket 19, maiden 1, 5WI 10, economy bonus = floor(max(0, 0.25 ×
    (balls bowled − runs conceded))) applied PER MATCH (fractional remainder
    discarded each game; no min-overs threshold; no penalty above 6/over),
    outfield catch 10, runout 15 (both kinds), WK catch 10, stumping 15. NO
    strike-rate bonuses. All per-event values integer; econ floor keeps match
    scores whole. Calibrated on 25/26 data: BAT 45.2% / BOWL 43.1% / FIELD
    11.7% (independently reproduced from source, A9 — see D23).
    SECOND-INNINGS MULTIPLIER (added A10, operator ruling 07/08/2026): in a
    match where a team bats and fields twice, everything a player earns in their
    team's SECOND innings (batting, bowling and fielding alike) is totalled,
    multiplied by second_innings_multiplier, rounded HALF UP to a whole number,
    and added to their first-innings total. ONE multiplication and ONE rounding
    per player per match — never per event — so match scores stay integers as O4
    requires. Captain/vice-captain doubling (D10) applies to the resulting MATCH
    total, after the halving. Config key: second_innings_multiplier, DEFAULT 1.0;
    the 26/27 season value is 0.5. It is config, not a constant (D13): the frozen
    FIXTURE config keeps 1.0, so gate G1 and all existing hand-computed reference
    scorecards are untouched. Known interaction, accepted: 25/26 starting prices
    (D23) were derived without the multiplier and are therefore slightly high for
    anyone who played two-innings matches — already covered by the D4/A9 rider,
    and washed out by the D1 EMA within a few rounds.
    OPEN SUB-ITEM for the scoring slice: per-innings vs per-match bonus
    semantics. With innings-keyed scorecard lines, any bonus O4 defines PER MATCH
    (currently the economy bonus) would be computed once per innings unless
    explicitly aggregated. This must be resolved BEFORE scoring values are locked.
    Still open until season lock. EXPIRY: season lock.
- O5 SR/economy thresholds — SUPERSEDED by O4 draft (09/07/2026): SR bonuses
    dropped; economy handled as the continuous per-run bonus inside O4. The
    threshold-style bonus fields remain in the scoring schema (config-driven,
    set to zero) for the fixture config and any future revival.
- O6 Price floor. LOCKED at $9,000 for now; flagged revisitable pre-lock.
- O7 α. LOCKED at 0.20 for now; flagged revisitable pre-lock.
- O8 Hybrid round map. Cannot decide until fixture release. DEFAULT if fixtures
    misbehave: pure weekly rounds + rely on D7 mid-match lock. EXPIRY: 1 week
    after fixture release.

## CARRIED-FORWARD BUILD ITEMS (not gates; scoped into named slices, A9)
These are known defects/gaps recorded so they survive seat rotation. None is a
DoD gate — DEFINITION_OF_DONE v1.2 remains FROZEN and UNCHANGED (Law 3).
- C1 CLOSED (S0, 07/08/2026). Recorded as a cosmetic ladder/leaderboard
     alignment issue; was in fact a CSS specificity defect — `.table thead th`
     (0,1,2) outranking `.col-num` (0,1,0) — affecting FOUR tables including both
     PlayerProfile tables. Fixed at `.table` level with one rule. Operator-verified
     on the deployed site.
- C2 CLOSED (S-C, 07/08/2026). Bye now renders on an odd-count dev seed and
     reconciles by hand against the ladder.
- C3 CLOSED (S-C, 07/08/2026). /team shows three distinct figures under three
     distinct labels; G2 reconciles on screen ($245,000 cap remaining + $755,000
     invested = $1,000,000 team value).
- C4 CLOSED (S-A, 07/08/2026). Mid-season add lands at the config floor, is
     logged by trigger, and leaves the cap untouched.

### Opened 10/08/2026 (A11) — from the S-A/S-C reports and the live
### MANAGER_VERIFY run. C5 is the largest and is its own slice.
- C5 SEASON LOCK IS UNBUILT. /admin/settings is still S0's stub and deliberately
     unlinked; the /admin dashboard offers registry, rounds, scorecards and
     recompute, and NO lock control. Nothing can go live without it: season lock
     freezes settings, scoring rules, starting prices, roles/wk_eligible, α,
     floor, $/pt, trades-per-round and fantasy-team registration (D21), and
     COMPUTES the salary cap (O3). It is a one-way door. G10 is currently
     verified against the enforcement layer, not against an operator-facing
     action — so MANAGER_VERIFY step 9 (post-lock refusal) is BLOCKED, not
     failed. → its own slice, before round 1.
- C6 SPA ROUTING 404. Any typed URL or page refresh returns Vercel's 404 rather
     than the app: Vercel looks for a file at the path and answers before the
     client router runs. Affects EVERY route, not just /admin, and has been true
     since the first deploy — unnoticed because every smoke test navigated by
     clicking. Participants bookmark, refresh and share links, so this bites in
     week one. Fix is a vercel.json rewrite of unmatched paths to index.html.
- C7 (subsumed by D26) Client-side selection materialisation re-inserts existing
     rows and surfaces a duplicate-key refusal banner on /team.
- C8 POSTGRES SSL CONFIGURATION. MANAGER_VERIFY specifies ?sslmode=require;
     against the Supabase pooler this fails with "self-signed certificate in
     certificate chain". ?sslmode=no-verify works and is the operator's current
     live setting. Traffic stays encrypted either way; only chain verification
     is skipped. Proper fix is SSL options configured in src/db/pgClient.ts
     (Supabase CA) rather than a URL parameter, plus MANAGER_VERIFY corrected to
     name the connection variant AND the working SSL setting.
- C9 RECOMPUTE LATENCY / TIMEOUT HANDLING. The first live recompute ran close to
     the serverless function timeout and the button appeared frozen with no
     progress or failure state. It eventually succeeded and reported G3
     idempotence correctly. Will worsen with a full season of data. Needs
     connection setup reviewed and the control to degrade honestly (progress,
     timeout, retry) rather than hang.
- C10 SCHEDULE-INDEX CONTRACT (reported by S-C, not patched — correctly). The UI
     derives fixtures with generateRound(teamIds, seq − 1); the engine settles
     them by the round's index among ACTIVE rounds. These coincide only while
     active rounds are contiguous from seq 1. D19 makes divergence reachable: a
     round with no entered matches does not exist for H2H. The fixtures page
     currently detects the disagreement and withholds the result rather than
     attaching it to the wrong pairing. This is a contract question between
     engine and display, NOT a display bug — resolve before round 1.
- C11 SEED EMITTER DRIFT — EVIDENCE FOR STANDING RULE 9e. Migration 0006 renamed
     dismissals.raw_text → resolved_text. S-A updated the shared seedSeason
     helper and its own emitter; S-C's dev emitter still wrote the old name.
     Every S-C test stayed green (they route through the helper) while the .sql
     file an operator would actually paste would have failed on its first
     INSERT. Two green reports, one broken artifact — caught only by the rebase.
     Fixed in S-C's rebase, with tests that apply the EMITTED FILES rather than
     the scenario object, and the test verified to fail when the old name is
     restored. CARRIED ACTION: audit whether anything else generates SQL or
     other artifacts that no test applies end-to-end.
- C12 MIGRATION NUMBERING. Photos were cut from S-A, so 0007 is the SCORECARD
     FREEZE, not photos. Earlier planning documents said 0007 = photos. The
     photo slice takes the next free number.
- C13 UNPRICED PLAYER / PRICE-DRIFT SANITY (operator check, not a defect). The
     live scratch season shows 65 players, 1 awaiting a price — worth finding.
     Separately, every player fell in the demo recompute. Two candidate causes:
     (i) demo seed prices and demo scorecard scores were never calibrated
     against each other, or (ii) the structural skew — a player holds price only
     by scoring price ÷ $/pt, and cricket scores are right-skewed, so MOST
     players fall MOST weeks while a few spike. (ii) is expected behaviour and
     self-corrects via the EMA, but it will alarm participants in week one and
     is the reason to revisit α (O7) before lock if it looks too sharp.

## FOLLOW-UPS NAMED BY BUILDERS (not V-NEXT; wanted before or soon after ship)
- F1 materialise_round_selections RPC. Named by S-C. Now largely superseded by
     D26's server-side trigger, which is the same fix done properly. The RPC
     also closes the last atomicity seam (ledger written, materialisation lost).
- F2 Scorecard save is not atomic (PostgREST gives a browser no transaction).
     Bounded by design — a match contributes nothing until finalised, and the
     form says so. If a half-saved card on a finalised match ever bites, the fix
     is an RPC. Named by S-A.
- F3 Ledger/selection reconciliation banner on /team is the current handling for
     the S-C atomicity gap. LEDGER IS AUTHORITATIVE when the two disagree.
- F4 Code-split /admin. The merged bundle trips Vite's 500 kB chunk warning
     (532 kB, 151 kB gzipped). Advisory only; cheap polish win.
- F5 Placeholder.tsx orphaning. Once every stub is replaced the file has no
     importer, and no single slice can safely delete it. → polish slice.

## V-NEXT (post-ship wishes land here, not in the build)
PlayHQ API import-then-review · live scores · trade banking variants · bench/
emergency mechanic · league chat/banter feed · multi-season history carryover ·
season selector (the app currently auto-picks the most-recent season row, which
is correct for one live season and a landmine for carryover).
