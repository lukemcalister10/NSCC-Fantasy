-- NSCC Fantasy — LOCKS SLICE enforcement (G4 / G6 / G10 + Rider 1 / Rider 3 / D19 / D21).
--
-- THE DATABASE IS THE GATEKEEPER (D16: "manager role enforced in the DB, not the
-- UI"). Every rule below is a trigger/constraint so it runs against pglite in the
-- gate suite exactly as it runs on a real Supabase instance, and cannot be
-- bypassed by any future client. App-level checks may duplicate these later for
-- friendlier errors; this file stays authoritative.
--
-- WRITE-TIME vs DERIVE-TIME (operator note): lock enforcement compares
-- rounds.lock_at / matches.status / seasons.locked_at against now() at WRITE time
-- — that is correct. Recompute stays a pure function of raw data and never
-- consults the clock; nothing here touches the recompute path.
--
-- AUTHORISATION (temporary, until G13/RLS): these triggers fire for ANY database
-- role — they enforce WHEN a write is allowed, not WHO may write. Role-gating
-- (only the league manager may mutate settings, etc.) arrives with the auth/RLS
-- slice (G13). Until then any connected role can trip these guards — a known,
-- temporary state.

-- ===========================================================================
-- G4 — ROUND LOCK (per-round lock_at). Team changes (selections) and trades are
-- rejected once the round they belong to has locked. Read PER-ROUND (D6), against
-- now() at write time. Fires on INSERT/UPDATE/DELETE:
--   * INSERT / UPDATE -> the NEW round must be open.
--   * UPDATE / DELETE -> the OLD round must be open too, so a row cannot be moved
--     ACROSS the lock boundary in EITHER direction (Rider 1 of the approval).
-- Deliberately NOT on scorecards: "correct the scorecard, recompute" (G3) must
-- keep working after a round locks.
--
-- REPAIR PATH (Rider 2 of the approval): a session may set the GUC
-- app.locks_bypass to on/true/1 to suspend ONLY these round-lock guards — the
-- league manager's escape hatch when the recompute price-integrity assert
-- (Rider 2) forces a post-lock correction to a trade/selection. WHO is allowed to
-- set the GUC is G13's problem; this file only wires the hatch. The bypass does
-- NOT apply to the mid-match, season, config, starting-price, or team-registration
-- guards below.
-- ===========================================================================
CREATE FUNCTION enforce_round_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE la timestamptz;
BEGIN
  -- Manager repair hatch: default off (unset -> current_setting returns '' with
  -- the missing_ok=true form, so the IN () test is false and the guard applies).
  IF current_setting('app.locks_bypass', true) IN ('on', 'true', '1') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- NEW side (INSERT, UPDATE). On DELETE, NEW is NULL -> NEW.round_id is NULL.
  IF NEW.round_id IS NOT NULL THEN
    SELECT lock_at INTO la FROM rounds WHERE id = NEW.round_id;
    IF la IS NOT NULL AND now() >= la THEN
      RAISE EXCEPTION
        'round % is locked (lock_at %); % on % rejected at % (G4)',
        NEW.round_id, la, TG_OP, TG_TABLE_NAME, now()
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- OLD side (UPDATE, DELETE). On INSERT, OLD is NULL -> OLD.round_id is NULL.
  IF OLD.round_id IS NOT NULL THEN
    SELECT lock_at INTO la FROM rounds WHERE id = OLD.round_id;
    IF la IS NOT NULL AND now() >= la THEN
      RAISE EXCEPTION
        'round % is locked (lock_at %); % on % rejected at % (G4)',
        OLD.round_id, la, TG_OP, TG_TABLE_NAME, now()
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_selections_round_lock
  BEFORE INSERT OR UPDATE OR DELETE ON selections
  FOR EACH ROW EXECUTE FUNCTION enforce_round_lock();

CREATE TRIGGER trg_trades_round_lock
  BEFORE INSERT OR UPDATE OR DELETE ON trades
  FOR EACH ROW EXECUTE FUNCTION enforce_round_lock();

-- ===========================================================================
-- G6 / D7 — MID-MATCH TRADE LOCK, both directions. A player whose match has
-- STARTED but is not finalised (status 'in_progress') can be neither bought nor
-- sold. Membership is via scorecard_lineup (the named XI) — the same link that
-- drives DNP vs played. A player id is season-scoped, so this never leaks across
-- seasons.
--   * 'finalised' releases the lock (repriced, tradeable again).
--   * 'abandoned' releases the lock too (D19) — a match dying between days cannot
--     freeze trading forever. Both fall out for free: the guard fires ONLY on
--     'in_progress', so any other status is allowed.
-- NO bypass GUC here (the repair hatch is scoped to the round-lock guards).
-- OPERATIONAL DEPENDENCY (recorded in README / Definition of Healthy): this guard
-- only bites once a lineup exists for the in_progress match, so lineups must be
-- entered when a match goes in_progress — day-one entry for two-day matches.
-- ===========================================================================
CREATE FUNCTION enforce_midmatch_trade_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM matches m
      JOIN scorecards s        ON s.match_id = m.id
      JOIN scorecard_lineup sl ON sl.scorecard_id = s.id
     WHERE m.status = 'in_progress'
       AND sl.player_id = NEW.player_id
  ) THEN
    RAISE EXCEPTION
      'player % is in a match in progress; % rejected until finalised or abandoned (D7/G6)',
      NEW.player_id, NEW.kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_trades_midmatch_lock
  BEFORE INSERT OR UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION enforce_midmatch_trade_lock();

