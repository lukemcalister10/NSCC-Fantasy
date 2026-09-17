import { useEffect, useState } from "react";
import { initials } from "../lib/format";

export function PlayerAvatar({
  name,
  size = 44,
  photoUrl = null,
}: {
  name: string;
  size?: number;
  photoUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const showingPhoto = !!photoUrl && !failed;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  return (
    <span
      className={`avatar${showingPhoto ? " avatar-photo" : ""}`}
      style={style}
      aria-hidden="true"
    >
      {showingPhoto ? (
        <img src={photoUrl} alt="" className="avatar-img" onError={() => setFailed(true)} />
      ) : (
        <span className="avatar-monogram">{initials(name)}</span>
      )}
    </span>
  );
}
