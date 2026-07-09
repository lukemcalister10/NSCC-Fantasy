-- NSCC Fantasy — initial schema (Supabase/Postgres).
--
-- THE PRIME INVARIANT (D15/G3): raw scorecards + frozen config are the ONLY
-- sources of truth; everything under "DERIVED STATE" is recomputable and is
-- rewritten wholesale by the recompute orchestrator (delete-then-insert in one
-- transaction — no orphaned derived rows), never hand-edited.
--
-- This migration defines the ENTIRE derived chain's tables. In the current
-- slice the recompute engine populates player_match_scores, price_history and
-- team_cap_snapshots; team_round_scores / h2h_results / ladder /
-- overall_leaderboard are created now but populated by engines landing in the
-- full-chain G3 + G9 slice (deferred engines, not deferred tables).
--
-- Written to run unchanged on both a real Supabase instance and pglite (used by
-- the test suite): no dependency on the Supabase `auth` schema here — profiles.id
-- equals auth.users.id in the Supabase deployment, wired by a Supabase-only
-- migration in the auth/RLS (G13) slice.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE player_role   AS ENUM ('BAT', 'WK', 'BWL', 'AR');
CREATE TYPE match_status  AS ENUM ('scheduled', 'in_progress', 'finalised');
CREATE TYPE ledger_kind   AS ENUM ('buy', 'sell');
CREATE TYPE h2h_outcome   AS ENUM ('home', 'away', 'tie', 'bye');
CREATE TYPE review_state  AS ENUM ('draft', 'committed');

-- ---------------------------------------------------------------------------
-- Config / identity
-- ---------------------------------------------------------------------------

-- One row per season. `config` is the frozen LeagueConfig (scoring/pricing/squad)
-- serialised 1:1 — the recompute engine loads it verbatim, so there is no
-- mapping layer and nothing to drift. Season lock (G10, later slice) sets
-- locked_at and blocks further config mutation.
CREATE TABLE seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  config     jsonb NOT NULL,
  locked_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Manager role lives in the DB, not the UI (D16). RLS policies (G13) added later.
CREATE TABLE profiles (
  id                uuid PRIMARY KEY,          -- = auth.users.id under Supabase
  display_name      text NOT NULL,
  is_league_manager boolean NOT NULL DEFAULT false,
  photo_path        text
);

-- ---------------------------------------------------------------------------
-- Raw truth: registry, rounds, matches, scorecards
-- ---------------------------------------------------------------------------

CREATE TABLE players (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id      uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  registry_key   text NOT NULL,               -- token used in dismissal strings + scoring
  display_name   text NOT NULL,
  role           player_role NOT NULL,
  wk_eligible    boolean NOT NULL DEFAULT false,   -- the only dual eligibility (D9)
  starting_price bigint,                       -- see COMMENT below (Rider 3 / G10 binding)
  active         boolean NOT NULL DEFAULT true,
  UNIQUE (season_id, registry_key)
);

-- G10 BINDING (Rider 3): pre-lock, starting_price may be null (materialised from
-- last-season data at season setup, or hand-set — D4, hand-adjustable pre-lock
-- only). At SEASON LOCK the value is materialised (written) for every player, and
-- post-lock the recompute engine reads ONLY this stored value — it never
-- re-derives a starting price from last-season averages. Enforced in the season
-- lock (G4/G6/G10) slice.
COMMENT ON COLUMN players.starting_price IS
  'Seed price for pricing. Materialised for all players at season lock; post-lock recompute reads only this stored value (Rider 3 / G10).';

CREATE TABLE rounds (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  seq       integer NOT NULL,                 -- ordering within the season
  name      text NOT NULL,
  lock_at   timestamptz NOT NULL,             -- per-round lock datetime (D6)
  UNIQUE (season_id, seq)
);

CREATE TABLE matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  grade          text NOT NULL,
  opponent       text NOT NULL,
  status         match_status NOT NULL DEFAULT 'scheduled',
  final_day_date date,                        -- match lands in the round of its final day (D5)
  finalised_at   timestamptz
);

CREATE TABLE scorecards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id               uuid NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  wicket_keeper_player_id uuid REFERENCES players(id),
  review_state           review_state NOT NULL DEFAULT 'committed'
  -- captain / vice-captain are deliberately NOT here: fantasy captaincy is a
  -- per-team selection (see selections), not a property of the club scorecard.
);

CREATE TABLE scorecard_lineup (
  scorecard_id uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES players(id),
  PRIMARY KEY (scorecard_id, player_id)       -- the named XI: drives DNP (D2) vs played (D3)
);

CREATE TABLE batting_lines (
  scorecard_id uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES players(id),
  runs         integer NOT NULL,
  balls_faced  integer NOT NULL,
  fours        integer NOT NULL,
  sixes        integer NOT NULL,
  PRIMARY KEY (scorecard_id, player_id)
);

CREATE TABLE bowling_lines (
  scorecard_id  uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES players(id),
  overs         numeric(4,1) NOT NULL,        -- cricket notation, e.g. 3.4 = 3 overs 4 balls
  runs_conceded integer NOT NULL,
  wickets       integer NOT NULL,
  PRIMARY KEY (scorecard_id, player_id)
);

