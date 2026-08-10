-- NSCC Fantasy — ENGINE SLICE (S-F), part 2 of 2: D26 SELECTION MATERIALISATION.
--
-- OPERATOR RULING (D26): "You shouldn't need to open the app. Your team can be
-- set and forget and the trades are a choice. If you have a valid team at round 0,
-- it's submitted; and carries over." Selections and holdings are ONE AND THE SAME
-- (no bench, no emergency): a participant's round selection set IS their holdings
-- at that round's lock, so the set is DERIVED, never authored, and no weekly
-- confirm flow may exist. The only way to score zero is to hold nobody.
--
-- WHAT THIS REPLACES. S-C built the carry-forward client-side, on app visit. It
-- cannot cover a participant who never opens the app — which is the whole reason
-- D26 exists — and it is the second writer that produced C7's duplicate-key
-- banner. Per D26 it is REMOVED when this lands, not kept as a fallback: two
-- writers of the same rows is how they diverge. That deletion is in this same
-- commit (app/routes/Team.tsx).
--
-- MECHANISM: DESIGN A, EAGER AND TRIGGER-DRIVEN (A12), in preference to a
-- scheduled job at lock. Trades are already refused after lock (0002's
-- trg_trades_round_lock), so the selection set FREEZES AT LOCK automatically —
-- no scheduler is needed, and D26(d) ("registering after the lock means you miss
-- the round") falls out for free because only OPEN rounds are ever materialised.
-- The decisive argument is participant-facing: G15's composition check then fires
-- IN FRONT OF the participant at trade time, rather than silently at lock with
-- nobody watching.
--
-- SECURITY DEFINER, and why that is not a hole: the function writes ONLY the
-- (team, round) rows implied by that team's own trades ledger, and every trigger
-- that calls it passes a team the acting role has just written a trade for (or,
-- for the rounds triggers, runs on a manager's write). It never reads a caller
-- parameter that could point it at another participant's team. Definer rights are
-- needed because 0004's selections policies are scoped to app.owns_team(), and a
-- manager creating a round must be able to materialise every participant's set.
--
-- IT DOES NOT WEAKEN ANY GUARD. The writes below pass through 0002's round-lock
-- guard (immediate) and 0003's composition + 0002's mandatory-captain guards
-- (DEFERRABLE INITIALLY DEFERRED, judged once at COMMIT over the finished set).
-- That deferral is what makes a trade PAIR safe: after the sell row the team
-- momentarily holds one player too few, the set is re-materialised by the buy row
-- in the same transaction, and only the final set is judged.

-- ---------------------------------------------------------------------------
-- app.current_price(player) — the player's current price, for the "dearest
-- holding" captaincy fallback ONLY. Last price_history row, else the starting
-- price, else 0. Deliberately not used for anything that touches the cap: the
-- ledger stores price-at-time (D8) and this is a tiebreak, not money.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.current_price(p_player uuid)
  RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT ph.price FROM price_history ph
      WHERE ph.player_id = p_player ORDER BY ph.seq DESC LIMIT 1),
    (SELECT p.starting_price FROM players p WHERE p.id = p_player),
    0
  );
$$;

