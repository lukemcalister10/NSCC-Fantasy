-- Per-round player availability. A row exists only when the manager has marked
-- a player available or unavailable; no row means no indication.
CREATE TABLE player_availability (
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('available', 'unavailable')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, player_id)
);

CREATE FUNCTION app.enforce_availability_season() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM rounds r
      JOIN players p ON p.season_id = r.season_id
     WHERE r.id = NEW.round_id AND p.id = NEW.player_id
  ) THEN
    RAISE EXCEPTION 'player and availability round must belong to the same season'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_player_availability_season
  BEFORE INSERT OR UPDATE ON player_availability
  FOR EACH ROW EXECUTE FUNCTION app.enforce_availability_season();

-- Availability closes with the same per-round lock as team changes. The next
-- open round starts with no rows, which is the automatic reset.
CREATE TRIGGER trg_player_availability_round_lock
  BEFORE INSERT OR UPDATE OR DELETE ON player_availability
  FOR EACH ROW EXECUTE FUNCTION enforce_round_lock();

ALTER TABLE player_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_availability FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON player_availability TO authenticated;
GRANT ALL ON player_availability TO service_role;

CREATE POLICY player_availability_read ON player_availability
  FOR SELECT TO authenticated USING (true);
CREATE POLICY player_availability_insert ON player_availability
  FOR INSERT TO authenticated WITH CHECK (app.is_manager());
CREATE POLICY player_availability_update ON player_availability
  FOR UPDATE TO authenticated USING (app.is_manager()) WITH CHECK (app.is_manager());
CREATE POLICY player_availability_delete ON player_availability
  FOR DELETE TO authenticated USING (app.is_manager());
