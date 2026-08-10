-- NSCC Fantasy — SEASON LOCK AS AN OPERATOR ACTION (S-D). C5 / G10 / O3 / D21.
--
-- READ THIS FIRST, BECAUSE C5 OVERSTATES THE GAP. The season lock's ENFORCEMENT
-- half already exists and is verified: 0002_locks.sql's enforce_season_lock()
-- freezes seasons.config, enforce_player_lock() freezes starting_price/role/
-- wk_eligible, enforce_team_registration_lock() freezes registration (D21), the
-- cap is already computed BY the lock transition (O3/A7), an unpriced player
-- already blocks the lock (Rider 3), and locked_at is already one-way. All of it
-- is green in test/g10.season-lock.test.ts and test/g10.cap-at-lock.test.ts.
--
-- What was missing is the OPERATOR'S ACCESS to it: /admin/settings was a stub, so
-- the only way to fire the lock was `UPDATE seasons SET locked_at = now()` in the
-- SQL editor, and there was no way to see beforehand what cap that would compute.
-- That is what this migration and the settings page close.
--
-- FOUR THINGS THIS FILE ADDS (append-only: 0002 is untouched; enforce_season_lock
-- is rebound by name via CREATE OR REPLACE, exactly as 0004 rebound
-- enforce_round_lock — the existing trigger picks up the new body):
--
--  1. ONE ARITHMETIC, TWO CALLERS. app.season_pool_stats() computes the pool
--     figures and the O3 cap. The rehearsal preview and the lock itself both call
--     it. The preview is therefore not a MIRROR of the lock's arithmetic that has
--     to be kept honest — it IS the lock's arithmetic. There is no second
--     implementation to drift.
--  2. LEGIBLE REFUSALS. An empty pool, or a config missing squad.teamSize /
--     pricing.roundingIncrement, previously produced a NULL cap, which made
--     jsonb_set() return NULL and killed the UPDATE on seasons.config's NOT NULL
--     with "null value in column config" — a true refusal that told the operator
--     nothing. Every blocker now names itself, in the SAME words the preview
--     shows (app.season_lock_blocker is the single source of both).
--  3. NO CONFIG EDIT IN THE LOCKING STATEMENT. `UPDATE seasons SET config = …,
--     locked_at = now()` would compute the cap from a team size no preview ever
--     showed. Refused: save settings, re-read the preview, then lock.
--  4. POOL REMOVAL BEFORE LOCK (operator ruling, 10/08/2026). See the block above
--     app.enforce_player_removal() for the reasoning — it is the substantive
--     design decision in this file.
--
-- G11 NOTE: 0002 wrote the $100 rounding step as a literal (`/100 + 0.5) * 100`).
-- It is read from pricing.roundingIncrement here, so the lock path now carries no
-- economy constant at all. The fixture's increment IS 100, so no verified number
-- moves — test/g10.cap-at-lock.test.ts still computes $115,700.

