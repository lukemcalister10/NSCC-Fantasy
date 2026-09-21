-- Do not open the next round's trading while a locked round's results are
-- still unprocessed. The older player-level in_progress guard depends on
-- manager-entered lineups and cannot cover a whole weekend before upload.
CREATE FUNCTION app.enforce_pending_results_trade_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app, pg_temp AS $$
DECLARE target_round rounds%ROWTYPE;
BEGIN
  SELECT * INTO target_round FROM rounds WHERE id = NEW.round_id;
  IF target_round.id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1
    FROM rounds prior
    JOIN matches m ON m.round_id = prior.id
    WHERE prior.season_id = target_round.season_id
      AND prior.seq < target_round.seq
      AND prior.lock_at <= now()
      AND (
        m.status NOT IN ('finalised', 'abandoned')
        OR (m.status = 'finalised' AND NOT EXISTS (
          SELECT 1 FROM player_match_scores score WHERE score.match_id = m.id
        ))
      )
  ) THEN
    RAISE EXCEPTION
      'trades are closed until the locked round scorecards and prices are processed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_trades_pending_results_lock
  BEFORE INSERT OR UPDATE OF round_id, player_id, kind, price ON trades
  FOR EACH ROW EXECUTE FUNCTION app.enforce_pending_results_trade_lock();
