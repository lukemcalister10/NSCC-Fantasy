-- NSCC Fantasy — AUTH BOUNDARY SLICE (G13): row-level security across the whole schema.
--
-- THE DATABASE IS THE GATEKEEPER (D16: "manager role enforced in the DB, not the UI").
-- 0002/0003 enforce WHEN a write is allowed and WHETHER it is well-formed, but for ANY
-- database role — they never enforced WHO. This migration adds that: RLS on every table,
-- DEFAULT-DENY, with the manager / participant / anon / service split expressed in
-- Postgres policies. It runs UNCHANGED on a real Supabase project (which already provides
-- the anon/authenticated/service_role roles + the auth schema) and, via the test-only
-- shim in test/helpers/pgliteDb.ts, on pglite in the gate suite.
--
-- ROLE MODEL (mirrors Supabase):
--   * anon          — logged-out. Reads NOTHING (D17/Law 11): every privilege revoked.
--   * authenticated — a signed-in user. "Manager" is NOT a separate role; it is
--                     authenticated + profiles.is_league_manager, so the manager/
--                     participant split lives in policy predicates, never in GRANTs.
--   * service_role  — the trusted backend (recompute). BYPASSRLS; writes derived state.
--   The bootstrap SUPERUSER (migrations, and every existing gate test) bypasses RLS too,
--   which is why the 82 prior tests stay green untouched: they run as superuser.
--
-- ENABLE (not FORCE) ROW LEVEL SECURITY: anon/authenticated are not table owners, so RLS
-- applies to them under plain ENABLE; the owner (superuser) and service_role (BYPASSRLS)
-- bypass — exactly what recompute needs. FORCE would only strip the owner's bypass, which
-- we do not want.
--
-- GOTCHA baked in below: with RLS enabled, a GRANT alone is NOT a read — a table with no
-- SELECT policy returns the empty set. Every readable table therefore gets an explicit
-- FOR SELECT policy. And RLS cannot restrict COLUMNS; profiles' column limits are
-- column-level GRANTs.

-- ===========================================================================
-- Helper predicates (schema `app`). SECURITY reasoning is load-bearing:
--   * is_manager() MUST be SECURITY INVOKER so current_user is the real SET ROLE
--     target (authenticated / service_role / superuser). A DEFINER version would see
--     current_user = the function OWNER (superuser) and return true for EVERYONE.
--   * only the profiles-flag read is SECURITY DEFINER, so it bypasses profiles RLS +
--     the profiles column-grants and cannot recurse through a profiles policy.
-- current_user (changed by SET ROLE), never session_user (stays the login role).
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS app;

-- DEFINER: reads profiles as the owner, bypassing RLS/column-grants/recursion.
CREATE OR REPLACE FUNCTION app._profile_is_manager() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_league_manager);
$$;

-- INVOKER: the role check runs as the acting role.
--   * superuser backend (migrations / gate tests) -> rolsuper
--   * service_role backend (recompute)            -> current_user = 'service_role'
--   * a signed-in league manager                  -> profiles.is_league_manager
CREATE OR REPLACE FUNCTION app.is_manager() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
      OR current_user = 'service_role'
      OR app._profile_is_manager();
$$;

