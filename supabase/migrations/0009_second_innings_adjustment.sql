-- NSCC Fantasy — ENGINE SLICE (S-F), part 1 of 2: THE SECOND-INNINGS MULTIPLIER
-- BECOMES VISIBLE IN STORED STATE.
--
-- WHAT D28 DOES TO A SCORE. In a match where a team bats and fields twice,
-- everything a player earns in their team's SECOND innings — batting, bowling and
-- fielding alike, and under the operator's 10/08/2026 ruling the economy bonus
-- too — is totalled, multiplied by scoring.secondInningsMultiplier, rounded HALF
-- UP, and added to their first-innings total. ONE multiplication and ONE rounding
-- per player per match, never per event, so match scores stay whole (O4).
--
-- WHY THAT NEEDS A COLUMN. player_match_scores stores batting / bowling /
-- fielding / bonuses / base, and `base` has always been the sum of the other
-- four. Multiply one innings and that identity breaks: the row would carry a
-- `base` that cannot be reconciled from its own components, the multiplier would
-- be invisible in stored state, and /players/:id would show a breakdown that does
-- not add up. Operator ruling (10/08/2026): spend the column. A multiplier
-- invisible in stored state is unverifiable by hand, which is the one thing this
-- project's audit posture will not accept.
--
-- THE COLUMN IS THE WHOLE EFFECT, AS ONE AUDITABLE NUMBER:
--   second_innings_adjustment = round_half_up(second × m) − second
-- so batting + bowling + fielding + bonuses + second_innings_adjustment = base,
-- exactly, for every row. It is NEGATIVE for m < 1 (the 26/27 value is 0.5), and
-- the four component columns stay FACE-VALUE sums — what the player actually
-- earned, before the multiplier — which is what makes the arithmetic checkable.
--
-- NOTHING VERIFIED MOVES. DEFAULT 0 backfills every existing row with the value
-- it already implies, and the FROZEN fixture config holds
-- secondInningsMultiplier = 1.0, so the term is 0 in every gate: G1's two
-- reference scorecards are one-innings cards and cannot reach this path at all,
-- and G3's recompute is byte-identical with a zero column added on both sides.
-- The 26/27 season value (0.5) lives in seasons.config, chosen at lock (D13).

ALTER TABLE player_match_scores
  ADD COLUMN second_innings_adjustment integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN player_match_scores.second_innings_adjustment IS
  'D28 second-innings multiplier, as one auditable term: round_half_up(second-innings earnings × scoring.secondInningsMultiplier) − those earnings. Negative for a multiplier below 1; 0 when the multiplier is 1.0 or the match had one innings. batting + bowling + fielding + bonuses + this = base.';

COMMENT ON COLUMN player_match_scores.base IS
  'Pre-captaincy match score, and the figure pricing moves on (D1/G7). Equals batting + bowling + fielding + bonuses + second_innings_adjustment exactly. Captain doubling (D10) applies to THIS number, i.e. after the second-innings multiplier, per D28(a).';
