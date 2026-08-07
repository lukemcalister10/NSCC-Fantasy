# FANTASY CRICKET — KICKOFF v1.3, 07/08/2026 (supersedes v1.2)
### v1.3: review seat made model-agnostic; standing rule 9 (parallel build
### sessions + migration ownership). v1.2 was standing rules 7 (plan approval
### ends the turn) and 8 (designated-branch + operator PR-merge workflow).
### v1.1 was amendment A1 (starting-price rule).
### Club fantasy cricket platform. Tier Lite (SHAPE 22, error-costly sub-gate unmet).
### Seats: Luke = OPERATOR / league manager. REVIEW SEAT (spec/reviewer) — a chat
### session, MODEL-AGNOSTIC; currently Opus 5. Historically called the "Fable
### seat"; the name denoted the ROLE, never a model requirement, and Opus 5
### (released 24/07/2026) now leads Fable 5 on coding and knowledge work at half
### the price. Do not read a model constraint into any seat name. Claude Code
### (Opus) = builder. No standing auditor; one cold acceptance run before ship.
### Companions: DEFINITION_OF_DONE.md (frozen gates), DECISION_LOG.md (locked + open).

## OBJECTIVE (one paragraph)
A season-long fantasy cricket web platform for one club (3–6 club sides, ~60–120
players in the pool, ~10–30 fantasy participants). Participants pick role-constrained
teams under a salary cap, trade weekly, and compete on H2H fixtures plus an overall
points ladder. The league manager enters (or LLM-transcribes) match scorecards; the
system computes fantasy scores, reprices players, and updates the ladder — all
derived, all recomputable. Must perform by round 1 of the 2026/27 club season;
thereafter operates weekly (continuous domain, see DEFINITION OF HEALTHY).

## ARCHITECTURE (directive, not suggestion)
- Supabase: Postgres, magic-link auth, storage (player photos), row-level security.
  League-manager role enforced in the database, not the UI.
- React frontend (Vite), hosted Vercel/Netlify. Public-facing pages sit behind auth
  (data is INTERNAL: club members' names, stats, photos — Law 11).
- Admin backend = same app behind role check: scorecard entry/review, screenshot
  transcription, player registry, settings, round management, recompute.

## THE PRIME INVARIANT
Raw scorecards + frozen config are the ONLY sources of truth. Every fantasy score,
price, cap balance, and ladder position is derived state — recomputable from scratch,
byte-identical on re-run, never hand-edited. "Edit the scorecard, press recompute
round" must produce exactly what correct-first-time entry would have. (Gate G3.)

## THE THREE ENGINES (all parameters from config tables, never constants in code)
1. SCORING: config-driven calculator. Point values per run, four, six, wicket, catch
   (fielder / keeper), stumping, runout (unassisted / assisted), plus strike-rate and
   economy bonuses gated by minimum-sample thresholds. Values deferred (O4/O5),
   schema built now. Captain ×2; vice-captain inherits if captain DNP; neither plays
   = no double. Single frozen rule set per season — no mid-season changes.
2. PRICING: new_price = (1−α)·old_price + α·(match_score × $/pt), rounded to nearest
   $100, floored. α = 0.20, $/pt = $1,000, floor = $9,000 (all config). One movement
   per completed match. DNP (not named in lineup) = 0 fantasy points, price frozen,
   match excluded from pricing. Named in lineup = played: price adjusts even on 0.
   Starting prices: perf = $/pt × last-season per-match average (PlayHQ); price =
   floor + (min(g,4)/4) × (perf − floor), g = matches in lineup last season (same
   denominator as the average); clamp at floor if perf < floor. Zero-history = floor.
   Rounding everywhere: nearest $100, half up. Hand-adjustable pre-season-lock only.
3. CAP LEDGER: holdings store (player, purchase_price, purchase_round). Cap remaining
   = starting_cap − Σ purchase prices + Σ sale proceeds (sale at price at time of
   sale). Team value = cap remaining + Σ current prices (D8/A2); Σ current prices
   alone = invested value. Both display-only, neither touches the cap.

## ROUNDS, LOCKS, TRADES
- Rounds are first-class league-manager-defined containers: matches assigned to
  rounds; per-round lock datetime (default Sat 11:00 Adelaide time, stored per round,
  never hardcoded). Hybrid 1-week/2-week rounds hand-crafted after fixture release
  (O8) so matches sit inside one round where possible.
- Match points land in the round containing the match's final day (score at match
  completion; no day-diffing).
- MID-MATCH TRADE LOCK, both directions: a player whose match has started but not
  finalised can be neither bought nor sold, until finalised and repriced. UI padlock
  "match in progress". Server-side enforcement.
