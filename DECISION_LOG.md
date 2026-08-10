# DECISION LOG v2.2, 10/08/2026 (supersedes v2.1; delta = A13: four mid-slice rulings absorbed — milestone bonuses EXCLUSIVE, economy bonus PER INNINGS, second_innings_adjustment stored as a component, trade-time composition tightening; D28/D29/D26 all BUILT; ENGINE-SLICE PRECONDITION SATISFIED)
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
      MECHANISM RULED (A12, 10/08/2026) — DESIGN A, EAGER AND TRIGGER-DRIVEN,
      in preference to a scheduled job at lock. A SECURITY DEFINER function
      app.materialise_selections(p_team uuid, p_round uuid) rewrites the
      (team, round) selection set from the trades ledger and carries captaincy
      forward (this round's flags if present, else the most recent earlier
      round's, else the dearest holding — mirroring resolveCaptaincy). Three
      trigger points: AFTER INSERT ON trades (re-materialise every OPEN round for
      that team); AFTER INSERT ON rounds; AFTER UPDATE OF lock_at ON rounds when
      it moves into the future. WHY A BEATS THE LETTER OF D26(b): trades are
      already refused after lock (0002), so the set freezes at lock
      automatically — no scheduler is needed, and D26(d) still falls out because
      only open rounds are materialised. The decisive argument is participant-
      facing: G15's composition check then fires IN FRONT OF the participant at
      trade time, rather than silently at lock with nobody watching.
      OPERATOR CLARIFICATION (10/08/2026): "set and forget" describes the
      DEFAULT, not the expectation. Trades can and should change a team every
      week — that is the game. What D26 removes is the separate weekly
      confirmation step, so a participant is never punished for skipping an
      administrative action, only for the trades they do or do not make.
      OWNERSHIP GAP, CLOSED: S-E specified this; S-D finished before that spec
      existed, leaving it unowned. It was explicitly assigned to S-F and BUILT
      (10/08/2026) as migration 0010: app.materialise_selections SECURITY
      DEFINER, the three ruled trigger points, plus a ONE-TIME BACKFILL over
      every open round x registered team — without which existing holdings would
      have sat unmaterialised until someone happened to trade, which is the same
      "nobody wrote the rows" failure D26 exists to end.
      THE TWO-WRITER FINDING (S-F, 10/08/2026) — worth reading as a pattern, not
      an incident. S-E's spec reduced client-side removal to ONE effect in
      Team.tsx. There was a SECOND writer inside Trades.tsx materialising every
      open round after each trade pair. Following the spec exactly would have
      removed one and left the other — precisely the two-writer divergence D26
      forbids — and it would have LOOKED correct, because the spec was followed.
      This is the second time this project has been bitten by a precise spec
      written against an incomplete reading (the first: C11's seed emitter drift).
      LESSON, carried: a spec that names a specific file or line is a hypothesis
      about the codebase, not a fact. Verify the claim before acting on it.
      Both writers are gone. C7's duplicate-key tolerance went with its cause.
      The /team repair button now calls a public.materialise_selections RPC, so
      EXACTLY ONE piece of code in the system writes a selection set. F1 closed.
      G15 TIGHTENED, PARTICIPANT-VISIBLE, KEPT DELIBERATELY: because holdings ARE
      the selection set, composition is now judged on every ledger write — a lone
      buy leaving a one-player team is refused AT TRADE TIME rather than silently
      at lock. That is A12's decisive argument, so S-F kept it and pinned it with
      five new G15 cases rather than working around it. CONSEQUENCE, recorded: a
      squad can no longer be built incrementally across separate requests. Six
      gate files that wrote lone trades as a convenience now write complete builds
      or pairs — which is what the UI issues anyway, so no UI path broke. Anyone
      building new against this API must issue complete builds or sell+buy pairs.
- D29 BUILT (S-F, 10/08/2026). computeH2hResults now takes {id, seq} pairs and
      uses seq − 1; orchestrator.ts was the only call site; generateRound was
      unchanged (its own doc already specified seq − 1 — the orchestrator was
      passing something else than the function documented). G9 is byte-identical:
      single round, seq 1 → index 0. CONTROL RUN: with the positional rule
      restored, the new test fails on exactly the retroactive-rewrite assertions
      while G9 stays green — which is precisely why the defect survived
      undetected. S-C's disagreement banner on the fixtures page is now DEAD CODE;
      S-F left it in place and reported it rather than editing a file it did not
      own. → remove in the polish slice (F7).
      Original ruling retained below.
- D29 (original) FIXTURE INDEX IS A PROPERTY OF THE ROUND (A12, 10/08/2026). The H2H round
      index is seq − 1 — the round's own number — and NEVER its position among
      active rounds. Binding on the engine slice.
      WHY THIS IS A DETERMINISM DEFECT, NOT A DISPLAY MISMATCH (C10 reclassified):
      src/recompute/h2h.ts indexes fixtures by position among ACTIVE rounds while
      app/lib/queries.ts uses seq − 1. Under the engine's rule, an empty round
      later acquiring its first match does not merely disagree with the UI — it
      shifts every later round's index by one and RETROACTIVELY REWRITES WHO
      PLAYED WHOM IN ROUNDS ALREADY SETTLED. That is the ladder changing with
      hindsight, which the operator has explicitly ruled out (D24, same
      principle, different door). D19 makes it reachable: a round with no entered
      matches does not exist for H2H.
      CONSEQUENCE OF THE FIX, wanted: a round's fixture becomes knowable before
      it is played, publishable in advance, and immune to what happens in other
      rounds — which is what D21's determinism means.
      IMPLEMENTATION (specified by S-E, not built): pass {id, seq} pairs into
      computeH2hResults and use seq − 1; orchestrator.ts is the only call site;
      G9's single-round case (seq 1 → index 0) is unchanged, so G9 stays green
      BYTE-IDENTICALLY. S-C's disagreement banner stays as the safety net until
      the fix lands.
- D30 PLAYER REMOVAL FROM THE POOL (A12, 10/08/2026). Operator ruling: inactive
      players are REMOVED from the pool before season lock, so O3's "mean across
      ALL players" needs no active/inactive qualification — the pool at lock
      contains only real registrants. Implemented in S-D as a DELETE permitted
      ONLY for a player with no raw history, including a check on
      dismissals.resolved_text, which carries player ids as TEXT with no foreign
      key — a plain delete would silently orphan a fielding credit, the exact
      shape of the D25 defect. Refused post-lock, logged. NO "withdrawn" status
      was added, deliberately: lock precedes round 1, so no player has history at
      lock and the delete path covers every real case; a status would have
      changed the cap arithmetic the operator declined to change.
- D27 INNINGS NUMBERING SEMANTICS (binding on the engine slice). The `innings`
      integer added to batting_lines / bowling_lines / dismissals in migration
      0006 is the CLUB's own innings sequence (1, 2, …) — batting, bowling and
      dismissals sharing an index are the same phase of the match. It is NOT the
      ICC-style absolute four-innings numbering. This is precisely the grouping
      "their team's second innings" requires for the O4 multiplier. A future
      reader must not reinterpret it.
- D28 BUILT (S-F, 10/08/2026) — see the WORKED EXAMPLE below, which is pinned as
      a test in BOTH the engine and the database path. Original deferral entry
      retained for the record.
      WORKED EXAMPLE (season O4 values, multiplier 0.5, player is captain):
        innings 1 — batting 62 + 10 (fifty) + 7 + 3 = 82 · bowling 38 + 1 maiden
          = 39 · fielding 10 · economy floor(0.25 x 26) = 6 → TOTAL 137
        innings 2 — batting 16 + 2 + 5 (not out) = 23 · bowling 19 · fielding 15
          · economy floor(0.25 x 11) = 2 → TOTAL 59
        59 x 0.5 = 29.5 → 30 (HALF UP, ONE rounding) · adjustment −29
        base = 137 + 30 = 167 · captain x2 → 334
      Halving PER COMPONENT instead would give 31, not 30. That one point is the
      difference the "one multiplication, one rounding" rule buys, and it is
      asserted directly by a test.
      STORED COMPONENT (operator ruling A13, 10/08/2026): the multiplier is
      recorded in player_match_scores as second_innings_adjustment =
      roundHalfUp(second x m) − second (here −29), migration 0009, DEFAULT 0.
      RATIONALE: base = batting + bowling + fielding + bonuses is a promise the
      stored row keeps, and the multiplier breaks it — a player page would show a
      breakdown that does not sum to the total, and a stored row could not be
      reconciled from itself. A multiplier invisible in stored state is
      unverifiable by hand, which is what this project's audit posture exists to
      prevent. Under the fixture config the column is 0 in every row, so G1/G3
      stay byte-identical. /players/:id displays the adjustment in the breakdown.
- D28 (original) SECOND-INNINGS MULTIPLIER DEFERRED TO A NAMED ENGINE SLICE. The O4
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
    MILESTONE BONUSES ARE EXCLUSIVE, NOT CUMULATIVE (operator ruling A13,
    10/08/2026). A century scores the 100 bonus of 20 ONLY — the century bonus
    REPLACES the fifty bonus; they do not stack. A player passing 50 and not
    reaching 100 scores 10. O4 lists them as separate lines, which the S-F
    builder correctly flagged as ambiguous; this ruling resolves it. Do not
    re-read the list as cumulative.
    ECONOMY BONUS IS PER INNINGS (operator ruling A13, 10/08/2026, SUPERSEDING
    the per-match reading in the original O4 text above and in the D4/A9 rider).
    Operator, verbatim in substance: "Each innings a separate instance, and then
    those two values added to the match score like all are." So the bonus is
    computed on THAT INNINGS' balls and runs, floored and zero-clamped per
    innings, and — because it is earned IN an innings — a second-innings economy
    bonus is MULTIPLIED with everything else in that innings. There is no
    per-match exemption and no special case: a bowler's second-innings work is
    worth the multiplier across the board, wickets, maidens and economy alike.
    This DISSOLVES the concern S-F escalated (that a second-innings-only bowler
    would keep a full economy bonus while their wickets were halved). It also
    means every O4 component is per innings, which is simpler than the partition
    originally proposed, and it matches how the code already computed it per
    line — so test/sa.scorecard-innings-e2e.test.ts's pin of bonuses === 10
    STANDS UNCHANGED. The retained O5 threshold fields follow the same rule.
    NOTE FOR THE D4/A9 RIDER: the rider's description of the economy bonus as
    per-match is now superseded for IN-SEASON scoring. The rider's substance is
    unaffected — 25/26 starting prices were derived from season aggregates and
    remain approximate for high-volume bowlers, washed out by the D1 EMA.
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
- C5 CORRECTED then CLOSED (S-D, 10/08/2026). AS WRITTEN, C5 WAS WRONG and the
     correction matters: the ENFORCEMENT half of season lock has existed and been
     green since 0002_locks.sql — the config/player/registration freezes, the O3
     cap computation, the unpriced block and the one-way door are all triggers,
     all verified. What was missing was only the OPERATOR'S ACCESS. Correct
     wording: "season lock has no operator-facing action; enforcement is built
     and verified." S-D built the settings page, the rehearsal preview, the
     pool-completeness warning, type-the-season-name arming, and D30's removal
     path, in migration 0008. The preview and the lock now CALL THE SAME
     FUNCTIONS (app.season_pool_stats, app.season_lock_blocker), so
     preview-cap ≡ lock-cap is structural rather than a matter of builder
     discipline. Incidental G11 win: 0002 held the $100 rounding step as a
     literal; it now reads pricing.roundingIncrement, with no verified number
     moving (g10.cap-at-lock still computes $115,700).
     G10 REMAINS UNCLAIMED as operator-action-verified — correctly. It moves when
     the operator runs MANAGER_VERIFY step S9 on the live project and signs off.
- C6 CLOSED (S-E, 10/08/2026). vercel.json rewrites unmatched paths to
     index.html, excluding /api/. Verified in headless Chromium over nine typed
     URLs, AND with a control run that removes the rewrite and reproduces the 404
     on eight of nine — the check demonstrates the defect and then its absence,
     rather than only asserting the happy path. Operator-verified live.
     Original entry follows.
- C6 (original) SPA ROUTING 404. Any typed URL or page refresh returns Vercel's 404 rather
     than the app: Vercel looks for a file at the path and answers before the
     client router runs. Affects EVERY route, not just /admin, and has been true
     since the first deploy — unnoticed because every smoke test navigated by
     clicking. Participants bookmark, refresh and share links, so this bites in
     week one. Fix is a vercel.json rewrite of unmatched paths to index.html.
- C7 MITIGATED (S-E, 10/08/2026); closes fully when D26's trigger lands. The
     precise cause was NOT inherent re-insertion: the effect fired when holdings
     arrived while the selections query was still in flight, so an already
     materialised round looked empty and the insert went in. Now gated on the
     selections query resolving, with duplicate-key treated as benign in
     carry-forward only. The client writer STAYS until the D26 trigger exists —
     removing it first would leave nobody writing selections, scoring every
     participant zero in any round locking in that window. Removal is then one
     effect deleted.
- C8 CLOSED (S-E, 10/08/2026). Two compounding causes, read out of the installed
     driver rather than inferred: pg maps ?sslmode=require to verify-full, and
     ConnectionParameters merges the URL's parsed values ON TOP OF an explicit
     ssl object, so a caller could not override it. resolveSslPolicy now strips
     sslmode and states the policy explicitly (CA supplied → verify; no-verify →
     encrypted but unauthenticated, and says so; silence → Node's store).
     MANAGER_VERIFY corrected to name the connection variant — transaction pooler
     for the serverless function, since the direct host is IPv6-only and Vercel
     cannot reach it. Original entry follows.
- C8 (original) POSTGRES SSL CONFIGURATION. MANAGER_VERIFY specifies ?sslmode=require;
     against the Supabase pooler this fails with "self-signed certificate in
     certificate chain". ?sslmode=no-verify works and is the operator's current
     live setting. Traffic stays encrypted either way; only chain verification
     is skipped. Proper fix is SSL options configured in src/db/pgClient.ts
     (Supabase CA) rather than a URL parameter, plus MANAGER_VERIFY corrected to
     name the connection variant AND the working SSL setting.
- C9 CLOSED (S-E, 10/08/2026). Cause was writeDerived issuing one INSERT
     round-trip per derived row — free in-process against pglite, which is
     exactly why the test suite never felt it, and thousands of network
     round-trips from a serverless function. Now chunked multi-row inserts: same
     rows, same order, same transaction. The statement-counting test was verified
     to fail when batching was defeated (count assertion red, correctness
     assertions still green — the right shape). Control now reports elapsed
     seconds, an explicit timeout, Retry, and typed failure kinds.
     LIVE RESULT: 7 seconds on the scratch season, against a prior run that
     approached the 60s ceiling. Two consecutive runs then reported no change
     (G3 idempotence on live infrastructure). The first post-migration run
     corrected one stale price movement — expected, benign, and consistent with
     0008 moving the rounding step from a literal to config.
     Original entry follows.
- C9 (original) RECOMPUTE LATENCY / TIMEOUT HANDLING. The first live recompute ran close to
     the serverless function timeout and the button appeared frozen with no
     progress or failure state. It eventually succeeded and reported G3
     idempotence correctly. Will worsen with a full season of data. Needs
     connection setup reviewed and the control to degrade honestly (progress,
     timeout, retry) rather than hang.
- C10 RECLASSIFIED AND PROMOTED TO D29 (A12). Not a display mismatch — a
     determinism defect that lets settled fixtures be rewritten retroactively.
     See D29 for the ruling and the specified implementation.
- C11 CLOSED (S-E audit, 10/08/2026). The audit found exactly two artifact
     emitters, both seed generators, and one real gap: the DEMO seed pair — the
     one VERCEL_DEPLOY.md instructs the operator to paste — was applied by no
     test; only the dev odd-count pair was. It was correct only because commit
     5e21590 had fixed it BY HAND, with nothing keeping it correct through the
     next migration. Now covered by an apply-the-emitted-file test. Everything
     else pasteable is hand-written prose run by a human — bounded, left alone.
     Original entry retained below as the record of why the rule exists.
- C11 (original) SEED EMITTER DRIFT — EVIDENCE FOR STANDING RULE 9e. Migration 0006 renamed
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
- C13 PARTLY CLOSED (10/08/2026). The unpriced-player half is handled: the lock
     is BLOCKED while any player lacks a price (enforced in 0002, surfaced by
     S-D's settings page), and D30 lets the operator remove players who should
     not be in the pool at all. The price-drift half remains an OPERATOR CHECK
     before lock — see the original entry, and O7 (α) if the drift looks too
     sharp. Original entry follows.
- C13 (original) UNPRICED PLAYER / PRICE-DRIFT SANITY (operator check, not a defect). The
     live scratch season shows 65 players, 1 awaiting a price — worth finding.
     Separately, every player fell in the demo recompute. Two candidate causes:
     (i) demo seed prices and demo scorecard scores were never calibrated
     against each other, or (ii) the structural skew — a player holds price only
     by scoring price ÷ $/pt, and cricket scores are right-skewed, so MOST
     players fall MOST weeks while a few spike. (ii) is expected behaviour and
     self-corrects via the EMA, but it will alarm participants in week one and
     is the reason to revisit α (O7) before lock if it looks too sharp.

## ENGINE-SLICE PRECONDITION — SATISFIED 10/08/2026 (S-F merged at main 773a077)
The engine slice landed: O4's shape, D28's multiplier, D29's fixture index and
D26's trigger are all BUILT and green. G1 is UNMOVED with stronger evidence than a
re-run — git diff on src/fixtures/reference-scorecards.ts and test/scoring.test.ts
is EMPTY, and both reference cards are single-innings, so with the new O4 keys at
zero and the multiplier at 1.0 in the frozen fixture config, G1 was arithmetically
incapable of moving. G9 byte-identical. G11 expectations byte-identical. Suite
348 passed (263 at base). Seed regeneration verified MECHANICALLY: undoing the
slice's column and config additions reproduces all four committed .sql files
exactly, so no derived number moved.
SEASON LOCK IS THEREFORE PERMITTED, once registration, roles and prices are final
and MANAGER_VERIFY S0–S9 closes G10. The original precondition text follows.

## (original) ENGINE-SLICE PRECONDITION FOR SEASON LOCK (A12, 10/08/2026)
Season lock is a ONE-WAY DOOR and it freezes the scoring rules. The settings page
S-D built exposes exactly the scoring keys ScoringConfig carries TODAY — which are
NOT O4's chosen values: no 50/100 bonuses, no duck, no not-out, no maiden, no 5WI,
no continuous economy bonus, and no second_innings_multiplier. LOCKING BEFORE THE
ENGINE SLICE LANDS WOULD FREEZE AN ECONOMY THAT IS NOT THE ONE CALIBRATED ON REAL
25/26 DATA, permanently.
Therefore the ordering is BINDING: engine slice (O4 shape + D28 multiplier + D29
fixture index) AND D26's materialisation trigger must both land BEFORE season lock
is fired on the real season. Registration list, roles and prices follow; lock last.
Self-enforcing reminder, by design: when ScoringConfig is reshaped,
settings-ui.config-driven.test.ts FAILS until descriptors exist for the new keys.

## FOLLOW-UPS NAMED BY BUILDERS (not V-NEXT; wanted before or soon after ship)
- F1 CLOSED (S-F, 10/08/2026). public.materialise_selections RPC exists; the
     /team repair button calls it; exactly one code path writes a selection set.
- F6 (reserved, not used — the /players/:id breakdown was built in-slice by S-F
     rather than deferred, since the page would otherwise visibly fail to sum
     once the season locks at 0.5).
- F7 Remove S-C's fixture disagreement banner. Dead code since D29 landed; S-F
     correctly left it rather than editing a file it did not own. → polish slice.
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
