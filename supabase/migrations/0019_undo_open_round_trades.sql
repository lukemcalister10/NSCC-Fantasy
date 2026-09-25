-- Undo the latest completed trade submission before its round locks. The
-- original INSERT gives every row in a submission the same now() timestamp.
-- This also recognises submissions made before this migration, without a new
-- batch-id column. Keep a private audit copy before removing ledger rows.
CREATE TABLE trade_undo_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fantasy_team_id uuid NOT NULL REFERENCES fantasy_teams(id),
  round_id uuid NOT NULL REFERENCES rounds(id),
  undone_at timestamptz NOT NULL DEFAULT now(),
  undone_by uuid NOT NULL,
  rows_before jsonb NOT NULL
);

ALTER TABLE trade_undo_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trade_undo_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON trade_undo_log TO authenticated;
CREATE POLICY trade_undo_log_manager_read ON trade_undo_log
  FOR SELECT TO authenticated USING (app.is_manager());

-- Earlier RLS allows owners to edit/delete individual ledger rows directly,
-- but those actions never re-materialise selections. All participant ledger
-- changes must now be append-only or pass through the atomic undo function.
REVOKE UPDATE, DELETE ON trades FROM authenticated;

CREATE FUNCTION public.undo_latest_trades(p_team uuid, p_buy_trade uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app, pg_temp AS $$
DECLARE
  target_round uuid;
  batch_time timestamptz;
  latest_time timestamptz;
  lock_time timestamptz;
  round_seq integer;
  season uuid;
  buys integer;
  sells integer;
  total integer;
  round_count integer;
  round_row record;
  old_rows jsonb;
BEGIN
  -- Lock the owner's team row so two undos (or an ordinary FK-backed trade
  -- insert) cannot race on the same ledger. Managers do not gain an owner bypass.
  PERFORM 1 FROM fantasy_teams
   WHERE id = p_team AND owner_profile_id = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the team owner can undo their trades'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT round_id, created_at INTO target_round, batch_time
    FROM trades
   WHERE id = p_buy_trade AND fantasy_team_id = p_team AND kind = 'buy';
  IF target_round IS NULL THEN
    RAISE EXCEPTION 'Trade no longer exists; refresh the page'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT max(created_at) INTO latest_time
    FROM trades WHERE fantasy_team_id = p_team;
  IF batch_time IS DISTINCT FROM latest_time THEN
    RAISE EXCEPTION 'Undo the most recent trade batch first'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.lock_at, r.seq, r.season_id
    INTO lock_time, round_seq, season
    FROM rounds r WHERE r.id = target_round FOR SHARE;
  IF lock_time IS NULL OR now() >= lock_time THEN
    RAISE EXCEPTION 'This round has locked; its trades cannot be undone'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Same pending-results freeze as ordinary new trades.
  IF EXISTS (
    SELECT 1 FROM rounds prior JOIN matches m ON m.round_id = prior.id
    WHERE prior.season_id = season AND prior.seq < round_seq
      AND prior.lock_at <= now()
      AND (m.status NOT IN ('finalised', 'abandoned')
        OR (m.status = 'finalised' AND NOT EXISTS (
          SELECT 1 FROM player_match_scores score WHERE score.match_id = m.id
        )))
  ) THEN
    RAISE EXCEPTION 'trades are closed until the locked round scorecards and prices are processed'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM trades t
    JOIN scorecard_lineup sl ON sl.player_id = t.player_id
    JOIN scorecards sc ON sc.id = sl.scorecard_id
    JOIN matches m ON m.id = sc.match_id
    WHERE t.fantasy_team_id = p_team AND t.created_at = batch_time
      AND m.status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'A player in this trade batch has a match in progress'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) FILTER (WHERE kind = 'buy'),
         count(*) FILTER (WHERE kind = 'sell'), count(*),
         count(DISTINCT round_id),
         jsonb_agg(to_jsonb(t) ORDER BY t.id)
    INTO buys, sells, total, round_count, old_rows
    FROM trades t
   WHERE t.fantasy_team_id = p_team AND t.created_at = batch_time;
  -- Initial squad construction contains buys only. Incomplete/ambiguous
  -- timestamps are deliberately not undoable.
  IF buys = 0 OR buys <> sells OR total <> buys + sells OR round_count <> 1
     OR EXISTS (
       SELECT 1 FROM trades t
        WHERE t.fantasy_team_id = p_team AND t.created_at = batch_time
          AND t.round_id <> target_round
     ) THEN
    RAISE EXCEPTION 'This ledger group is not a complete trade batch'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO trade_undo_log
    (fantasy_team_id, round_id, undone_by, rows_before)
  VALUES (p_team, target_round, auth.uid(), old_rows);

  DELETE FROM trades
   WHERE fantasy_team_id = p_team AND created_at = batch_time
     AND round_id = target_round;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No trade rows were undone' USING ERRCODE = 'check_violation';
  END IF;

  -- Deletion alone does NOT fire the existing insert-only materialisation
  -- trigger. Rebuild every open round in this same transaction so the squad,
  -- captaincy and the ledger either all commit or all roll back together.
  FOR round_row IN
    SELECT id FROM rounds
     WHERE season_id = season AND lock_at > now()
     ORDER BY seq
  LOOP
    PERFORM app.materialise_selections(p_team, round_row.id);
  END LOOP;

  RETURN buys;
END $$;

REVOKE ALL ON FUNCTION public.undo_latest_trades(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_latest_trades(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