- Trades per round: config value (O1), set pre-season. Trade-in price = current
  price. All lock/trade rules enforced server-side against timestamps.

## TEAMS, ROLES, COMPETITION
- One role per player per season (BAT / WK / BWL / AR), frozen at season lock, plus a
  WK-ELIGIBLE flag as the only dual eligibility. Composition requirements and team
  size are config (O2). Registry supports mid-season player additions (manager sets
  price, default floor, logged).
- Player names are stored and matched in the D22 normalised form (NFKC, curly
  apostrophes and quotes folded to ASCII, whitespace collapsed; case and diacritics
  preserved). Applied identically on registry write and on every inbound match.
- H2H: repeated round-robin fixture generation; ladder on wins, points-for
  tiebreaker; bye scored against the round median; separate overall-points
  leaderboard. Player profiles: photo (manager-uploaded), price history, scores.

## DATA ENTRY (v1) AND AUTOMATION
- v1 core: manual scorecard entry form, designed for ≤10 min per grade per week.
- v1 automation: screenshot → LLM transcription (Anthropic API, vision) → JSON in
  scorecard schema → side-by-side review UI (image vs parsed form) → manager corrects
  → commits. Fielding extracted from opposition dismissal strings ("c X b Y",
  "st...", "run out (...)"). Fuzzy name-match against registry; unresolved names
  flagged, never guessed. LLM OUTPUT NEVER COMMITS DIRECTLY — review is mandatory.
- v-next: PlayHQ public API import-then-review (credentials via association); live
  webhooks are partner-tier, out of scope.

## SEASON LOCK
One explicit operator action. Freezes: league settings, scoring rules, starting
prices, roles/flags, α/floor/$-pt, trades-per-round, and fantasy-team registration
(D21). Computes the salary cap (O3). Pre-lock everything is tunable from the
settings page; post-lock immutable via UI and API (Gate G10). One-way door: rehearse
on a scratch season before firing it on the real one.

## STANDING RULES FOR THE BUILD SEAT
1. Fixed report template per session: what changed / what did NOT / artifacts by
   name+fingerprint / gates moved / open hypotheses / next action / one-line burn
   report. Plain read + operator decisions section on top.
2. No unlabelled numbers. Every parameter cites its config key or decision ID.
3. Status vocabulary: PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is
   banned; VERIFIED requires the named gate and verifying artifact.
4. New wishes post-freeze go to V-NEXT, not the build.
5. Smallest real task end-to-end first: one grade, one reference scorecard, one
   round, before scaling anything (checklist §7 of the playbook).
6. State-stamp every handoff (as-of date + commit hash + supersedes).
7. PLAN APPROVAL (added v1.2): when a kickoff says plan mode / plan first,
   presenting the plan ENDS the turn — stop and wait for the operator's
   explicit approval before writing anything, whether or not the harness
   enforces a plan mode. Presenting and proceeding in one breath skips the
   checkpoint.
8. BRANCH WORKFLOW (added v1.2): push to the harness-designated branch; the
   operator merges to main via PR (rebase-and-merge; hashes are rewritten, so
   each kickoff quotes main's actual HEAD from GitHub, never the prior
   session's claim). Fast-forwarding a local main does not update origin.
9. PARALLEL SESSIONS (added v1.3). Concurrent build sessions are permitted where
   scopes are disjoint, under these constraints:
   a. MIGRATION OWNERSHIP — exactly ONE session per parallel round may add or
      alter files under supabase/migrations/. Every other concurrent session is
      instructed, in its kickoff, to add none. Migrations are an ordered
      sequence; two branches each appending one produce either a merge conflict
      or an apply order that differs between the operator's run and a fresh
      cold apply, which would undermine the prime invariant's reproducibility.
   b. SHARED CHROME FIRST — nav entries, route stubs and any schema both
      sessions need land in a single small session that is merged BEFORE the
      parallel branches are cut, so concurrent work does not contend over the
      same layout files.
   c. FILE-PATH FENCES — each kickoff names the paths it owns and states that
      files outside them are not to be touched. Overlap is escalated to the
      operator, not resolved unilaterally.
   d. NO CROSS-SESSION ASSUMPTIONS — a session must not assume another
      concurrent session's work exists. It builds against merged main only.
   e. INTEGRATION IS NOT INHERITED — two isolated green reports do not imply
      the merged result works. Integration is proven by B1 and the cold
      acceptance run, not by summing per-session passes.

## DEFINITION OF HEALTHY (season operations, checked weekly)
Ladder, scores, and prices correct within 24h of the round's final day; zero manual
edits to derived state all season; weekly admin ≤ 30 min total (baseline gate B1);
every anomaly resolved by scorecard correction + recompute, never by patching output.
