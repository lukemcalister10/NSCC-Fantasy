-- Approved 9 October 2026. One-off repair, not a migration or recompute.
-- Guards the audited IDs, prices, first-match scores and absence of all ownership.
-- Transactional table lock prevents concurrent player writes while the one price
-- freeze trigger is temporarily suspended. All other guards remain enabled.
BEGIN;
LOCK TABLE public.players IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.price_history, public.trades, public.selections IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE newcomer_repair_targets ON COMMIT DROP AS
SELECT * FROM (VALUES
 ('8726ac32-9848-4511-a9f9-52a181e50172'::uuid,'Lachlan Brown','BWL',28800,4,'e86ce9d5-941b-4fc1-a8e2-7aebc447a73e'::uuid,23800),
 ('27c9c79d-dd12-48bd-ad5c-bd5c279a4c7c'::uuid,'Sharon Ben','WK',21900,5,'8784b3d0-c286-41dc-a178-69b08016b6ec'::uuid,18500)
) AS t(id,name,role,seed,score,match_id,current_price);

CREATE TEMP TABLE newcomer_repair_before (table_name text, digest text) ON COMMIT DROP;
DO $$ DECLARE t record; d text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
   AND tablename NOT IN ('players','price_history','player_registry_events') LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,''[]'')) FROM public.%I x',t.tablename) INTO d;
  INSERT INTO newcomer_repair_before VALUES(t.tablename,d);
 END LOOP;
 INSERT INTO newcomer_repair_before
 SELECT 'other_players',md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) FROM players p WHERE p.id NOT IN (SELECT id FROM newcomer_repair_targets);
 INSERT INTO newcomer_repair_before
 SELECT 'other_prices',md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.player_id,p.seq)::text,'[]')) FROM price_history p WHERE p.player_id NOT IN (SELECT id FROM newcomer_repair_targets);
END $$;

DO $$ DECLARE t record; cfg jsonb; calculated bigint; BEGIN
 SELECT config->'pricing' INTO cfg FROM seasons WHERE id='edd67f68-d2a1-45f5-98ff-e8c718d1562b';
 IF cfg IS NULL THEN RAISE EXCEPTION 'Missing audited season'; END IF;
 FOR t IN SELECT * FROM newcomer_repair_targets LOOP
  IF NOT EXISTS (SELECT 1 FROM players p WHERE p.id=t.id AND p.season_id='edd67f68-d2a1-45f5-98ff-e8c718d1562b' AND p.display_name=t.name AND p.role::text=t.role AND p.starting_price=9000) THEN RAISE EXCEPTION 'Player state changed: %',t.name; END IF;
  IF EXISTS (SELECT 1 FROM trades WHERE player_id=t.id) OR EXISTS (SELECT 1 FROM selections WHERE player_id=t.id) THEN RAISE EXCEPTION 'Ownership exists: %; separate repair decision required',t.name; END IF;
  IF (SELECT count(*) FROM player_match_scores WHERE player_id=t.id AND played)<>1 OR NOT EXISTS(SELECT 1 FROM player_match_scores WHERE player_id=t.id AND match_id=t.match_id AND played AND base=t.score) THEN RAISE EXCEPTION 'Score state changed: %',t.name; END IF;
  IF (SELECT count(*) FROM price_history WHERE player_id=t.id)<>2 OR NOT EXISTS(SELECT 1 FROM price_history WHERE player_id=t.id AND seq=0 AND match_id IS NULL AND price=9000) OR NOT EXISTS(SELECT 1 FROM price_history WHERE player_id=t.id AND seq=1 AND match_id=t.match_id AND price=9000) THEN RAISE EXCEPTION 'Price state changed: %',t.name; END IF;
  IF (SELECT (newcomer_role_prices->>t.role)::bigint FROM seasons WHERE id='edd67f68-d2a1-45f5-98ff-e8c718d1562b') IS DISTINCT FROM t.seed::bigint THEN RAISE EXCEPTION 'Apply migration 0020 first'; END IF;
  calculated := greatest((cfg->>'floor')::numeric, floor(((1-(cfg->>'alpha')::numeric)*t.seed+(cfg->>'alpha')::numeric*t.score*(cfg->>'dollarsPerPoint')::numeric)/(cfg->>'roundingIncrement')::numeric+0.5)*(cfg->>'roundingIncrement')::numeric)::bigint;
  IF calculated<>t.current_price THEN RAISE EXCEPTION 'Pricing calculation changed: %',t.name; END IF;
  INSERT INTO player_registry_events(season_id,player_id,event,actor,detail)
  SELECT p.season_id,p.id,'update',auth.uid(),jsonb_build_object('price_history_repair',jsonb_build_object('reason','Approved D33 newcomer default correction, 9 October 2026','operator',current_user,'before',(SELECT jsonb_agg(to_jsonb(ph) ORDER BY ph.seq) FROM price_history ph WHERE ph.player_id=p.id),'after_seed',t.seed,'after_first_match',t.current_price)) FROM players p WHERE p.id=t.id;
 END LOOP;
END $$;

ALTER TABLE public.players DISABLE TRIGGER trg_players_lock;
UPDATE public.players p SET starting_price=t.seed FROM newcomer_repair_targets t WHERE p.id=t.id;
ALTER TABLE public.players ENABLE TRIGGER trg_players_lock;
UPDATE public.price_history ph SET price=CASE WHEN ph.seq=0 THEN t.seed ELSE t.current_price END FROM newcomer_repair_targets t WHERE ph.player_id=t.id;

DO $$ DECLARE t record; d text; BEGIN
 FOR t IN SELECT * FROM newcomer_repair_before WHERE table_name NOT IN ('other_players','other_prices') LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,''[]'')) FROM public.%I x',t.table_name) INTO d;
  IF d IS DISTINCT FROM t.digest THEN RAISE EXCEPTION 'Unrelated data changed: %; rolling back',t.table_name; END IF;
 END LOOP;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) INTO d FROM players p WHERE p.id NOT IN (SELECT id FROM newcomer_repair_targets);
 IF d IS DISTINCT FROM (SELECT digest FROM newcomer_repair_before WHERE table_name='other_players') THEN RAISE EXCEPTION 'Other players changed'; END IF;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.player_id,p.seq)::text,'[]')) INTO d FROM price_history p WHERE p.player_id NOT IN (SELECT id FROM newcomer_repair_targets);
 IF d IS DISTINCT FROM (SELECT digest FROM newcomer_repair_before WHERE table_name='other_prices') THEN RAISE EXCEPTION 'Other prices changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.players'::regclass AND tgname='trg_players_lock' AND tgenabled='O') THEN RAISE EXCEPTION 'Price freeze trigger not restored'; END IF;
END $$;
COMMIT;

SELECT p.display_name,p.starting_price,ph.seq,ph.price
FROM public.players p JOIN public.price_history ph ON ph.player_id=p.id
WHERE p.id IN ('8726ac32-9848-4511-a9f9-52a181e50172','27c9c79d-dd12-48bd-ad5c-bd5c279a4c7c')
ORDER BY p.display_name,ph.seq;
