-- Informational availability only. No trade/selection/scoring locks altered.
BEGIN;
CREATE TABLE public.player_availability_days (
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  day_number smallint NOT NULL CHECK (day_number IN (1,2)),
  status text NOT NULL CHECK (status IN ('available','unavailable','automatic')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(round_id,player_id,day_number)
);
CREATE TRIGGER trg_availability_days_season BEFORE INSERT OR UPDATE ON public.player_availability_days
  FOR EACH ROW EXECUTE FUNCTION app.enforce_availability_season();
CREATE FUNCTION app.enforce_availability_days_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Coordinate with freeze's UPDATE so an in-flight edit cannot race past it.
  PERFORM 1 FROM public.rounds WHERE id IN
    (CASE WHEN TG_OP<>'INSERT' THEN OLD.round_id END,
     CASE WHEN TG_OP<>'DELETE' THEN NEW.round_id END)
    ORDER BY id FOR SHARE;
  IF (TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.rounds WHERE id=OLD.round_id AND scorecards_frozen_at IS NOT NULL))
     OR (TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM public.rounds WHERE id=NEW.round_id AND scorecards_frozen_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Availability round is frozen';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_availability_days_freeze BEFORE INSERT OR UPDATE OR DELETE ON public.player_availability_days
  FOR EACH ROW EXECUTE FUNCTION app.enforce_availability_days_freeze();
ALTER TABLE public.player_availability_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_availability_days FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.player_availability_days TO authenticated;
GRANT ALL ON public.player_availability_days TO service_role;
CREATE POLICY availability_days_read ON public.player_availability_days FOR SELECT TO authenticated USING (true);
CREATE POLICY availability_days_insert ON public.player_availability_days FOR INSERT TO authenticated WITH CHECK(app.is_manager());
CREATE POLICY availability_days_update ON public.player_availability_days FOR UPDATE TO authenticated USING(app.is_manager()) WITH CHECK(app.is_manager());
CREATE POLICY availability_days_delete ON public.player_availability_days FOR DELETE TO authenticated USING(app.is_manager());
COMMIT;
