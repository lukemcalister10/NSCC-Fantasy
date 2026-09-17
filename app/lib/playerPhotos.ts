import { supabase } from "./supabase";

export const PLAYER_HEADSHOTS_BUCKET = "player-headshots";
const SIGNED_URL_SECONDS = 60 * 60;

/** A failed Storage read must never hide the player list; initials remain valid. */
export async function signPlayerPhotoPaths(
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => !!path))];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from(PLAYER_HEADSHOTS_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error || !data) return new Map();

  return new Map(
    data.flatMap((item) => {
      const path = item.path;
      return path && item.signedUrl && !item.error
        ? [[path, item.signedUrl] as const]
        : [];
    }),
  );
}

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadPlayerPhoto({
  seasonId,
  playerId,
  currentPath,
  file,
}: {
  seasonId: string;
  playerId: string;
  currentPath: string | null;
  file: File;
}): Promise<void> {
  const extension = MIME_EXTENSION[file.type];
  if (!extension) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Player photos must be 5 MB or smaller.");

  const path = `${seasonId}/${playerId}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await supabase.storage
    .from(PLAYER_HEADSHOTS_BUCKET)
    .upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (uploaded.error) throw new Error(`upload photo: ${uploaded.error.message}`);

  const updated = await supabase
    .from("players")
    .update({ photo_path: path })
    .eq("id", playerId)
    .select("id");
  if (updated.error || !updated.data || updated.data.length === 0) {
    await supabase.storage.from(PLAYER_HEADSHOTS_BUCKET).remove([path]);
    throw new Error(`save photo: ${updated.error?.message ?? "the database changed nothing"}`);
  }

  if (currentPath && currentPath !== path) {
    await supabase.storage.from(PLAYER_HEADSHOTS_BUCKET).remove([currentPath]);
  }
}

export async function removePlayerPhoto(playerId: string, currentPath: string): Promise<void> {
  const updated = await supabase
    .from("players")
    .update({ photo_path: null })
    .eq("id", playerId)
    .select("id");
  if (updated.error || !updated.data || updated.data.length === 0) {
    throw new Error(`remove photo: ${updated.error?.message ?? "the database changed nothing"}`);
  }

  const removed = await supabase.storage.from(PLAYER_HEADSHOTS_BUCKET).remove([currentPath]);
  if (removed.error) throw new Error(`remove stored photo: ${removed.error.message}`);
}