-- DEFINER: ownership + lock lookups independent of the caller's RLS on those tables.
CREATE OR REPLACE FUNCTION app.owns_team(team uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM fantasy_teams WHERE id = team AND owner_profile_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION app.round_locked(round uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT now() >= (SELECT lock_at FROM rounds WHERE id = round);
$$;

GRANT USAGE ON SCHEMA app TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  app.is_manager(), app._profile_is_manager(),
  app.owns_team(uuid), app.round_locked(uuid)
  TO authenticated, service_role;

-- ===========================================================================
-- BYPASS AUTHORISATION (requirement 3). 0002's enforce_round_lock honoured
-- app.locks_bypass for ANY role. Here it is AUTHORISED: honoured only when the acting
-- user is a league manager (superuser/service_role backend, or an authed manager). A
-- non-manager who sets the GUC is ignored -> the normal per-round lock applies -> the
-- locked-round write is rejected. Body is otherwise identical to 0002 (append-only
-- discipline: 0002 stays untouched; the existing triggers rebind to this body by name).
-- ===========================================================================
CREATE OR REPLACE FUNCTION enforce_round_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE la timestamptz;
BEGIN
  IF current_setting('app.locks_bypass', true) IN ('on', 'true', '1')
     AND app.is_manager() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NEW.round_id IS NOT NULL THEN
    SELECT lock_at INTO la FROM rounds WHERE id = NEW.round_id;
    IF la IS NOT NULL AND now() >= la THEN
      RAISE EXCEPTION
        'round % is locked (lock_at %); % on % rejected at % (G4)',
        NEW.round_id, la, TG_OP, TG_TABLE_NAME, now()
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

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

-- ===========================================================================
-- CONFIG / IDENTITY
-- ===========================================================================

-- seasons: authed read; manager INSERT/UPDATE (season-lock trigger still governs
-- post-lock immutability). NO client DELETE even for managers — the ON DELETE CASCADE
-- fan-out (players/rounds/fantasy_teams -> derived) would wipe raw + derived truth;
-- season deletion, if ever, is an out-of-band service-role action.
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON seasons TO authenticated;
CREATE POLICY seasons_read   ON seasons FOR SELECT TO authenticated USING (true);
CREATE POLICY seasons_insert ON seasons FOR INSERT TO authenticated
  WITH CHECK (app.is_manager());
CREATE POLICY seasons_update ON seasons FOR UPDATE TO authenticated
  USING (app.is_manager()) WITH CHECK (app.is_manager());

-- profiles: every authed user reads the enumerated set {id, display_name, photo_path,
-- is_league_manager} of EVERY profile (Decision 1) — enforced as COLUMN GRANTs, since
-- RLS cannot limit columns; any future column is private by default (not in the grant).
-- Self-service UPDATE is display fields only; is_league_manager is in NO authenticated
-- grant, so it is not self-settable by a participant OR a manager (Decision 4) — it is
-- set out-of-band via service role / SQL editor. No client INSERT/DELETE: profile rows
-- are provisioned at signup (see SUPABASE_LIVE_VERIFY.md), keyed to auth.users.id.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- Strip any table-level (all-column) grant FIRST, so the column-scoped grants below are
-- the WHOLE story. This matters on a real project: Supabase's default privileges hand
-- `authenticated` a table-wide SELECT/UPDATE on new public tables, which would defeat the
-- column limits — letting a user read every column and even self-set is_league_manager via
-- the self-update policy. On pglite it is a harmless no-op. (RLS cannot restrict columns;
-- only GRANTs can — hence this belt-and-braces revoke.)
REVOKE ALL ON profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, display_name, photo_path, is_league_manager) ON profiles TO authenticated;
GRANT UPDATE (display_name, photo_path) ON profiles TO authenticated;
CREATE POLICY profiles_read        ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_self_update ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ===========================================================================
-- RAW TRUTH / SCORECARD FAMILY: authed READ; manager-only WRITE. The internal reads
-- of the mid-match (G6) and round-lock (G4) triggers run under RLS as the acting role,
-- so these SELECT policies are also what keep a legitimate participant's trade insert
-- from failing inside those triggers.
-- ===========================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'players','rounds','matches','scorecards','scorecard_lineup',
    'batting_lines','bowling_lines','dismissals'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)', t||'_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (app.is_manager())',
      t||'_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (app.is_manager()) WITH CHECK (app.is_manager())',
      t||'_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (app.is_manager())',
      t||'_delete', t);
  END LOOP;
END $$;

-- ===========================================================================
-- RAW USER ACTIONS: fantasy_teams / selections / trades
-- ===========================================================================

-- fantasy_teams: authed read of all teams (you play H2H against them). Participants
-- self-register their OWN team (owner_profile_id = auth.uid()); managers write any.
-- DELETE is manager-only (Decision 2 grants participants INSERT/UPDATE only; the
-- D21 season-lock trigger still freezes registration post-lock). Participant UPDATE is
-- NAME-ONLY: owner_profile_id / season_id are immutable to non-managers — enforced by a
-- trigger, because RLS WITH CHECK cannot compare NEW to OLD and manager/participant
-- share the single `authenticated` role (so a column-GRANT cannot split them).
ALTER TABLE fantasy_teams ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON fantasy_teams TO authenticated;
CREATE POLICY fantasy_teams_read   ON fantasy_teams FOR SELECT TO authenticated USING (true);
CREATE POLICY fantasy_teams_insert ON fantasy_teams FOR INSERT TO authenticated
  WITH CHECK (app.is_manager() OR owner_profile_id = auth.uid());
