# DECISION LOG v1.8, 07/08/2026 (supersedes v1.7; delta = A9: name-normalisation rule D22; registry-seed provenance D23; Rider on D4 starting-price economy approximation; O2/O3 illustrations refreshed against the real 25/26 pool)
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
- C1 Ladder column alignment: table headers left-aligned against right-aligned
     numeric cells on the ladder/leaderboard. Cosmetic, flagship view. → polish slice.
- C2 BYE ROW HAS NEVER RENDERED. G9 (bye = round median) is VERIFIED at the
     engine level, but every demo/seed scenario has run an even fantasy-team
     count, so no bye row has ever been displayed. At an odd participant count
     — likely, given 10–30 expected — every round produces a bye team whose
     ladder row must show P, PF and ladder points sensibly against a
     median-scored non-fixture, and whose fixture list must render "BYE" rather
     than an opponent. Display path is UNTESTED. → team/trade UI or polish slice,
     with an odd-count seed scenario.
- C3 Team value vs invested value labelling (D8/A2) has no surface yet — no view
     currently displays either figure. First appears in the team/trade UI; the
     figure shown must be labelled per D8 (team value = cap remaining + Σ current
     prices; Σ current prices alone = invested value). → team/trade UI slice.
- C4 Mid-season player addition (KICKOFF: manager adds, price defaults to floor,
     logged) is specified but has no UI. Cap is unaffected (fixed at lock).
     → manager-core slice.

## V-NEXT (post-ship wishes land here, not in the build)
PlayHQ API import-then-review · live scores · trade banking variants · bench/
emergency mechanic · league chat/banter feed · multi-season history carryover ·
season selector (the app currently auto-picks the most-recent season row, which
is correct for one live season and a landmine for carryover).
