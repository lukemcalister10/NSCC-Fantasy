-- D33: frozen pre-season RETURNER medians, not live pool medians or price floor.
-- No existing player, price history, trade, score or salary cap is changed here.
BEGIN;

ALTER TABLE public.seasons ADD COLUMN newcomer_role_prices jsonb;
ALTER TABLE public.seasons ADD CONSTRAINT seasons_newcomer_role_prices_valid CHECK (
  newcomer_role_prices IS NULL OR COALESCE((
    jsonb_typeof(newcomer_role_prices) = 'object'
    AND newcomer_role_prices ?& ARRAY['BAT','BWL','AR','WK']
    AND jsonb_typeof(newcomer_role_prices->'BAT') = 'number'
    AND jsonb_typeof(newcomer_role_prices->'BWL') = 'number'
    AND jsonb_typeof(newcomer_role_prices->'AR') = 'number'
    AND jsonb_typeof(newcomer_role_prices->'WK') = 'number'
    AND (newcomer_role_prices->>'BAT')::numeric > 0
    AND (newcomer_role_prices->>'BWL')::numeric > 0
    AND (newcomer_role_prices->>'AR')::numeric > 0
    AND (newcomer_role_prices->>'WK')::numeric > 0
    AND (newcomer_role_prices->>'BAT')::numeric % 1 = 0
    AND (newcomer_role_prices->>'BWL')::numeric % 1 = 0
    AND (newcomer_role_prices->>'AR')::numeric % 1 = 0
    AND (newcomer_role_prices->>'WK')::numeric % 1 = 0
  ), false)
);

-- Exact live season only. Values approved 15 September 2026 (DECISION_LOG D33).
UPDATE public.seasons
SET newcomer_role_prices = '{"BAT":29100,"BWL":28800,"AR":38600,"WK":21900}'::jsonb
WHERE id = 'edd67f68-d2a1-45f5-98ff-e8c718d1562b';

CREATE FUNCTION app.freeze_newcomer_role_prices() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.newcomer_role_prices IS DISTINCT FROM OLD.newcomer_role_prices THEN
    RAISE EXCEPTION 'newcomer role prices are frozen after season lock (D33)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_seasons_newcomer_role_prices
BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION app.freeze_newcomer_role_prices();

CREATE OR REPLACE FUNCTION app.default_mid_season_price() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE locked timestamptz; benchmarks jsonb; default_price bigint;
BEGIN
  IF NEW.starting_price IS NOT NULL THEN RETURN NEW; END IF;
  SELECT locked_at, newcomer_role_prices INTO locked, benchmarks
    FROM public.seasons WHERE id = NEW.season_id;
  IF locked IS NULL THEN RETURN NEW; END IF;
  default_price := (benchmarks ->> NEW.role::text)::bigint;
  IF default_price IS NULL THEN
    RAISE EXCEPTION 'no pre-season newcomer benchmark configured for role %; set an explicit price (D33)', NEW.role
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.starting_price := default_price;
  RETURN NEW;
END $$;

COMMIT;