CREATE POLICY fantasy_teams_update ON fantasy_teams FOR UPDATE TO authenticated
  USING (app.is_manager() OR owner_profile_id = auth.uid())
  WITH CHECK (app.is_manager() OR owner_profile_id = auth.uid());
CREATE POLICY fantasy_teams_delete ON fantasy_teams FOR DELETE TO authenticated
  USING (app.is_manager());

CREATE FUNCTION app.enforce_fantasy_team_participant_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app.is_manager() THEN
    IF NEW.owner_profile_id IS DISTINCT FROM OLD.owner_profile_id
       OR NEW.season_id IS DISTINCT FROM OLD.season_id THEN
      RAISE EXCEPTION
        'fantasy_team %: participant update is name-only; owner_profile_id/season_id are immutable (D2/G13)',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_fantasy_teams_participant_update
  BEFORE UPDATE ON fantasy_teams
  FOR EACH ROW EXECUTE FUNCTION app.enforce_fantasy_team_participant_update();

-- BINDING DECISION 2 (operator rider): exactly ONE fantasy team per profile per season,
-- enforced as a UNIQUE INDEX, not merely a policy. 0001 already declares this as a table
-- UNIQUE constraint (which is backed by a unique index); this block GUARANTEES the index
-- is present in the auth slice and is a NO-OP on the standard schema — it detects an
-- existing unique index over exactly those two columns (regardless of name) and only
-- creates one if absent, so it never produces a duplicate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relname = 'fantasy_teams'
       AND i.indisunique
       AND (
         SELECT array_agg(a.attname::text ORDER BY a.attname::text)
           FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum = ANY (i.indkey::int2[])
       ) = ARRAY['owner_profile_id','season_id']
  ) THEN
    CREATE UNIQUE INDEX fantasy_teams_one_team_per_owner_season
      ON fantasy_teams (season_id, owner_profile_id);
  END IF;
END $$;

-- selections & trades: participants write their OWN team's rows (owns_team); managers
-- write any. READ is lock-gated (Decision 3): own rows always; a manager always; others'
-- rows only after THAT round's lock_at passes, then forever. WHEN/shape stays governed by
-- the existing triggers (G4 round-lock, G6 mid-match, G15 composition/count/cap, Rider-1
-- captain). Per-command policies: SELECT differs from write, and UPDATE needs both a
-- USING (the old row is yours) and a WITH CHECK (the new row stays yours).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['selections','trades'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (app.is_manager() OR app.owns_team(fantasy_team_id) OR app.round_locked(round_id))',
      t||'_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (app.is_manager() OR app.owns_team(fantasy_team_id))',
      t||'_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (app.is_manager() OR app.owns_team(fantasy_team_id)) WITH CHECK (app.is_manager() OR app.owns_team(fantasy_team_id))',
      t||'_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (app.is_manager() OR app.owns_team(fantasy_team_id))',
      t||'_delete', t);
  END LOOP;
END $$;

-- ===========================================================================
-- DERIVED STATE: authed READ of all (inherently league-public — standings, prices, and
-- per-team cap/round state, operator decision "all authed read"). NO write grant to
-- authenticated at all, so client writes (manager included — a manager is `authenticated`)
-- are permission-denied. Only service_role (recompute) / superuser writes them.
-- ===========================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'player_match_scores','price_history','team_cap_snapshots','team_round_scores',
    'h2h_results','ladder','overall_leaderboard'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)', t||'_read', t);
  END LOOP;
END $$;

-- ===========================================================================
-- LOGGED-OUT = NOTHING (D17): strip every default privilege from anon on public tables.
-- Belt-and-suspenders alongside RLS default-deny — with no grant, an anon read is a hard
-- permission error, not a silent empty set. And the trusted backend needs privileges as
-- well as BYPASSRLS (BYPASSRLS skips policies, not GRANT checks): give service_role full
-- table access explicitly so recompute's writeDerived runs from a clean apply.
-- ===========================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
