import { initials } from "../lib/format";

/**
 * Player photo slot. Player photos are NOT modelled yet (no `players.photo_path`
 * / storage bucket this slice — it rides with the manager-backend slice, which
 * owns upload). Until then we render a monogram on NSCC blue. The box is a fixed
 * square so a real <img> drops in later with ZERO layout change: when a
 * `photoUrl` arrives, swap the monogram for <img> inside the same element.
 */
export function PlayerAvatar({
  name,
  size = 44,
  photoUrl = null,
}: {
  name: string;
  size?: number;
  photoUrl?: string | null;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {photoUrl ? (
        <img src={photoUrl} alt="" className="avatar-img" />
      ) : (
        <span className="avatar-monogram">{initials(name)}</span>
      )}
    </span>
  );
}
