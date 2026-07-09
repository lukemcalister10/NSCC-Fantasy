# DEFINITION OF DONE v1.1, 08/07/2026 — FROZEN AT KICKOFF (Law 3)
### (supersedes v1.0 same day; delta = G14 added under operator amendment A1,
### pre-build — no code exists yet, so the freeze is amended, not violated)
### All gates run against the FIXTURE CONFIG (test values below), so they are frozen
### now even though the real season economy (O1–O5) is decided at season lock.
### Ship = every gate green in a COLD acceptance run (fresh session, repo + this file
### only). Post-freeze wishes go to V-NEXT. Red gates at freeze are expected.

## FIXTURE CONFIG (test-only values; not season defaults)
cap $1,000,000 · team size 6 (2 BAT / 1 WK / 2 BWL / 1 AR) · α 0.20 · $/pt $1,000 ·
floor $9,000 · rounding nearest $100 · trades 2/round · scoring: run 1, four +1,
six +2, wicket 25, catch 8 (keeper 8), stumping 10, runout 10/5, SR bonus +10 if
SR ≥ 150 over ≥ 10 balls, economy bonus +10 if econ ≤ 3.0 over ≥ 3 overs.

## GATES
- G1 REFERENCE_SCORECARD. Two hand-scored reference scorecards (one batting-heavy,
  one bowling/fielding-heavy, both innings incl. dismissal-string fielding credits)
  reproduce hand-computed fantasy points exactly, for every player, including
  captain doubling and one SR-bonus edge (9 balls faced at SR 200 → NO bonus).
- G2 CAP_LEDGER (operator's worked example, verbatim). Cap $1,000,000. Buy player at
  $100,000; other purchases leave cap remaining $50,000. Player rises to $150,000 →
  team value $1,050,000 AND cap remaining still $50,000. Sell him → credited
  $150,000 → cap remaining $200,000. Buying any player in charges price-at-time,
  not starting price.
- G3 RECOMPUTE_IDEMPOTENCE. Enter a scorecard with a deliberate error → commit →
  round computes → correct the scorecard → recompute → ALL derived state (scores,
  prices, cap balances, H2H results, ladder) byte-identical to the correct-first-
  time path. No orphaned derived rows.
- G4 LOCK_ENFORCEMENT. Team change / trade at lock+1s rejected SERVER-SIDE (API
  called directly, bypassing UI). Pre-lock succeeds. Lock time read per-round.
- G5 DNP_PRICE_FREEZE. Player absent from lineup: 0 points, price unchanged, match
  absent from his pricing history. Player named but scores 0: price falls per
  formula ($60,000 → $48,000 at fixture α).
- G6 MIDMATCH_TRADE_LOCK. Player's match started, not finalised: buy rejected AND
  sell rejected, server-side. Match finalised + repriced: both succeed.
- G7 PRICE_FORMULA. $60,000 player scores 100 → $68,000 exactly. $61,730-equivalent
  raw result rounds to nearest $100. A price path that would cross the floor clamps
  at $9,000. Two matches in one (two-week) round = two sequential movements.
- G8 CAPTAINCY. Captain DNP → VC doubled. Captain and VC both DNP → nobody doubled.
- G9 BYE_MEDIAN. 5-team H2H round: bye team scored against that round's median team
  score; ladder and points-for reconcile by hand.
- G10 SEASON_LOCK. Pre-lock: settings change propagates (recompute of a test round
  reflects new scoring value). Post-lock: settings mutation rejected via UI and via
  direct API call.
- G11 CONFIG_ECONOMY. Change team size, composition, cap, and scoring values in
  fixture config → G1/G2 re-run green with NO code change.
- G12 TRANSCRIPTION_GUARDRAIL. LLM scorecard transcription lands in review state;
  no path writes it to committed scorecards without explicit manager confirm; an
  unmatched player name blocks commit until resolved.
- G13 AUTH_BOUNDARY. Non-manager account: admin API calls rejected (RLS, not UI);
  profiles/photos invisible logged-out.
- G14 STARTING_PRICE (added by amendment A1). Fixture floor $9,000, $/pt $1,000.
  Player averaging 61 over 1/2/3/4 lineup matches prices at $22,000 / $35,000 /
  $48,000 / $61,000 exactly. 6-game player averaging 61 → $61,000 (g caps at 4).
  Zero-history player → $9,000. Player averaging 5 over 4 games → clamps at
  $9,000. A raw result ending in $x50 rounds UP to the next $100.
- B1 BASELINE (pre-registered, Law 3). Full round processed end-to-end — scorecards
  in (manual or screenshot), scores, prices, ladder out — in ≤ 30 minutes of
  operator time, measured on a real 3-grade round. The naive alternative is the
  spreadsheet you'd run by hand; if the system loses to it, the system is wrong.

## COLD ACCEPTANCE PROTOCOL
Fresh Claude Code session, seeded with repo + this file only (no build-chat
context). Runs the gate suite scripted, reports per-gate PASS/FAIL with artifact
names. Builder fixes; delta re-audit on flagged gates only.
