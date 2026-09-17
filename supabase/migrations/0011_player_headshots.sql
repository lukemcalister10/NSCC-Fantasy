-- Player headshots: an explicit registry field plus a private Storage bucket.
-- Objects are readable by signed-in members and writable only by league managers.
ALTER TABLE players ADD COLUMN photo_path text;

COMMENT ON COLUMN players.photo_path IS
  'Path inside the private player-headshots Supabase Storage bucket; NULL uses initials.';

-- Photo changes are cosmetic and remain legal after season lock, but they are
-- still recorded in the registry audit trail.
CREATE FUNCTION app.log_player_photo_event() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.photo_path IS DISTINCT FROM OLD.photo_path THEN
    INSERT INTO player_registry_events (season_id, player_id, event, actor, detail)
      VALUES (
        NEW.season_id,
        NEW.id,
        'update',
        auth.uid(),
        jsonb_build_object(
          'photo_path', jsonb_build_object('from', OLD.photo_path, 'to', NEW.photo_path)
        )
      );
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_players_photo_log
  AFTER UPDATE OF photo_path ON players
  FOR EACH ROW EXECUTE FUNCTION app.log_player_photo_event();

-- Supabase owns the storage schema. The conditional keeps the project's pure
-- Postgres/PGlite gate suite able to apply the same migration stack.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL
     AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'player-headshots',
        'player-headshots',
        false,
        5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp']
      )
      ON CONFLICT (id) DO UPDATE SET
        public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types
    $sql$;

    EXECUTE $sql$
      CREATE POLICY player_headshots_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'player-headshots')
    $sql$;
    EXECUTE $sql$
      CREATE POLICY player_headshots_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'player-headshots' AND app.is_manager())
    $sql$;
    EXECUTE $sql$
      CREATE POLICY player_headshots_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'player-headshots' AND app.is_manager())
      WITH CHECK (bucket_id = 'player-headshots' AND app.is_manager())
    $sql$;
    EXECUTE $sql$
      CREATE POLICY player_headshots_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'player-headshots' AND app.is_manager())
    $sql$;
  END IF;
END $$;
