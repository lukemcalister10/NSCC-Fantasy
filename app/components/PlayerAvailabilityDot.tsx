import type { PlayerAvailabilityStatus } from "../lib/playerAvailability";

export function PlayerAvailabilityDot({
  status,
}: {
  status: PlayerAvailabilityStatus | undefined;
}) {
  if (!status) return null;
  const label = status === "available" ? "Available this round" : "Unavailable this round";
  return (
    <span
      className={`availability-dot availability-dot-${status}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