-- ===========================================================================
-- POOL STATISTICS + THE O3 CAP — the one arithmetic.
--
--   cap = team_size × mean(starting_price over ALL players in the pool)
--         rounded to the nearest pricing.roundingIncrement, halves UP (D4/G14)
--
-- "ALL players" is literal (O3, operator ruling 10/08/2026) — active and inactive
-- alike. The operator REMOVES withdrawn registrants from the pool before locking
-- (see app.enforce_player_removal below), so at lock the pool contains only real
-- registrants and "all" needs no qualification. The active/inactive split is
-- reported anyway, as a pre-lock check that the removal has actually been done.
--
-- Returns exactly one row. Every field is NULL-safe: a missing config key or an
-- empty pool yields NULL rather than an error, so the BLOCKER function below can
-- name the problem instead of the caller hitting a cast failure.
-- ===========================================================================
CREATE FUNCTION app.season_pool_stats(p_season_id uuid, p_config jsonb)
RETURNS TABLE (
  team_size           numeric,
  rounding_increment  numeric,
  floor_price         bigint,
  pool_size           integer,
  priced_count        integer,
  unpriced_count      integer,
  active_count        integer,
  inactive_count      integer,
  mean_starting_price numeric,
  computed_cap        bigint,
  at_floor_count      integer
)
LANGUAGE sql STABLE AS $$
  WITH cfg AS (
    SELECT (p_config #>> '{squad,teamSize}')::numeric           AS ts,
           (p_config #>> '{pricing,roundingIncrement}')::numeric AS inc,
           (p_config #>> '{pricing,floor}')::bigint             AS fl
  ),
  pool AS (
    SELECT count(*)::int                             AS n,
           count(p.starting_price)::int              AS priced,
           count(*) FILTER (WHERE p.active)::int     AS act,
           avg(p.starting_price)                     AS mean,
           count(*) FILTER (
             WHERE p.starting_price = (SELECT fl FROM cfg)
           )::int                                    AS atfloor
      FROM players p
     WHERE p.season_id = p_season_id
  )
  SELECT cfg.ts,
         cfg.inc,
         cfg.fl,
         pool.n,
         pool.priced,
         pool.n - pool.priced,
         pool.act,
         pool.n - pool.act,
         pool.mean,
         -- D4 rounding: nearest increment, halves UP. floor(x/inc + 0.5) * inc on
         -- the positive raw cap — the same expression 0002 carried, with the step
         -- read from config instead of written down.
         CASE
           WHEN cfg.ts IS NULL OR cfg.inc IS NULL OR cfg.inc <= 0 OR pool.mean IS NULL
             THEN NULL
           ELSE (floor((cfg.ts * pool.mean) / cfg.inc + 0.5) * cfg.inc)::bigint
         END,
         pool.atfloor
    FROM cfg, pool;
$$;

-- ===========================================================================
-- THE BLOCKER — why this season cannot be locked right now, or NULL if it can.
--
-- Single source of truth for BOTH the preview's explanation and the trigger's
-- exception message, so the screen cannot promise a lock the database will
-- refuse, or refuse one in different words. Precedence is deliberate: config
-- validity first (nothing else is meaningful without it), then the pool.
-- ===========================================================================
CREATE FUNCTION app.season_lock_blocker(p_season_id uuid, p_config jsonb)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE st record;
BEGIN
  SELECT * INTO st FROM app.season_pool_stats(p_season_id, p_config);

  IF st.team_size IS NULL THEN
    RETURN 'config is missing squad.teamSize, so the salary cap cannot be computed (O3/D13)';
  END IF;
  IF st.rounding_increment IS NULL OR st.rounding_increment <= 0 THEN
    RETURN 'config is missing a positive pricing.roundingIncrement, so the cap cannot be rounded (D4/D13)';
  END IF;
  IF st.pool_size = 0 THEN
    RETURN 'the player pool is empty; the cap is team size × mean starting price and is undefined over no players (O3)';
  END IF;
  IF st.unpriced_count > 0 THEN
    -- Wording deliberately keeps "NULL starting_price" and "materialise": this is
    -- the Rider 3 refusal 0002 introduced and test/g10.season-lock.test.ts pins.
    RETURN format(
      '%s player(s) have a NULL starting_price; materialise every seed before locking — an unpriced player drops silently out of the mean the cap is computed from (Rider 3 / O3)',
      st.unpriced_count);
  END IF;

  RETURN NULL;
END $$;

-- ===========================================================================
-- THE LOCK ITSELF — rebound (0002's trigger picks this body up by name).
--
-- Behaviour preserved from 0002: post-lock config and locked_at are immutable;
-- the lock transition computes the O3 cap into the config being frozen, so the
-- cap is immutable afterwards "as the rest of config" for free.
--
-- Behaviour added: the same-statement config guard, and every refusal now speaks.
-- ===========================================================================
CREATE OR REPLACE FUNCTION enforce_season_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  blocker text;
  st      record;
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    -- Already locked: settings frozen. The one-way door.
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      RAISE EXCEPTION 'season % is locked; config is immutable (G10)',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      RAISE EXCEPTION 'season % is locked; locked_at cannot change (G10)',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;

  ELSIF NEW.locked_at IS NOT NULL THEN
    -- LOCK TRANSITION.
    --
    -- (i) The statement that locks may not also edit the economy. The rehearsal
    --     preview reads the STORED config; if this statement changed it, the cap
    --     would be computed from a team size no preview ever displayed, and
    --     "the preview shows the cap the lock will compute" would stop being
    --     true. Save settings, re-read the preview, then lock.
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      RAISE EXCEPTION
        'season %: the locking statement may not also change config — save settings first, then lock, so the rehearsal preview is what gets frozen (O3/G10)',
        NEW.id USING ERRCODE = 'check_violation';
    END IF;

    -- (ii) Whatever stops the lock, say it in the preview's own words.
    blocker := app.season_lock_blocker(NEW.id, OLD.config);
    IF blocker IS NOT NULL THEN
      RAISE EXCEPTION 'cannot lock season %: %', NEW.id, blocker
        USING ERRCODE = 'check_violation';
    END IF;

    -- (iii) Compute and freeze the cap (O3/A7) — 1.0×, no headroom, stars funded
    --       by basement filler, a knowing choice. Prices are materialised at
    --       exactly this moment (Rider 3), so the mean is well-defined.
    SELECT * INTO st FROM app.season_pool_stats(NEW.id, OLD.config);
    NEW.config := jsonb_set(NEW.config, '{squad,cap}', to_jsonb(st.computed_cap));
  END IF;

  RETURN NEW;
END $$;

-- ===========================================================================
-- POOL REMOVAL BEFORE LOCK (operator ruling, 10/08/2026).
--
-- WHY IT EXISTS. O3's cap is the mean over ALL players in the pool, taken
-- literally. A registrant who withdrew but lingers in the registry at the D4
-- floor therefore drags the mean — and the cap — down, which is the A9
-- pool-completeness warning running in reverse. The operator's answer is to
-- REMOVE such players before locking rather than to qualify O3's wording, so the
-- verified cap arithmetic never changes for UI convenience.
--
-- WHAT "REMOVE" MEANS, and why it is not a status flag.
--
--   * DELETE, but only when the player has NO RAW HISTORY. Derived scores,
--     prices and ladder rows reference players; deleting someone who has played
--     would break D15's recomputability, and — worse — dismissals.resolved_text
--     carries player ids as TEXT (D25), which no foreign key protects. A silent
--     break there is exactly the G12 unresolved-name failure mode. So every raw
--     reference is checked explicitly, including the dismissal strings, and the
--     refusal NAMES which one blocks it.
--
--   * NO "withdrawn" STATUS THAT EXCLUDES FROM THE MEAN. It was considered and
--     rejected: any such status changes the cap arithmetic from "mean over all
--     players" to "mean over players where status <> …", which is precisely the
--     change to verified arithmetic the operator declined. And it would buy
--     nothing real — season lock precedes round 1 (KICKOFF), so in a real season
--     NO player has raw history at lock time and the delete path covers every
--     case. The only way to reach the "otherwise" branch is a scratch/demo
--     season with matches already entered, where the cap does not matter.
--     A player who genuinely has history pre-lock stays in the pool and in the
--     mean; the preview shows the active/inactive split so that is visible
--     rather than silent.
--
--   * ACTIVE = FALSE REMAINS what it always was: "not selectable", not "not in
--     the pool". It does not affect the cap, and the preview says so.
--
--   * POST-LOCK REMOVAL IS REFUSED. The cap is a claim about the pool as it stood
--     at one instant; a pool that shrinks afterwards makes that claim
--     unreproducible. Mid-season ADDITIONS stay legal (C4) because they cannot
--     change a cap that is already computed and frozen — the asymmetry is
--     deliberate, and it is the difference between adding to a record and
--     editing one.
--
-- SECURITY DEFINER: the acting role is an authenticated manager, who by 0004 has
-- SELECT-only on derived tables. Clearing a removed player's derived rows is not
-- a hand-edit of derived state (D15) — those rows are recomputable and would be
-- rewritten wholesale by the next recompute; they are cleared here only so the
-- foreign keys do not block a removal the rules above have already allowed.
-- ===========================================================================
CREATE FUNCTION app.enforce_player_removal() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  locked   timestamptz;
  blockers text[] := '{}';
BEGIN
  SELECT s.locked_at INTO locked FROM seasons s WHERE s.id = OLD.season_id;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION
      'season % is locked; player % cannot be removed from the pool — the salary cap was computed over the pool as it stood at lock and a pool that changes afterwards makes that computation unreproducible. Set active = false instead (O3/D15/G10)',
      OLD.season_id, OLD.display_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- RAW references only. Derived rows are recomputable and are cleared below;
  -- price_history in particular holds a seq-0 seed row for EVERY player after any
  -- recompute, so treating it as "history" would block every removal.
  IF EXISTS (SELECT 1 FROM scorecard_lineup WHERE player_id = OLD.id) THEN
    blockers := blockers || 'named in a match lineup';
  END IF;
  IF EXISTS (SELECT 1 FROM batting_lines WHERE player_id = OLD.id) THEN
    blockers := blockers || 'has a batting line';
  END IF;
  IF EXISTS (SELECT 1 FROM bowling_lines WHERE player_id = OLD.id) THEN
    blockers := blockers || 'has a bowling line';
  END IF;
  IF EXISTS (SELECT 1 FROM scorecards WHERE wicket_keeper_player_id = OLD.id) THEN
    blockers := blockers || 'is a scorecard''s wicket-keeper';
  END IF;
  -- D25: the canonical dismissal string carries player ids as text. No FK guards
  -- this, so a delete here would silently orphan a fielding credit.
  IF EXISTS (SELECT 1 FROM dismissals WHERE resolved_text LIKE '%' || OLD.id::text || '%') THEN
    blockers := blockers || 'is credited in a dismissal string (D25)';
  END IF;
  IF EXISTS (SELECT 1 FROM selections WHERE player_id = OLD.id) THEN
    blockers := blockers || 'is selected by a fantasy team';
  END IF;
  IF EXISTS (SELECT 1 FROM trades WHERE player_id = OLD.id) THEN
    blockers := blockers || 'appears in a fantasy team''s trade ledger';
  END IF;

  IF array_length(blockers, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'player % cannot be removed: %. Removal is for registrants with no history; set active = false instead (D15)',
      OLD.display_name, array_to_string(blockers, '; ')
      USING ERRCODE = 'check_violation';
  END IF;

  -- No raw history: any derived rows are stale leftovers of an earlier recompute.
  DELETE FROM player_match_scores WHERE player_id = OLD.id;
  DELETE FROM price_history       WHERE player_id = OLD.id;
  UPDATE team_round_scores SET captain_player_id = NULL WHERE captain_player_id = OLD.id;

  RETURN OLD;
END $$;

CREATE TRIGGER trg_players_removal
  BEFORE DELETE ON players
  FOR EACH ROW EXECUTE FUNCTION app.enforce_player_removal();

-- Removing a registrant moves the pool the cap will be computed from, so it is at
-- least as economy-relevant as the edits 0005 already logs. The audit table's
-- player_id is ON DELETE SET NULL, so the detail carries the identifying facts.
ALTER TABLE player_registry_events DROP CONSTRAINT player_registry_events_event_check;
ALTER TABLE player_registry_events ADD CONSTRAINT player_registry_events_event_check
  CHECK (event IN ('create', 'update', 'delete'));

CREATE FUNCTION app.log_registry_removal() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO player_registry_events (season_id, player_id, event, actor, detail)
    VALUES (OLD.season_id, NULL, 'delete', auth.uid(), jsonb_build_object(
      'display_name',   OLD.display_name,
      'registry_key',   OLD.registry_key,
      'role',           OLD.role,
      'wk_eligible',    OLD.wk_eligible,
      'starting_price', OLD.starting_price,
      'active',         OLD.active,
      'removed_from_pool', true));
  RETURN NULL;
END $$;

CREATE TRIGGER trg_players_removal_log
  AFTER DELETE ON players
  FOR EACH ROW EXECUTE FUNCTION app.log_registry_removal();

-- ===========================================================================
-- THE REHEARSAL PREVIEW (KICKOFF: "rehearse on a scratch season before firing
-- it on the real one"). Reads live data and fires nothing.
--
-- In `public`, not `app`, because PostgREST only exposes `public` — the settings
-- page calls it as an RPC. SECURITY INVOKER, so the caller's RLS applies: it
-- reveals nothing an authenticated user could not already SELECT from `players`
-- and `seasons`, and a logged-out caller (who by 0004 has no grant on either)
-- gets a permission error rather than an answer.
--
-- `computed_cap` here is the cap the lock WILL write, from the same function the
-- lock calls; `blocker` is the refusal the lock WILL raise, in the same words.
-- ===========================================================================
CREATE FUNCTION public.season_lock_preview(p_season_id uuid)
RETURNS TABLE (
  season_id           uuid,
  season_name         text,
  locked_at           timestamptz,
  team_size           numeric,
  rounding_increment  numeric,
  floor_price         bigint,
  current_cap         bigint,
  pool_size           integer,
  priced_count        integer,
  unpriced_count      integer,
  active_count        integer,
  inactive_count      integer,
  mean_starting_price numeric,
  computed_cap        bigint,
  at_floor_count      integer,
  lockable            boolean,
  blocker             text
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
         st.computed_cap,
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

-- Functions default to EXECUTE for PUBLIC; strip that before granting, so a
-- logged-out caller cannot reach the preview even to be refused by RLS (D17).
REVOKE ALL ON FUNCTION public.season_lock_preview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.season_pool_stats(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.season_lock_blocker(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.season_lock_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.season_pool_stats(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.season_lock_blocker(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.season_lock_preview(uuid) IS
  'Rehearsal preview for the season lock (O3/G10): the pool figures, the cap the lock would compute, and the refusal it would raise — all from the same functions the lock itself calls. Fires nothing.';
