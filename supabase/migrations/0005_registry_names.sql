-- NSCC Fantasy — MANAGER-CORE SLICE (S-A), part 1 of 3: NAME NORMALISATION (D22)
-- + REGISTRY AUDIT LOG (C4 "logged") + MID-SEASON ADD DEFAULT (C4/O6).
--
-- THE DATABASE IS THE GATEKEEPER (D16). D22 says normalisation is applied "on
-- registry write AND on every inbound match attempt". A client-side normaliser
-- alone would be a convention, not a rule: the admin UI, the CSV importer, the
-- (later) transcription reviewer and the SQL editor are four different writers,
-- and any one of them skipping the step reintroduces exactly the O'Callaghan
-- failure. So normalisation is a BEFORE trigger here, and
-- src/registry/nameNormalisation.ts is the client-side mirror, held to this
-- implementation by test/d22.name-normalisation.test.ts (same case table, both
-- implementations, including the U+2019/U+0027 case).
--
-- Runs unchanged on a real Supabase project and on pglite (gate suite).

-- ===========================================================================
-- D22 — the normalisation function, verbatim and in order:
--   1. Unicode NFKC
--   2. curly apostrophes U+2018/U+2019   -> ASCII apostrophe U+0027
--   3. curly double quotes U+201C/U+201D -> ASCII quote U+0022
--   4. non-breaking space U+00A0         -> space
--   5. collapse internal whitespace runs to one space
--   6. trim
-- CASE and DIACRITICS are PRESERVED. NFKC already folds U+00A0 to a plain space,
-- but step 4 stays explicit so the code reads as the decision reads and does not
-- silently depend on that.
--
-- IMMUTABLE + STRICT so it can be used inside an index expression below.
-- ===========================================================================
CREATE OR REPLACE FUNCTION app.normalise_name(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT btrim(
           regexp_replace(
             translate(normalize(raw, NFKC), U&'\2018\2019\201C\201D\00A0', '''''"" '),
             '\s+', ' ', 'g'
           )
         );
$$;

GRANT EXECUTE ON FUNCTION app.normalise_name(text) TO authenticated, service_role;

-- Registry write path: display_name and registry_key are both stored normalised.
-- registry_key is NOT forced equal to display_name — existing seeds carry opaque
-- keys ('p01') and that stays legal; the admin UI mints registry_key from the
-- normalised display name for new entries, which is what makes an inbound name a
-- direct key lookup.
CREATE FUNCTION app.normalise_player_names() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.display_name := app.normalise_name(NEW.display_name);
  NEW.registry_key := app.normalise_name(NEW.registry_key);
  IF NEW.display_name = '' THEN
    RAISE EXCEPTION 'player display_name normalises to empty (D22)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_players_normalise_names
  BEFORE INSERT OR UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION app.normalise_player_names();

-- Backfill any pre-existing rows to the canonical form, then enforce ONE registry
-- entry per normalised name per season. Name-based matching (D22, G12) is only
-- meaningful if a normalised name resolves to exactly one player: two "J. Smith"
-- rows make every inbound "J. Smith" unresolvable. A real duplicate must be
-- disambiguated by the operator at the registry ("J. Smith (Jr)"), which is a
-- decision only a human can make — so this fails LOUDLY on apply rather than
-- guessing. Case-insensitive, diacritic-preserving: the same key the client uses.
UPDATE players
   SET display_name = app.normalise_name(display_name),
       registry_key = app.normalise_name(registry_key)
 WHERE display_name IS DISTINCT FROM app.normalise_name(display_name)
    OR registry_key IS DISTINCT FROM app.normalise_name(registry_key);

CREATE UNIQUE INDEX players_one_entry_per_name_per_season
  ON players (season_id, lower(app.normalise_name(display_name)));

-- ===========================================================================
-- REGISTRY AUDIT LOG (C4: mid-season additions are "logged"; and every pre-lock
-- role/price edit is an economy-relevant act worth a trail).
--
-- Written by TRIGGER, not by the client: a log the writer can skip is not a log.
-- The trigger function is SECURITY DEFINER so it can insert past this table's own
-- RLS while the acting role stays whoever made the change — `actor` is auth.uid(),
-- which is NULL for the superuser/service_role backends (migrations, recompute,
-- gate tests) and the manager's profile id for a real UI write.
-- ===========================================================================
CREATE TABLE player_registry_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id  uuid REFERENCES players(id) ON DELETE SET NULL,
  event      text NOT NULL CHECK (event IN ('create', 'update')),
  actor      uuid,                                  -- auth.uid(); NULL = backend
  at         timestamptz NOT NULL DEFAULT now(),
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb     -- {field: {from, to}} / row snapshot
);

CREATE INDEX player_registry_events_season_at ON player_registry_events (season_id, at DESC);

CREATE FUNCTION app.log_registry_event() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE d jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    d := jsonb_build_object(
      'display_name', NEW.display_name,
      'registry_key', NEW.registry_key,
      'role', NEW.role,
      'wk_eligible', NEW.wk_eligible,
      'starting_price', NEW.starting_price,
      'active', NEW.active,
      -- Mid-season add (C4): an INSERT into a LOCKED season. Recorded explicitly
      -- so the operator can tell a registration-window entry from a mid-season
      -- one without joining to the season's lock timestamp.
      'mid_season', (SELECT locked_at IS NOT NULL FROM seasons WHERE id = NEW.season_id)
    );
    INSERT INTO player_registry_events (season_id, player_id, event, actor, detail)
      VALUES (NEW.season_id, NEW.id, 'create', auth.uid(), d);
    RETURN NULL;
  END IF;

  -- UPDATE: record only what actually changed, as {field: {from, to}}.
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    d := d || jsonb_build_object('display_name',
      jsonb_build_object('from', OLD.display_name, 'to', NEW.display_name));
  END IF;
  IF NEW.registry_key IS DISTINCT FROM OLD.registry_key THEN
    d := d || jsonb_build_object('registry_key',
      jsonb_build_object('from', OLD.registry_key, 'to', NEW.registry_key));
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    d := d || jsonb_build_object('role',
      jsonb_build_object('from', OLD.role, 'to', NEW.role));
  END IF;
  IF NEW.wk_eligible IS DISTINCT FROM OLD.wk_eligible THEN
    d := d || jsonb_build_object('wk_eligible',
      jsonb_build_object('from', OLD.wk_eligible, 'to', NEW.wk_eligible));
  END IF;
  IF NEW.starting_price IS DISTINCT FROM OLD.starting_price THEN
    d := d || jsonb_build_object('starting_price',
      jsonb_build_object('from', OLD.starting_price, 'to', NEW.starting_price));
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    d := d || jsonb_build_object('active',
      jsonb_build_object('from', OLD.active, 'to', NEW.active));
  END IF;

  IF d <> '{}'::jsonb THEN
    INSERT INTO player_registry_events (season_id, player_id, event, actor, detail)
      VALUES (NEW.season_id, NEW.id, 'update', auth.uid(), d);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_players_registry_log
  AFTER INSERT OR UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION app.log_registry_event();

-- Read: manager only (it carries the economy's edit history). Write: nobody from
-- a client — the trigger is the only writer, and it is SECURITY DEFINER.
ALTER TABLE player_registry_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON player_registry_events TO authenticated;
CREATE POLICY player_registry_events_read ON player_registry_events
  FOR SELECT TO authenticated USING (app.is_manager());

-- ===========================================================================
-- MID-SEASON ADD (C4 / KICKOFF "Registry supports mid-season player additions").
-- 0002 already allows the INSERT post-lock (only UPDATE of price/role/wk_eligible
-- is frozen). This fills the default: a player added to a LOCKED season with no
-- price stated is priced at the config floor (O6 $9,000 in the season economy,
-- whatever floor the frozen config carries here — no constant in this file).
--
-- PRE-lock, a NULL starting_price stays NULL: Rider 3 / the 0001 COMMENT say
-- prices materialise at season lock, and defaulting them to floor here would
-- silently price the whole registration window at the floor.
--
-- THE CAP IS NOT TOUCHED (O3/A7): it was computed by the lock action over the
-- pool as it stood at that moment and is frozen inside the locked config. Adding
-- a player mid-season changes the pool but never the cap.
-- ===========================================================================
CREATE FUNCTION app.default_mid_season_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked timestamptz; cfg jsonb; floor_price bigint;
BEGIN
  IF NEW.starting_price IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT locked_at, config INTO locked, cfg FROM seasons WHERE id = NEW.season_id;
  IF locked IS NULL THEN
    RETURN NEW;                                  -- pre-lock: NULL is legal
  END IF;
  floor_price := (cfg #>> '{pricing,floor}')::bigint;
  IF floor_price IS NULL THEN
    RAISE EXCEPTION
      'cannot default mid-season price for player %: season config missing pricing.floor (C4/O6)',
      NEW.display_name USING ERRCODE = 'check_violation';
  END IF;
  NEW.starting_price := floor_price;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_players_mid_season_price
  BEFORE INSERT ON players
  FOR EACH ROW EXECUTE FUNCTION app.default_mid_season_price();
