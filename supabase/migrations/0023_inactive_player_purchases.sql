-- Inactive players remain owned, priced, selectable as existing holdings and
-- sellable. Only NEW participant purchases are refused. Trusted history imports
-- and repairs may still reference a player who has since become inactive.
CREATE FUNCTION app.enforce_active_player_purchase()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE
  is_active boolean;
BEGIN
  IF NEW.kind <> 'buy' OR auth.role() <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  -- Preserve RLS as the first observable refusal for another owner's team.
  IF NOT app.owns_team(NEW.fantasy_team_id) THEN
    RETURN NEW;
  END IF;
  -- Editing metadata on an existing purchase must not invalidate ownership.
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.kind, NEW.player_id, NEW.fantasy_team_id, NEW.round_id)
       IS NOT DISTINCT FROM ROW(OLD.kind, OLD.player_id, OLD.fantasy_team_id, OLD.round_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- SHARE conflicts with the manager's active-status UPDATE, so a concurrent
  -- purchase and deactivation are judged in their committed order.
  SELECT active INTO is_active FROM players WHERE id = NEW.player_id FOR SHARE;
  IF is_active = false THEN
    RAISE EXCEPTION 'inactive player % cannot be bought; existing owners may keep or sell them', NEW.player_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_trades_active_player_purchase
  BEFORE INSERT OR UPDATE OF kind, player_id, fantasy_team_id, round_id ON trades
  FOR EACH ROW EXECUTE FUNCTION app.enforce_active_player_purchase();

REVOKE ALL ON FUNCTION app.enforce_active_player_purchase() FROM public;