CREATE TABLE dismissals (
  scorecard_id uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  seq          integer NOT NULL,              -- preserves order
  raw_text     text NOT NULL,                 -- opposition dismissal string -> fielding credits
  PRIMARY KEY (scorecard_id, seq)
);

-- ---------------------------------------------------------------------------
-- Raw user actions: fantasy teams, selections, trades
-- ---------------------------------------------------------------------------

CREATE TABLE fantasy_teams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id        uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  owner_profile_id uuid NOT NULL REFERENCES profiles(id),
  name             text NOT NULL,
  UNIQUE (season_id, owner_profile_id)
);

CREATE TABLE selections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fantasy_team_id uuid NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
  round_id        uuid NOT NULL REFERENCES rounds(id),
  player_id       uuid NOT NULL REFERENCES players(id),
  is_captain      boolean NOT NULL DEFAULT false,
  is_vice_captain boolean NOT NULL DEFAULT false,
  UNIQUE (fantasy_team_id, round_id, player_id)
);

-- Rider 1: at most one captain and at most one vice-captain per (team, round).
-- These partial unique indexes enforce the "<= 1" half. The MANDATORY-captain
-- ("exactly one", i.e. >= 1) half cannot be an index and is enforced at commit
-- time in the lock/selection slice (G4/G6) — see README next-slices.
CREATE UNIQUE INDEX one_captain_per_team_round
  ON selections (fantasy_team_id, round_id) WHERE is_captain;
CREATE UNIQUE INDEX one_vice_captain_per_team_round
  ON selections (fantasy_team_id, round_id) WHERE is_vice_captain;

CREATE TABLE trades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fantasy_team_id uuid NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
  kind            ledger_kind NOT NULL,
  player_id       uuid NOT NULL REFERENCES players(id),
  price           bigint NOT NULL,            -- price at time of trade (D8); recompute asserts it
  round_id        uuid NOT NULL REFERENCES rounds(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- DERIVED STATE — rewritten wholesale by recompute; never hand-edited.
-- [POP] = populated in the current slice. [SCHEMA] = table now, engine later.
-- ===========================================================================

-- [POP] Per-player fantasy points for one match. `base` is PRE-captaincy (the
-- shared value that drives pricing, D1/G7); captain x2 is applied per fantasy
-- team in team_round_scores (deferred engine).
CREATE TABLE player_match_scores (
  match_id  uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id),
  played    boolean NOT NULL,
  batting   integer NOT NULL,
  bowling   integer NOT NULL,
  fielding  integer NOT NULL,
  bonuses   integer NOT NULL,
  base      integer NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

-- [POP] Ordered price path. seq 0 with match_id NULL is the starting seed; each
-- subsequent row is one movement after a finalised match the player played
-- (DNP freezes: no row, D2). One movement per completed match (D1/D7).
CREATE TABLE price_history (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id  uuid REFERENCES matches(id),       -- NULL = starting seed
  seq       integer NOT NULL,
  price     bigint NOT NULL,
  PRIMARY KEY (player_id, seq)
);

-- [POP] Cap position per fantasy team, as of a round. team_value = cap_remaining
-- + invested_value (amended A2 / Gate G2). Derived from the trades ledger.
CREATE TABLE team_cap_snapshots (
  fantasy_team_id uuid NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
  as_of_round_id  uuid NOT NULL REFERENCES rounds(id),
  cap_remaining   bigint NOT NULL,
  invested_value  bigint NOT NULL,
  team_value      bigint NOT NULL,
  PRIMARY KEY (fantasy_team_id, as_of_round_id)
);

-- [SCHEMA] Per-team round total (sum of selected players' base, captain doubled).
CREATE TABLE team_round_scores (
  fantasy_team_id   uuid NOT NULL REFERENCES fantasy_teams(id) ON DELETE CASCADE,
  round_id          uuid NOT NULL REFERENCES rounds(id),
  total             integer NOT NULL,
  captain_player_id uuid REFERENCES players(id),
  PRIMARY KEY (fantasy_team_id, round_id)
);

-- [SCHEMA] H2H fixture result per round. away_team_id NULL = bye (scored against
-- the round median, D11/D18).
CREATE TABLE h2h_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  home_team_id uuid NOT NULL REFERENCES fantasy_teams(id),
  away_team_id uuid REFERENCES fantasy_teams(id),
  home_points  integer NOT NULL,
  away_points  integer,
  bye_median   integer,
  outcome      h2h_outcome NOT NULL
);

-- [SCHEMA] Ladder: wins, points-for tiebreak (D11).
CREATE TABLE ladder (
  season_id       uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  fantasy_team_id uuid NOT NULL REFERENCES fantasy_teams(id),
  played          integer NOT NULL,
  wins            integer NOT NULL,
  losses          integer NOT NULL,
  ties            integer NOT NULL,
  points_for      integer NOT NULL,
  ladder_points   integer NOT NULL,
  PRIMARY KEY (season_id, fantasy_team_id)
);

-- [SCHEMA] Separate overall-points leaderboard (D11).
CREATE TABLE overall_leaderboard (
  season_id       uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  fantasy_team_id uuid NOT NULL REFERENCES fantasy_teams(id),
  total_points    integer NOT NULL,
  PRIMARY KEY (season_id, fantasy_team_id)
);
