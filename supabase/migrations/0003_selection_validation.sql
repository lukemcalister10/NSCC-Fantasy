-- NSCC Fantasy — SELECTION VALIDATION SLICE (G15, DoD v1.2 amendment A8).
--
-- THE DATABASE IS THE GATEKEEPER (D16). Like the locks slice (0002), every rule
-- here is a trigger/constraint so it runs against pglite in the gate suite exactly
-- as it runs on a real Supabase instance, and cannot be bypassed by any client.
-- These two guards are the FIRST write-time validation of a team's selection set
-- and of its trades against the salary cap — until now composition/size/trade/cap
-- were only shape (config type) or derive-time (recompute) or lock-time (cap-at-lock).
--
-- WHY DEFERRABLE CONSTRAINT TRIGGERS (same family as Rider 1's mandatory captain,
-- 0002_locks.sql:234-254): a team's SIZE / role-minimum / trade-count / cap position
-- are cross-row invariants over a whole (team, round) or (team) row-set. They can be
-- judged only when the set is COMPLETE, i.e. at COMMIT — neither a CHECK nor a unique
-- index can express them. INITIALLY DEFERRED lets a team's selections/trades insert in
-- any order within one transaction (a sell can fund a buy regardless of row order), and
-- the check runs once, at commit, over the finished set. A (team, round) with ZERO
-- selections is skipped (the team didn't field) — exactly as the mandatory-captain guard.
--
-- NO BYPASS. Unlike the round-lock guard (which honours app.locks_bypass as the
-- manager's repair hatch, Rider 2), selection validation has no escape hatch: G15 is
-- "violations rejected server-side" full stop. The gate suite proves this by exercising
-- the guards on direct writes with nothing set.
--
-- CONFIG SOURCE: all limits are read from the frozen season config jsonb
-- (seasons.config #>> '{squad,...}'), the same accessor enforce_season_lock uses
-- (0002_locks.sql:167). A config missing teamSize / roleMinimums / tradesPerRound /
-- cap fails LOUDLY at validation time (partial-config guard) — never a silent pass.

-- ===========================================================================
-- G15(a) — SELECTION COMPOSITION + SIZE + WK, at COMMIT over the (team, round) set.
--   (1) count = teamSize
--   (2) per-role counts >= roleMinimums, STRICT counting: a player fills only its
--       own role's minimum (an AR never counts toward BAT). flex = teamSize − Σ min
--       is the unconstrained remainder — it needs no explicit check (it is exactly
--       the slack left once size = teamSize and every minimum is met).
--   (3) WK minimum satisfiable by WK-role OR wk_eligible players (D9), NO DOUBLE
--       COUNT: a wk_eligible non-WK can keep wicket only out of its role's SURPLUS
--       above that role's own minimum. Reserve each own-role minimum first; the WK
--       slot then draws from WK-role players (free keepers) plus leftover wk_eligible
--       capacity. This rejects e.g. {2 BAT(1 wke), 2 BWL, 2 AR, 0 WK} under the
--       fixture — no legal keeper assignment exists — which a naive
--       count(WK OR wk_eligible) would wrongly pass.
-- ===========================================================================
CREATE FUNCTION enforce_selection_composition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tid uuid; rid uuid;
  cfg jsonb;
  team_size int;
  min_bat int; min_wk int; min_bwl int; min_ar int;
  n int;
  c_bat int; c_wk int; c_bwl int; c_ar int;      -- strict counts by own role
  wke_bat int; wke_bwl int; wke_ar int;          -- wk_eligible players, by non-WK role
  wk_capacity int;
BEGIN
  tid := COALESCE(NEW.fantasy_team_id, OLD.fantasy_team_id);
  rid := COALESCE(NEW.round_id, OLD.round_id);

  -- Config for this round's season.
  SELECT s.config INTO cfg
    FROM rounds r JOIN seasons s ON s.id = r.season_id
   WHERE r.id = rid;

  team_size := (cfg #>> '{squad,teamSize}')::int;
  min_bat := (cfg #>> '{squad,roleMinimums,BAT}')::int;
  min_wk  := (cfg #>> '{squad,roleMinimums,WK}')::int;
  min_bwl := (cfg #>> '{squad,roleMinimums,BWL}')::int;
  min_ar  := (cfg #>> '{squad,roleMinimums,AR}')::int;

  -- Partial-config guard: fail loudly, never silently pass (prior slice's open hyp.).
  IF team_size IS NULL OR min_bat IS NULL OR min_wk IS NULL
     OR min_bwl IS NULL OR min_ar IS NULL THEN
    RAISE EXCEPTION
      'team % round %: season config missing squad.teamSize/roleMinimums — cannot validate selection (G15)',
      tid, rid USING ERRCODE = 'check_violation';
  END IF;

  -- Malformed config: minimums summing above teamSize would make flex negative.
  IF min_bat + min_wk + min_bwl + min_ar > team_size THEN
    RAISE EXCEPTION
      'team % round %: roleMinimums sum % exceeds teamSize % — malformed config (G15)',
      tid, rid, min_bat + min_wk + min_bwl + min_ar, team_size
      USING ERRCODE = 'check_violation';
  END IF;

  -- The completed selection set, strict by role, plus wk_eligible non-WK by role.
  SELECT
    count(*),
    count(*) FILTER (WHERE p.role = 'BAT'),
    count(*) FILTER (WHERE p.role = 'WK'),
    count(*) FILTER (WHERE p.role = 'BWL'),
    count(*) FILTER (WHERE p.role = 'AR'),
    count(*) FILTER (WHERE p.role = 'BAT' AND p.wk_eligible),
    count(*) FILTER (WHERE p.role = 'BWL' AND p.wk_eligible),
    count(*) FILTER (WHERE p.role = 'AR'  AND p.wk_eligible)
    INTO n, c_bat, c_wk, c_bwl, c_ar, wke_bat, wke_bwl, wke_ar
    FROM selections se JOIN players p ON p.id = se.player_id
   WHERE se.fantasy_team_id = tid AND se.round_id = rid;

  -- Empty set: the team didn't field this round (same skip as mandatory captain).
  IF n = 0 THEN
    RETURN NULL;
  END IF;

  -- (1) Team size.
  IF n <> team_size THEN
    RAISE EXCEPTION
      'team % round %: selection has % players but team size must be % (G15)',
      tid, rid, n, team_size USING ERRCODE = 'check_violation';
  END IF;

  -- (2) Strict own-role minimums for BAT / BWL / AR.
  IF c_bat < min_bat OR c_bwl < min_bwl OR c_ar < min_ar THEN
    RAISE EXCEPTION
      'team % round %: role minimum not met (BAT %/%, BWL %/%, AR %/%) (G15)',
      tid, rid, c_bat, min_bat, c_bwl, min_bwl, c_ar, min_ar
      USING ERRCODE = 'check_violation';
  END IF;

  -- (3) WK minimum, strict no-double-count: WK-role players are free keepers; a
  -- wk_eligible non-WK keeps only from its role's surplus above that role's minimum.
  wk_capacity := c_wk
    + LEAST(GREATEST(c_bat - min_bat, 0), wke_bat)
    + LEAST(GREATEST(c_bwl - min_bwl, 0), wke_bwl)
    + LEAST(GREATEST(c_ar  - min_ar,  0), wke_ar);
  IF wk_capacity < min_wk THEN
    RAISE EXCEPTION
      'team % round %: WK minimum % not satisfiable (WK-role %, usable wk_eligible capacity %) (G15)',
      tid, rid, min_wk, c_wk, wk_capacity USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_selections_composition
  AFTER INSERT OR UPDATE OR DELETE ON selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_selection_composition();

-- ===========================================================================
-- G15(b) — TRADE LIMITS, at COMMIT. Two invariants over the trades ledger:
--
--   TRADE COUNT per (team, round): one trade = one sell + one buy pair, so the
--     count consumed against the limit is the number of BUYS (trade-ins) in the
--     (team, round). pairs > tradesPerRound is rejected.
--       INITIAL SQUAD CONSTRUCTION is exempt from the COUNT: a team doing its
--       initial build holds nothing entering the round — i.e. it has NO trade in
--       ANY EARLIER round (rounds.seq < this round's seq). Those founding buys form
--       the squad and cost zero trades. Once prior holdings exist, every round's
--       buys are counted trade-ins. (Holdings-based, not round-1-based: a late
--       entrant building in round 3 with no prior trades is still constructing.)
--       Founding churn is uncounted BY DESIGN — it is still bounded by the round
--       lock (G4), still cap-checked below, and its selections still composition-
--       checked by G15(a).
--
--   SALARY CAP per team: cap_remaining = starting_cap − (Σ buy.price − Σ sell.price)
--     over the WHOLE team ledger (D8: buy charges price-at-time, sell credits
--     price-at-time — both stored in trades.price). cap_remaining < 0 is rejected.
--     This is the FIRST write-time cap guard; it fires at commit so a same-txn sell
--     funds a buy regardless of insert order. It complements — never replaces — the
--     derived G2 ledger (team_cap_snapshots) and the cap-at-lock computation.
--
-- starting_cap / tradesPerRound come from the team's season config; missing → loud.
-- ===========================================================================
CREATE FUNCTION enforce_trade_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tid uuid; rid uuid;
  cfg jsonb;
  trades_per_round int;
  starting_cap bigint;
  cur_seq int;
  has_prior boolean;
  buys int;
  spent numeric;
BEGIN
  tid := COALESCE(NEW.fantasy_team_id, OLD.fantasy_team_id);
  rid := COALESCE(NEW.round_id, OLD.round_id);

  -- Config via the team's season (works on DELETE too — the team still exists).
  SELECT s.config INTO cfg
    FROM fantasy_teams ft JOIN seasons s ON s.id = ft.season_id
   WHERE ft.id = tid;

  trades_per_round := (cfg #>> '{squad,tradesPerRound}')::int;
  starting_cap     := (cfg #>> '{squad,cap}')::bigint;

  IF trades_per_round IS NULL OR starting_cap IS NULL THEN
    RAISE EXCEPTION
      'team %: season config missing squad.tradesPerRound/cap — cannot validate trades (G15)',
      tid USING ERRCODE = 'check_violation';
  END IF;

  -- ---- Trade count per (team, round); initial construction exempt ----
  IF rid IS NOT NULL THEN
    SELECT seq INTO cur_seq FROM rounds WHERE id = rid;
    SELECT EXISTS (
      SELECT 1 FROM trades t JOIN rounds r ON r.id = t.round_id
       WHERE t.fantasy_team_id = tid AND r.seq < cur_seq
    ) INTO has_prior;

    IF has_prior THEN
      SELECT count(*) FILTER (WHERE kind = 'buy')
        INTO buys
        FROM trades
       WHERE fantasy_team_id = tid AND round_id = rid;
      IF buys > trades_per_round THEN
        RAISE EXCEPTION
          'team % round %: % trades exceeds tradesPerRound % (G15)',
          tid, rid, buys, trades_per_round USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- ---- Salary cap over the whole team ledger ----
  SELECT COALESCE(sum(price) FILTER (WHERE kind = 'buy'), 0)
       - COALESCE(sum(price) FILTER (WHERE kind = 'sell'), 0)
    INTO spent
    FROM trades
   WHERE fantasy_team_id = tid;

  IF starting_cap - spent < 0 THEN
    RAISE EXCEPTION
      'team %: cap exceeded — net spend % of cap % (G15)',
      tid, spent, starting_cap USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_trades_limits
  AFTER INSERT OR UPDATE OR DELETE ON trades
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_trade_limits();
