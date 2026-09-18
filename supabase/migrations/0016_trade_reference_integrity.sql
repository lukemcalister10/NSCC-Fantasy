-- Keep every participant-owned row inside one season, and never trust a price
-- supplied by the browser. Recompute already enforces Rider 2 after the fact;
-- these guards enforce it at the write boundary so a malformed ledger cannot
-- be committed in the first place.

CREATE FUNCTION app.price_entering_round(p_player uuid, p_round uuid)
  RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT ph.price
        FROM price_history ph
        JOIN matches m ON m.id = ph.match_id
        JOIN rounds movement_round ON movement_round.id = m.round_id
        JOIN rounds trade_round ON trade_round.id = p_round
       WHERE ph.player_id = p_player
         AND movement_round.season_id = trade_round.season_id
         AND movement_round.seq < trade_round.seq
       ORDER BY ph.seq DESC
       LIMIT 1
    ),
    (SELECT p.starting_price FROM players p WHERE p.id = p_player)
  );
$$;

CREATE FUNCTION app.enforce_trade_reference_integrity()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE
  team_season uuid;
  round_season uuid;
  player_season uuid;
  expected_price bigint;
BEGIN
  -- Let RLS reject a participant targeting somebody else's team. Running the
  -- detailed checks first would disclose whether referenced ids/prices exist.
  IF auth.role() = 'authenticated' AND NOT app.owns_team(NEW.fantasy_team_id) THEN
    RETURN NEW;
  END IF;

  SELECT season_id INTO team_season FROM fantasy_teams WHERE id = NEW.fantasy_team_id;
  SELECT season_id INTO round_season FROM rounds WHERE id = NEW.round_id;
  SELECT season_id INTO player_season FROM players WHERE id = NEW.player_id;

  IF team_season IS DISTINCT FROM round_season
     OR team_season IS DISTINCT FROM player_season THEN
    RAISE EXCEPTION
      'trade references must belong to the same season (team %, round %, player %)',
      team_season, round_season, player_season
      USING ERRCODE = 'check_violation';
  END IF;

  -- Raw/import workflows run as a trusted database or service role and can load
  -- trades before derived price_history. Participant browser writes cannot: the
  -- owner must use the authoritative price entering the target round.
  -- A locked-round attempt is rejected by the dedicated lock trigger. Avoid
  -- masking that clearer error (and the manager repair hatch) with price detail.
  IF auth.role() = 'authenticated'
     AND EXISTS (SELECT 1 FROM rounds r WHERE r.id = NEW.round_id AND r.lock_at > now()) THEN
    expected_price := app.price_entering_round(NEW.player_id, NEW.round_id);
    IF expected_price IS NULL THEN
      RAISE EXCEPTION
        'player % has no price entering round %', NEW.player_id, NEW.round_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.price <> expected_price THEN
      RAISE EXCEPTION
        'trade price % does not equal price entering round % (%) for player %',
        NEW.price, NEW.round_id, expected_price, NEW.player_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_trades_reference_integrity
  BEFORE INSERT OR UPDATE OF fantasy_team_id, round_id, player_id, price ON trades
  FOR EACH ROW EXECUTE FUNCTION app.enforce_trade_reference_integrity();

CREATE FUNCTION app.enforce_selection_reference_integrity()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE
  team_season uuid;
  round_season uuid;
  player_season uuid;
BEGIN
  -- As above, preserve RLS as the first observable failure for another user's
  -- team instead of leaking reference details from this trigger.
  IF auth.role() = 'authenticated' AND NOT app.owns_team(NEW.fantasy_team_id) THEN
    RETURN NEW;
  END IF;

  SELECT season_id INTO team_season FROM fantasy_teams WHERE id = NEW.fantasy_team_id;
  SELECT season_id INTO round_season FROM rounds WHERE id = NEW.round_id;
  SELECT season_id INTO player_season FROM players WHERE id = NEW.player_id;

  IF team_season IS DISTINCT FROM round_season
     OR team_season IS DISTINCT FROM player_season THEN
    RAISE EXCEPTION
      'selection references must belong to the same season (team %, round %, player %)',
      team_season, round_season, player_season
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_selections_reference_integrity
  BEFORE INSERT OR UPDATE OF fantasy_team_id, round_id, player_id ON selections
  FOR EACH ROW EXECUTE FUNCTION app.enforce_selection_reference_integrity();

-- Fail the migration rather than silently preserving any historical corruption.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM trades t
      JOIN fantasy_teams ft ON ft.id = t.fantasy_team_id
      JOIN rounds r ON r.id = t.round_id
      JOIN players p ON p.id = t.player_id
     WHERE ft.season_id IS DISTINCT FROM r.season_id
        OR ft.season_id IS DISTINCT FROM p.season_id
  ) OR EXISTS (
    SELECT 1
      FROM selections s
      JOIN fantasy_teams ft ON ft.id = s.fantasy_team_id
      JOIN rounds r ON r.id = s.round_id
      JOIN players p ON p.id = s.player_id
     WHERE ft.season_id IS DISTINCT FROM r.season_id
        OR ft.season_id IS DISTINCT FROM p.season_id
  ) THEN
    RAISE EXCEPTION 'existing cross-season trade or selection references require repair';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM trades t
     WHERE t.price IS DISTINCT FROM app.price_entering_round(t.player_id, t.round_id)
  ) THEN
    RAISE EXCEPTION 'existing trade prices do not match price entering their rounds';
  END IF;
END $$;

REVOKE ALL ON FUNCTION app.price_entering_round(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION app.enforce_trade_reference_integrity() FROM public;
REVOKE ALL ON FUNCTION app.enforce_selection_reference_integrity() FROM public;
