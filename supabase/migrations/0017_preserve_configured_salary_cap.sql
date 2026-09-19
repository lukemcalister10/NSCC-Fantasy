-- Preserve the advertised salary cap when the season is locked.
--
-- The player registry can contain deliberately exceptional prices (for example
-- promotional or joke entries). Recomputing the cap from the registry at lock
-- therefore makes a cap that teams have already built against move at the last
-- moment. The configured cap is now authoritative and the lock only freezes it.

CREATE OR REPLACE FUNCTION app.season_lock_blocker(p_season_id uuid, p_config jsonb)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE st record;
DECLARE configured_cap bigint;
BEGIN
  configured_cap := (p_config #>> '{squad,cap}')::bigint;
  SELECT * INTO st FROM app.season_pool_stats(p_season_id, p_config);

  IF configured_cap IS NULL OR configured_cap <= 0 THEN
    RETURN 'config is missing a positive squad.cap; set the advertised salary cap before locking';
  END IF;
  IF st.team_size IS NULL THEN
    RETURN 'config is missing squad.teamSize';
  END IF;
  IF st.pool_size = 0 THEN
    RETURN 'the player pool is empty';
  END IF;
  IF st.unpriced_count > 0 THEN
    RETURN format(
      '%s player(s) have a NULL starting_price; materialise every seed before locking',
      st.unpriced_count);
  END IF;

  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION enforce_season_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blocker text;
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      RAISE EXCEPTION 'season % is locked; config is immutable (G10)',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      RAISE EXCEPTION 'season % is locked; locked_at cannot change (G10)',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;

  ELSIF NEW.locked_at IS NOT NULL THEN
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      RAISE EXCEPTION
        'season %: the locking statement may not also change config -- save settings first, then lock',
        NEW.id USING ERRCODE = 'check_violation';
    END IF;

    blocker := app.season_lock_blocker(NEW.id, OLD.config);
    IF blocker IS NOT NULL THEN
      RAISE EXCEPTION 'cannot lock season %: %', NEW.id, blocker
        USING ERRCODE = 'check_violation';
    END IF;

    -- Deliberately do not rewrite config.squad.cap. The stored cap is the cap
    -- advertised to participants and becomes immutable with the rest of config.
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.season_lock_preview(p_season_id uuid)
RETURNS TABLE (
  season_id uuid,
  season_name text,
  locked_at timestamptz,
  team_size numeric,
  rounding_increment numeric,
  floor_price bigint,
  current_cap bigint,
  pool_size integer,
  priced_count integer,
  unpriced_count integer,
  active_count integer,
  inactive_count integer,
  mean_starting_price numeric,
  computed_cap bigint,
  at_floor_count integer,
  lockable boolean,
  blocker text
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT s.id,
         s.name,
         s.locked_at,
         st.team_size,
         st.rounding_increment,
         st.floor_price,
         (s.config #>> '{squad,cap}')::bigint,
         st.pool_size,
         st.priced_count,
         st.unpriced_count,
         st.active_count,
         st.inactive_count,
         st.mean_starting_price,
         -- Keep the existing result shape for clients: this is the cap the lock
         -- will freeze, which is now exactly the configured cap.
         (s.config #>> '{squad,cap}')::bigint,
         st.at_floor_count,
         s.locked_at IS NULL AND app.season_lock_blocker(s.id, s.config) IS NULL,
         CASE
           WHEN s.locked_at IS NOT NULL
             THEN 'this season is already locked; the lock is a one-way door (G10)'
           ELSE app.season_lock_blocker(s.id, s.config)
         END
    FROM seasons s
    CROSS JOIN LATERAL app.season_pool_stats(s.id, s.config) st
   WHERE s.id = p_season_id;
$$;

COMMENT ON FUNCTION public.season_lock_preview(uuid) IS
  'Read-only season-lock preview. The configured salary cap is authoritative and is frozen unchanged by the lock.';
