-- League-wide selection popularity without exposing another manager's squad.
-- The view owner may read every selection through RLS, but authenticated clients
-- receive only aggregate counts for a player and round.
CREATE VIEW player_selection_popularity
WITH (security_barrier = true)
AS
SELECT
  r.season_id,
  r.id AS round_id,
  p.id AS player_id,
  count(DISTINCT s.fantasy_team_id)::integer AS selected_count,
  (
    SELECT count(*)::integer
      FROM fantasy_teams ft
     WHERE ft.season_id = r.season_id
  ) AS team_count
FROM rounds r
JOIN players p ON p.season_id = r.season_id
LEFT JOIN selections s
  ON s.round_id = r.id
 AND s.player_id = p.id
GROUP BY r.season_id, r.id, p.id;

REVOKE ALL ON player_selection_popularity FROM PUBLIC;
GRANT SELECT ON player_selection_popularity TO authenticated;