-- ===========================================================================
-- G10 — SEASON LOCK. One explicit operator action (setting seasons.locked_at)
-- freezes the economy. Enforced in three guards:
--
-- (a) seasons: once locked, config and locked_at are immutable. On the lock
--     transition (locked_at NULL -> NOT NULL) EVERY player in the season must
--     already carry a starting_price (Rider 3 / the 0001 COMMENT binding): the DB
--     refuses to lock a season with any un-materialised seed. Once completeness
--     passes the SALARY CAP is computed BY this same lock action (O3/A7):
--       cap = team_size × mean(starting_price over ALL players), nearest $100.
--     Prices are materialised at exactly this moment (Rider 3), so the mean is
--     well-defined; 1.0× (no headroom) — stars are funded by basement filler, a
--     knowing choice (O3). The computed cap is written into the SAME config jsonb
--     being frozen, so post-lock it is immutable "as the rest of config" for free
--     (the OLD.locked_at branch above rejects any later config mutation). After
--     lock, recompute reads only stored values (orchestrator seeds from
--     players.starting_price; cap flows from seasons.config).
-- ===========================================================================
CREATE FUNCTION enforce_season_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mean_price numeric;
  team_size  numeric;
  computed_cap bigint;
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    -- Already locked: settings frozen.
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      RAISE EXCEPTION 'season % is locked; config is immutable (G10)',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      RAISE EXCEPTION 'season % is locked; locked_at cannot change (G10)',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.locked_at IS NOT NULL THEN
    -- Lock transition: refuse to lock while any player lacks a starting price.
    IF EXISTS (
      SELECT 1 FROM players WHERE season_id = NEW.id AND starting_price IS NULL
    ) THEN
      RAISE EXCEPTION
        'cannot lock season %: one or more players have NULL starting_price; materialise all seeds first (Rider 3 / G10)',
        NEW.id USING ERRCODE = 'check_violation';
    END IF;

    -- O3/A7 cap-at-lock: completeness passed, so mean(starting_price) is
    -- well-defined over the whole pool. cap = team_size × mean, rounded to the
    -- nearest $100 with halves UP (D4/G14): floor(x/100 + 0.5) * 100 on the
    -- positive raw cap. team_size comes from the config being locked.
    SELECT avg(starting_price) INTO mean_price
      FROM players WHERE season_id = NEW.id;
    team_size := (NEW.config #>> '{squad,teamSize}')::numeric;
    computed_cap := floor((team_size * mean_price) / 100 + 0.5) * 100;
    NEW.config := jsonb_set(NEW.config, '{squad,cap}', to_jsonb(computed_cap));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_seasons_lock
  BEFORE UPDATE ON seasons
  FOR EACH ROW EXECUTE FUNCTION enforce_season_lock();

-- (b) players: post-lock the frozen-at-lock attributes — starting_price (D4,
--     hand-adjustable pre-lock only), role and wk_eligible (D9, frozen at lock) —
--     are immutable. INSERT is deliberately still allowed: the registry supports
--     mid-season player additions (KICKOFF), priced at floor / manager value.
CREATE FUNCTION enforce_player_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked timestamptz;
BEGIN
  SELECT locked_at INTO locked FROM seasons WHERE id = OLD.season_id;
  IF locked IS NOT NULL THEN
    IF NEW.starting_price IS DISTINCT FROM OLD.starting_price
       OR NEW.role        IS DISTINCT FROM OLD.role
       OR NEW.wk_eligible IS DISTINCT FROM OLD.wk_eligible THEN
      RAISE EXCEPTION
        'season % is locked; player % starting_price/role/wk_eligible are frozen (D4/D9/G10)',
        OLD.season_id, OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_players_lock
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION enforce_player_lock();

-- (c) fantasy_teams: post-lock the team SET is frozen (D21) — H2H fixtures are
--     DERIVED from the sorted team-id set (circle method), so determinism needs a
--     stable set. Registration (INSERT) and deregistration (DELETE) are both
--     rejected once the season is locked. Name UPDATE is left alone (cosmetic;
--     home/away come from circle orientation, never from the row).
CREATE FUNCTION enforce_team_registration_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; locked timestamptz;
BEGIN
  sid := COALESCE(NEW.season_id, OLD.season_id);
  SELECT locked_at INTO locked FROM seasons WHERE id = sid;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION
      'season % is locked; fantasy-team registration is frozen (D21/G10)',
      sid USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_fantasy_teams_registration_lock
  BEFORE INSERT OR DELETE ON fantasy_teams
  FOR EACH ROW EXECUTE FUNCTION enforce_team_registration_lock();

-- ===========================================================================
-- RIDER 1 — MANDATORY CAPTAIN (the ">= 1" half). 0001 enforces "<= 1 captain per
-- (team, round)" with the one_captain_per_team_round partial unique index; this
-- adds "exactly one", i.e. every (team, round) that has ANY selection must have
-- exactly one is_captain. That is a cross-row invariant over sibling rows, so it
-- can be neither a CHECK nor a unique index — it must be checked when the row-set
-- is COMPLETE, i.e. at COMMIT. A DEFERRABLE INITIALLY DEFERRED constraint trigger
-- does exactly that, letting a team's selections insert in any order within one
-- transaction. A (team, round) with zero selections (team didn't field) is skipped.
-- ===========================================================================
CREATE FUNCTION enforce_mandatory_captain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; rid uuid; n int; caps int;
BEGIN
  tid := COALESCE(NEW.fantasy_team_id, OLD.fantasy_team_id);
  rid := COALESCE(NEW.round_id, OLD.round_id);
  SELECT count(*), count(*) FILTER (WHERE is_captain)
    INTO n, caps
    FROM selections
   WHERE fantasy_team_id = tid AND round_id = rid;
  IF n > 0 AND caps <> 1 THEN
    RAISE EXCEPTION
      'team % round %: exactly one captain required among its selections (has %) (Rider 1)',
      tid, rid, caps USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_selections_mandatory_captain
  AFTER INSERT OR UPDATE OR DELETE ON selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_mandatory_captain();
