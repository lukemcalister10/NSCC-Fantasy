-- NSCC Fantasy — MANAGER-CORE SLICE (S-A), part 3 of 3: SCORECARD FREEZE (D24).
--
-- D24 (DECISION_LOG v1.9): a round's scorecards are editable until the operator
-- MANUALLY ends lockout for that round, after which they are FROZEN — no
-- corrections, even for discovered errors — with a DELIBERATE, LOGGED override
-- (who / when / why) for catastrophic cases.
--
-- WHAT THIS BUYS (recorded in the ruling): once a round is frozen, no scorecard
-- under it can change, so no price movement can ever be recomputed retrospectively
-- for that round. Purchase prices and cap balances therefore cannot be invalidated
-- after the fact — the recompute price-integrity assert (Rider 2) can no longer be
-- tripped by a late correction to a settled round.
--
-- WHAT IT DOES NOT TOUCH: recompute. Freezing bars edits to RAW truth (matches and
-- scorecards); the derived chain is rewritten wholesale by recompute whenever it
-- runs (D15/G3), and a frozen round simply always recomputes to the same answer.
-- That is the point.
--
-- THE DATABASE IS THE GATEKEEPER (D16): enforced as triggers over every raw
-- scorecard table, so a direct API call, the SQL editor, or any future client hits
-- the same wall the UI does. The UI refusal is chrome; this is the rule.

-- ===========================================================================
-- The freeze mark. NULL = round open for scorecard entry and correction.
-- Non-NULL = lockout ended at that moment; frozen from then on.
-- ===========================================================================
ALTER TABLE rounds ADD COLUMN scorecards_frozen_at timestamptz;

COMMENT ON COLUMN rounds.scorecards_frozen_at IS
  'D24: operator manually ended scorecard lockout for this round at this instant. NULL = still editable. One-way: it cannot be cleared or moved; the logged override is the only post-freeze write path.';

-- One-way door. Clearing or moving the mark would be an unlogged un-freeze — i.e.
-- a silent backdoor around the override that exists precisely to be noisy. Setting
-- it for the first time is the operator's deliberate act and is allowed.
CREATE FUNCTION app.enforce_freeze_mark_one_way() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.scorecards_frozen_at IS NOT NULL
     AND NEW.scorecards_frozen_at IS DISTINCT FROM OLD.scorecards_frozen_at THEN
    RAISE EXCEPTION
      'round %: scorecard lockout already ended at % and cannot be cleared or moved (D24)',
      OLD.id, OLD.scorecards_frozen_at USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rounds_freeze_mark_one_way
  BEFORE UPDATE ON rounds
  FOR EACH ROW EXECUTE FUNCTION app.enforce_freeze_mark_one_way();

-- ===========================================================================
-- THE OVERRIDE LOG. Every write that survives a freeze lands here — one row per
-- affected table row, recording who, when, why, and what was touched.
--
-- Written by the enforcement trigger itself, never by a client: an override that
-- depends on the overrider remembering to log it is not a logged override. The
-- INSERT goes through a SECURITY DEFINER helper so it can write past this table's
-- own RLS; the enforcement trigger stays SECURITY INVOKER, because app.is_manager()
-- reads current_user and a DEFINER context would make it answer for the function
-- OWNER — i.e. true for everyone (the trap documented in 0004).
-- ===========================================================================
CREATE TABLE scorecard_override_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  operation  text NOT NULL,
  actor      uuid,                    -- auth.uid(); NULL = superuser/service backend
  at         timestamptz NOT NULL DEFAULT now(),
  reason     text NOT NULL
);

CREATE INDEX scorecard_override_log_round_at ON scorecard_override_log (round_id, at DESC);

ALTER TABLE scorecard_override_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON scorecard_override_log TO authenticated;
CREATE POLICY scorecard_override_log_read ON scorecard_override_log
  FOR SELECT TO authenticated USING (app.is_manager());

