-- NSCC Fantasy — MANAGER-CORE SLICE (S-A), part 2 of 3: SCORECARD SHAPE.
-- Innings dimension (D5), the O4 capture fields, and honest dismissal-column
-- naming. No enforcement here — this migration only lets the scorecard hold what
-- a real match produces.
--
-- WHY INNINGS (D5): 0001 keys batting_lines/bowling_lines on (scorecard_id,
-- player_id) and dismissals on (scorecard_id, seq), so a scorecard can hold
-- exactly ONE innings. D5 contemplates two-day matches ("score at match
-- completion; no day-diffing"), which means a player can bat twice and bowl
-- twice in one match. The innings number becomes part of every key.
--
-- NO ENGINE CHANGE IS NEEDED for the scoring path to accept this: scoreMatch
-- ACCUMULATES over lines (`ps.batting += ...`), so two lines for one player sum
-- to that player's match total exactly as one combined line would have.
--
-- RECORDED CONSEQUENCE, deliberately NOT fixed here (DECISION_LOG v1.9, open
-- sub-item under O4): with per-innings lines the engine's threshold bonuses
-- (strike-rate / economy) evaluate PER INNINGS rather than per match. Under O4's
-- per-match economy definition those differ for a two-innings match. Resolving it
-- is engine work (src/engines/* is outside this slice's fences) and is due before
-- scoring values lock. The SAME applies to O4's second-innings multiplier
-- (v1.9): the data lands here, the arithmetic is an engine slice.
--
-- BACKWARD COMPATIBLE BY CONSTRUCTION: every added column has a DEFAULT, so
-- existing rows, the seed pair, and every existing test insert are unaffected
-- (they become innings 1, not_out false, maidens 0).

-- ===========================================================================
-- BATTING — innings key + the O4 not-out flag.
--
-- WHY not_out: O4 scores "duck −5" and "not out 5". Runs alone cannot tell them
-- apart — a batter dismissed for 0 is a duck, a batter unbeaten on 0 is not; and
-- an unbeaten score is not a duck at any total. Without this column the
-- information is simply absent from the raw truth and no recompute could ever
-- recover it. Captured now, consumed by the O4 scoring slice.
-- ===========================================================================
ALTER TABLE batting_lines
  ADD COLUMN innings  integer NOT NULL DEFAULT 1,
  ADD COLUMN not_out  boolean NOT NULL DEFAULT false;

ALTER TABLE batting_lines ADD CONSTRAINT batting_lines_innings_positive CHECK (innings >= 1);

ALTER TABLE batting_lines DROP CONSTRAINT batting_lines_pkey;
ALTER TABLE batting_lines ADD PRIMARY KEY (scorecard_id, innings, player_id);

COMMENT ON COLUMN batting_lines.innings IS
  'Which innings of the match this line belongs to (1-based). Two-day matches produce more than one (D5); the engine sums a player''s lines.';
COMMENT ON COLUMN batting_lines.not_out IS
  'Batter was unbeaten. Distinguishes O4''s not-out bonus from a duck; not derivable from runs.';

-- ===========================================================================
-- BOWLING — innings key + maidens (O4 "maiden 1"). Overs/runs/wickets already
-- carry everything else O4 needs (5WI derives from wickets; the economy bonus
-- derives from balls and runs conceded).
-- ===========================================================================
ALTER TABLE bowling_lines
  ADD COLUMN innings integer NOT NULL DEFAULT 1,
  ADD COLUMN maidens integer NOT NULL DEFAULT 0;

ALTER TABLE bowling_lines ADD CONSTRAINT bowling_lines_innings_positive CHECK (innings >= 1);
ALTER TABLE bowling_lines ADD CONSTRAINT bowling_lines_maidens_nonneg  CHECK (maidens >= 0);

ALTER TABLE bowling_lines DROP CONSTRAINT bowling_lines_pkey;
ALTER TABLE bowling_lines ADD PRIMARY KEY (scorecard_id, innings, player_id);

COMMENT ON COLUMN bowling_lines.innings IS
  'Which innings of the match this line belongs to (1-based), per D5.';
COMMENT ON COLUMN bowling_lines.maidens IS
  'Maiden overs bowled (O4 "maiden 1"). Captured now; consumed by the O4 scoring slice.';

-- ===========================================================================
-- DISMISSALS — innings key, and columns whose NAMES TELL THE TRUTH.
--
-- The prime invariant (D15) calls the scorecard the RAW truth, so a column named
-- `raw_text` must hold what actually arrived. It did not: the scoring engine
-- credits a fielder only when the token parsed out of this string is a member of
-- the lineup, and the lineup is a set of player IDs — so the string this column
-- has always had to hold, for fielding to score at all, is an ID-resolved one.
-- (Proof that this bit: the committed demo seed writes registry keys here, and
-- every fielding figure in supabase/seed/seed_derived.sql is 0.)
--
-- So the engine-facing column is renamed to say what it is, and the operator's
-- actual source string gets its own column:
--   * resolved_text — CANONICAL, engine-facing. Fielder positions hold player
--     ids, resolved at entry time against the registry under D22. This is what
--     scoreMatch parses.
--   * source_text   — the string as it ARRIVED (operator-typed, or later an
--     LLM transcription). Retained for audit per D22; never parsed for scoring.
--     NULL on rows that predate this migration, which is the honest value.
--
-- Name resolution happens at ENTRY time, never at scoring time (D25): the fielder
-- named in a dismissal string is identified by the SAME canonical player id used
-- for batting and bowling lines, resolved through D22 normalisation + a registry
-- lookup. An unmatched name blocks the commit and is asked about, never guessed
-- (KICKOFF DATA ENTRY, G12 discipline). A scorecard that genuinely does not name
-- the catcher earns no fielding credit — accepted, operator ruling D25.
-- ===========================================================================
ALTER TABLE dismissals RENAME COLUMN raw_text TO resolved_text;

ALTER TABLE dismissals
  ADD COLUMN innings     integer NOT NULL DEFAULT 1,
  ADD COLUMN source_text text;

ALTER TABLE dismissals ADD CONSTRAINT dismissals_innings_positive CHECK (innings >= 1);

ALTER TABLE dismissals DROP CONSTRAINT dismissals_pkey;
ALTER TABLE dismissals ADD PRIMARY KEY (scorecard_id, innings, seq);

COMMENT ON COLUMN dismissals.resolved_text IS
  'CANONICAL engine-facing dismissal string: fielder positions hold player ids, resolved against the registry under D22 at entry time. Parsed by scoreMatch for fielding credits.';
COMMENT ON COLUMN dismissals.source_text IS
  'The dismissal string as it arrived (operator-typed or transcribed), retained for audit per D22. Never parsed for scoring. NULL for rows predating this column.';
COMMENT ON COLUMN dismissals.innings IS
  'Which innings of the match this dismissal belongs to (1-based), per D5.';
