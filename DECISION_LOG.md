# DECISION LOG v1.4, 09/07/2026 (supersedes v1.3; delta = A4 session rulings: D19 washout/abandoned, D20 ladder points 2/1/0, D21 derived fixtures + team-set freeze binding)
### Locked = operator-approved in spec sessions of 08/07/2026. Open items carry a
### DEFAULT (applies automatically at expiry unless overridden) and an EXPIRY.
### One batched decision sitting per session; no thread proceeds without naming
### which gate or definition-of-done item it moves.

## LOCKED
- D1  Pricing formula: new = (1−α)·old + α·(score × $/pt). α 0.20, $/pt $1,000,
      round nearest $100, floor $9,000. Floor and α remain config (see O6/O7).
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

## OPEN — DEFAULTS APPLY AT EXPIRY
- O1 Trades per round + banking. DEFAULT: 2/round, non-banking. Depends on club
    team count / pool size. EXPIRY: season lock.
- O2 Team size & composition. DEFAULT: 11 = 4 BAT / 1 WK / 4 BWL / 2 AR.
    EXPIRY: season lock.
- O3 Salary cap. DEFAULT: 1.1 × (team size × club-average starting price),
    computed at lock, rounded to nearest $10,000. EXPIRY: season lock.
- O4 Scoring values. DEFAULT (for veto): run 1, four +1, six +2, wicket 25,
    catch 8, keeper catch 8, stumping 10, runout unassisted 10 / assisted 5.
    EXPIRY: season lock.
- O5 SR/economy bonus thresholds. DEFAULT: bat +10 if SR ≥ 150 over ≥ 10 balls;
    bowl +10 if economy ≤ 3.0 over ≥ 3 overs (tune to grade norms from last
    season's PlayHQ data before locking). EXPIRY: season lock.
- O6 Price floor. LOCKED at $9,000 for now; flagged revisitable pre-lock.
- O7 α. LOCKED at 0.20 for now; flagged revisitable pre-lock.
- O8 Hybrid round map. Cannot decide until fixture release. DEFAULT if fixtures
    misbehave: pure weekly rounds + rely on D7 mid-match lock. EXPIRY: 1 week
    after fixture release.

## V-NEXT (post-ship wishes land here, not in the build)
PlayHQ API import-then-review · live scores · trade banking variants · bench/
emergency mechanic · league chat/banter feed · multi-season history carryover.