CREATE FUNCTION app.log_scorecard_override(
  round uuid, tbl text, op text, why text
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO scorecard_override_log (round_id, table_name, operation, actor, reason)
  VALUES (round, tbl, op, auth.uid(), why);
$$;

GRANT EXECUTE ON FUNCTION app.log_scorecard_override(uuid, text, text, text)
  TO authenticated, service_role;

-- ===========================================================================
-- ENFORCEMENT. Fires on every raw table a scorecard correction could go through,
-- including `matches` itself — flipping a frozen round's match to 'abandoned'
-- would erase its scores as surely as deleting a batting line (D19).
--
-- THE OVERRIDE HANDSHAKE, deliberately awkward: the writer must (a) be a league
-- manager and (b) state a reason in the transaction-local GUC
-- `app.scorecard_override_reason`. Two steps, one of which is prose, so it cannot
-- be done by reflex — and the prose is what lands in the log. A non-manager who
-- sets the GUC is ignored, exactly as with the round-lock hatch in 0004.
--
--   SELECT set_config('app.scorecard_override_reason', 'why this must change', true);
--   UPDATE batting_lines SET runs = 42 WHERE ...;   -- logged, allowed
-- ===========================================================================
CREATE FUNCTION app.enforce_scorecard_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rid    uuid;
  frozen timestamptz;
  why    text;
  row_r  record;
BEGIN
  IF TG_OP = 'DELETE' THEN row_r := OLD; ELSE row_r := NEW; END IF;

  -- Resolve the round this write belongs to, per table.
  IF TG_TABLE_NAME = 'matches' THEN
    rid := row_r.round_id;
  ELSIF TG_TABLE_NAME = 'scorecards' THEN
    SELECT m.round_id INTO rid FROM matches m WHERE m.id = row_r.match_id;
  ELSE
    SELECT m.round_id INTO rid
      FROM scorecards s JOIN matches m ON m.id = s.match_id
     WHERE s.id = row_r.scorecard_id;
  END IF;

  IF rid IS NULL THEN
    RETURN COALESCE(NEW, OLD);          -- orphan/unresolvable: other FKs govern
  END IF;

  SELECT scorecards_frozen_at INTO frozen FROM rounds WHERE id = rid;
  IF frozen IS NULL THEN
    RETURN COALESCE(NEW, OLD);          -- round still open: ordinary entry
  END IF;

  why := nullif(btrim(current_setting('app.scorecard_override_reason', true)), '');
  IF why IS NOT NULL AND app.is_manager() THEN
    PERFORM app.log_scorecard_override(rid, TG_TABLE_NAME, TG_OP, why);
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'round % scorecards are frozen (lockout ended %); % on % refused — a league manager must set app.scorecard_override_reason to override, and the override is logged (D24)',
    rid, frozen, TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER trg_matches_scorecard_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON matches
  FOR EACH ROW EXECUTE FUNCTION app.enforce_scorecard_freeze();

CREATE TRIGGER trg_scorecards_scorecard_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON scorecards
  FOR EACH ROW EXECUTE FUNCTION app.enforce_scorecard_freeze();

CREATE TRIGGER trg_scorecard_lineup_scorecard_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON scorecard_lineup
  FOR EACH ROW EXECUTE FUNCTION app.enforce_scorecard_freeze();

CREATE TRIGGER trg_batting_lines_scorecard_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON batting_lines
  FOR EACH ROW EXECUTE FUNCTION app.enforce_scorecard_freeze();

CREATE TRIGGER trg_bowling_lines_scorecard_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON bowling_lines
  FOR EACH ROW EXECUTE FUNCTION app.enforce_scorecard_freeze();

CREATE TRIGGER trg_dismissals_scorecard_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON dismissals
  FOR EACH ROW EXECUTE FUNCTION app.enforce_scorecard_freeze();

-- KNOWN CONSEQUENCE, accepted and recorded: because these triggers fire on DELETE
-- too, deleting a ROUND or SEASON that owns frozen scorecards is refused — the
-- ON DELETE CASCADE reaches `matches` and trips the guard. That is the intended
-- reading of D24 (frozen raw truth does not evaporate because a parent row was
-- dropped); an out-of-band teardown must state an override reason like any other
-- post-freeze write.
