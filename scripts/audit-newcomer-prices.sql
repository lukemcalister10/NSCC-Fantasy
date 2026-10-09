-- READ ONLY. Run before deciding how to correct these existing player records.
-- This deliberately does not change starting prices or recompute frozen rounds.
BEGIN TRANSACTION READ ONLY;

SELECT id, display_name, role, wk_eligible, starting_price
FROM public.players
WHERE season_id = 'edd67f68-d2a1-45f5-98ff-e8c718d1562b'
  AND display_name IN ('Lachlan Brown', 'Sharon Ben')
ORDER BY display_name;

SELECT p.display_name, ft.name AS team, r.seq AS round, t.kind,
       t.price, t.created_at
FROM public.trades t
JOIN public.players p ON p.id = t.player_id
JOIN public.fantasy_teams ft ON ft.id = t.fantasy_team_id
JOIN public.rounds r ON r.id = t.round_id
WHERE p.season_id = 'edd67f68-d2a1-45f5-98ff-e8c718d1562b'
  AND p.display_name IN ('Lachlan Brown', 'Sharon Ben')
ORDER BY t.created_at, p.display_name, ft.name;

SELECT p.display_name, r.seq AS round, ft.name AS team,
       s.is_captain, s.is_vice_captain
FROM public.selections s
JOIN public.players p ON p.id = s.player_id
JOIN public.fantasy_teams ft ON ft.id = s.fantasy_team_id
JOIN public.rounds r ON r.id = s.round_id
WHERE p.season_id = 'edd67f68-d2a1-45f5-98ff-e8c718d1562b'
  AND p.display_name IN ('Lachlan Brown', 'Sharon Ben')
ORDER BY r.seq, p.display_name, ft.name;

SELECT p.display_name, ph.seq, ph.match_id, ph.price
FROM public.price_history ph
JOIN public.players p ON p.id = ph.player_id
WHERE p.season_id = 'edd67f68-d2a1-45f5-98ff-e8c718d1562b'
  AND p.display_name IN ('Lachlan Brown', 'Sharon Ben')
ORDER BY p.display_name, ph.seq;

COMMIT;