-- ===========================================================================
-- app.materialise_selections(team, round)
--
-- Rewrites the (team, round) selection set from the trades ledger and carries
-- captaincy forward. Idempotent: running it twice in a row leaves the same rows.
-- ===========================================================================
CREATE FUNCTION app.materialise_selections(p_team uuid, p_round uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE
  is_open   boolean;
  cur_seq   int;
  held      uuid[];
  cap_id    uuid;
  vice_id   uuid;
BEGIN
  -- ---- Only OPEN rounds (D26 c/d) ----------------------------------------
  -- Lock is the correct boundary, not round start: trades are legal until lock,
  -- so holdings-at-lock is the team that plays. A locked round is history and is
  -- left exactly as it was.
  SELECT r.lock_at > now(), r.seq INTO is_open, cur_seq
    FROM rounds r WHERE r.id = p_round;
  IF is_open IS NOT TRUE THEN
    RETURN;
  END IF;

  -- ---- Holdings, by replaying the ledger (THE LEDGER IS AUTHORITATIVE) -----
  -- Identical semantics to holdingsFromLedger() and to the recompute
  -- orchestrator's ledger replay: chronological by created_at with id as the
  -- stable tiebreak, a buy sets the holding and a sell removes it, and the LAST
  -- event for a player decides whether they are held. Holdings are taken over the
  -- WHOLE ledger, not just this round's rows.
  SELECT COALESCE(array_agg(o.player_id ORDER BY o.player_id), '{}')
    INTO held
    FROM (
      SELECT DISTINCT ON (t.player_id) t.player_id, t.kind
        FROM trades t
       WHERE t.fantasy_team_id = p_team
       ORDER BY t.player_id, t.created_at DESC, t.id DESC
    ) o
   WHERE o.kind = 'buy';

  -- Holds nobody: the set is emptied, and the team scores zero this round. That
  -- is D26(e) — the ONLY way to score zero — not an error state.
  IF cardinality(held) = 0 THEN
    DELETE FROM selections WHERE fantasy_team_id = p_team AND round_id = p_round;
    RETURN;
  END IF;

  -- ---- Captaincy carry-forward (mirrors resolveCaptaincy exactly) ----------
  -- Preference order, each candidate filtered to CURRENT holdings:
  --   1. this round's existing captain
  --   2. the most recent EARLIER round's captain, then its vice
  --   3. the dearest holding — a deterministic fallback, so Rider 1's
  --      mandatory-captain invariant can always be satisfied without asking the
  --      participant anything. "Dearest" is the player's current price: the last
  --      price_history row, else the starting price, with player_id ascending as
  --      the tiebreak (the same order the client's byPrice sort produces).
  SELECT s.player_id INTO cap_id
    FROM selections s
   WHERE s.fantasy_team_id = p_team AND s.round_id = p_round AND s.is_captain
     AND s.player_id = ANY(held);

  IF cap_id IS NULL THEN
    SELECT s.player_id INTO cap_id
      FROM selections s JOIN rounds r ON r.id = s.round_id
     WHERE s.fantasy_team_id = p_team AND r.seq < cur_seq AND s.is_captain
       AND s.player_id = ANY(held)
     ORDER BY r.seq DESC
     LIMIT 1;
  END IF;

  IF cap_id IS NULL THEN
    SELECT s.player_id INTO cap_id
      FROM selections s JOIN rounds r ON r.id = s.round_id
     WHERE s.fantasy_team_id = p_team AND r.seq < cur_seq AND s.is_vice_captain
       AND s.player_id = ANY(held)
     ORDER BY r.seq DESC
     LIMIT 1;
  END IF;

  IF cap_id IS NULL THEN
    SELECT h INTO cap_id
      FROM unnest(held) AS h
     ORDER BY app.current_price(h) DESC, h ASC
     LIMIT 1;
  END IF;

  -- Vice: this round's, else the most recent earlier round's, else the dearest
  -- holding that is not the captain. Never the same player as the captain.
  SELECT s.player_id INTO vice_id
    FROM selections s
   WHERE s.fantasy_team_id = p_team AND s.round_id = p_round AND s.is_vice_captain
     AND s.player_id = ANY(held)
     AND s.player_id <> cap_id;

  IF vice_id IS NULL THEN
    SELECT s.player_id INTO vice_id
      FROM selections s JOIN rounds r ON r.id = s.round_id
     WHERE s.fantasy_team_id = p_team AND r.seq < cur_seq AND s.is_vice_captain
       AND s.player_id = ANY(held)
       AND s.player_id <> cap_id
     ORDER BY r.seq DESC
     LIMIT 1;
  END IF;

  IF vice_id IS NULL THEN
    SELECT h INTO vice_id
      FROM unnest(held) AS h
     WHERE h <> cap_id
     ORDER BY app.current_price(h) DESC, h ASC
     LIMIT 1;
  END IF;

  -- ---- Rewrite the set -----------------------------------------------------
  -- DELETE-then-INSERT rather than an upsert. The captaincy flags are covered by
  -- the partial unique indexes one_captain_per_team_round /
  -- one_vice_captain_per_team_round, so moving the armband between two existing
  -- rows would trip the index part-way through a multi-row statement unless the
  -- flags were cleared first. Clearing the whole set is simpler and says what it
  -- means: the set is DERIVED, so it is rebuilt, never patched.
  DELETE FROM selections WHERE fantasy_team_id = p_team AND round_id = p_round;

  INSERT INTO selections (fantasy_team_id, round_id, player_id, is_captain, is_vice_captain)
  SELECT p_team, p_round, h,
         h = cap_id,
         vice_id IS NOT NULL AND h = vice_id
    FROM unnest(held) AS h;
END $$;

COMMENT ON FUNCTION app.materialise_selections(uuid, uuid) IS
  'D26: rewrite a (team, round) selection set from the trades ledger, carrying captaincy forward. Open rounds only, so the set freezes at lock. Idempotent.';


-- ===========================================================================
-- TRIGGER POINT 1 — AFTER INSERT ON trades.
-- Re-materialise EVERY OPEN round for each team that traded, not just the trade's
-- own round: a trade made now changes who the team fields in every round still
-- ahead of it, which is exactly the "carries over" half of the operator's ruling.
--
-- FOR EACH STATEMENT, over a transition table, and that choice is load-bearing.
-- The app writes a whole squad in ONE insert (buildInitialSquad) and a trade PAIR
-- in ONE insert (executeTradePair), precisely so the deferred cap and composition
-- guards judge a complete set. Materialising per ROW would instead run once per
-- intermediate ledger state — after the first buy of a six-player squad the team
-- "holds" one player, and the captaincy carried out of that state then STICKS,
-- because "this round's existing flags win" is the first rule of the carry-forward
-- (A12). Per statement, the function sees only the finished ledger, so the flags
-- it derives do not depend on the order rows happen to sit in inside one insert.
-- ===========================================================================
CREATE FUNCTION app.trg_trades_materialise() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT t.fantasy_team_id AS team_id, rd.id AS round_id, rd.seq
      FROM new_trades t
      JOIN fantasy_teams ft ON ft.id = t.fantasy_team_id
      JOIN rounds rd ON rd.season_id = ft.season_id
     WHERE rd.lock_at > now()
     ORDER BY t.fantasy_team_id, rd.seq
  LOOP
    PERFORM app.materialise_selections(r.team_id, r.round_id);
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_trades_materialise_selections
  AFTER INSERT ON trades
  REFERENCING NEW TABLE AS new_trades
  FOR EACH STATEMENT EXECUTE FUNCTION app.trg_trades_materialise();

-- ===========================================================================
-- TRIGGER POINT 2 — AFTER INSERT ON rounds. A new round on the board is
-- immediately populated for every registered team, so a participant who never
-- opens the app is fielding a team in it from the moment it exists.
-- ===========================================================================
CREATE FUNCTION app.trg_rounds_materialise() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT ft.id FROM fantasy_teams ft WHERE ft.season_id = NEW.season_id ORDER BY ft.id
  LOOP
    PERFORM app.materialise_selections(t.id, NEW.id);
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_rounds_materialise_selections
  AFTER INSERT ON rounds
  FOR EACH ROW EXECUTE FUNCTION app.trg_rounds_materialise();

-- ===========================================================================
-- TRIGGER POINT 3 — AFTER UPDATE OF lock_at ON rounds, when the lock moves INTO
-- THE FUTURE. A round that was locked (or whose lock passed) and is then reopened
-- by the manager becomes materialisable again; without this it would keep whatever
-- set it held when it locked, which is right for history but wrong for a round the
-- manager has deliberately reopened.
--
-- The reverse direction needs nothing: moving a lock EARLIER only freezes the set
-- sooner, and the set is already correct.
-- ===========================================================================
CREATE FUNCTION app.trg_rounds_lock_moved_materialise() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE t record;
BEGIN
  IF NEW.lock_at > now() AND (OLD.lock_at IS DISTINCT FROM NEW.lock_at) THEN
    FOR t IN
      SELECT ft.id FROM fantasy_teams ft WHERE ft.season_id = NEW.season_id ORDER BY ft.id
    LOOP
      PERFORM app.materialise_selections(t.id, NEW.id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_rounds_lock_moved_materialise_selections
  AFTER UPDATE OF lock_at ON rounds
  FOR EACH ROW EXECUTE FUNCTION app.trg_rounds_lock_moved_materialise();

-- ===========================================================================
-- BACKFILL — the one-time catch-up for everything that already exists.
--
-- WITHOUT THIS THE FIX WOULD NOT REACH THE LIVE SEASON. The three triggers above
-- only fire on FUTURE writes, so a team that already holds players and a round
-- that already exists would sit unmaterialised until somebody happened to trade —
-- and the client-side writer that used to cover them is deleted in this same
-- commit. Every open round of every season is materialised here, once, at
-- migration time. It is the same idempotent function, so a round already holding
-- the right rows is rewritten to exactly what it already had.
-- ===========================================================================
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT ft.id AS team_id, rd.id AS round_id
      FROM fantasy_teams ft
      JOIN rounds rd ON rd.season_id = ft.season_id
     WHERE rd.lock_at > now()
     ORDER BY ft.id, rd.seq
  LOOP
    PERFORM app.materialise_selections(rec.team_id, rec.round_id);
  END LOOP;
END $$;

-- ===========================================================================
-- public.materialise_selections(round) — THE OPERATOR/PARTICIPANT REPAIR PATH,
-- and the closing of follow-up F1.
--
-- The client no longer writes selection rows at all (Team.tsx's carry-forward is
-- deleted in this same commit), so the /team reconciliation control needs a way
-- to ask for a re-materialisation without becoming a second writer itself. This
-- wrapper is that way: it re-runs the SAME function the triggers run, so there is
-- exactly ONE piece of code in the system that writes a selection set.
--
-- AUTHORISATION IS EXPLICIT, because this one IS callable from a browser: the
-- caller may re-materialise only their OWN team, unless they are the league
-- manager. app.owns_team / app.is_manager are 0004's own helpers, so this agrees
-- with the RLS policies on selections rather than reimplementing them.
--
-- It should be a no-op in practice. Divergence between ledger and selections was
-- possible when the ledger write and the materialisation were two round trips
-- from a browser (F2/F3's atomicity seam); the trigger runs inside the trade's
-- own transaction, so the two cannot come apart any more. This exists for the
-- case nobody predicted, and returns the number of players fielded so the caller
-- can say something true.
-- ===========================================================================
CREATE FUNCTION public.materialise_selections(p_round uuid)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, app, pg_temp
AS $$
DECLARE
  tid uuid;
  n   int;
BEGIN
  SELECT ft.id INTO tid
    FROM fantasy_teams ft
    JOIN rounds r ON r.season_id = ft.season_id
   WHERE r.id = p_round AND app.owns_team(ft.id);

  IF tid IS NULL THEN
    RAISE EXCEPTION 'no team of yours in this round'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM app.materialise_selections(tid, p_round);

  SELECT count(*) INTO n
    FROM selections WHERE fantasy_team_id = tid AND round_id = p_round;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.materialise_selections(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.materialise_selections(uuid) TO authenticated;

COMMENT ON FUNCTION public.materialise_selections(uuid) IS
  'D26/F1: re-run materialisation for the CALLER''S OWN team in one round. The only client-reachable way to write a selection set; the rows themselves are still written solely by app.materialise_selections.';
