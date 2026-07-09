import { direction, signedMoney } from "../lib/format";

/**
 * Price movement arrow + delta (SuperCoach treatment): green ▲ up, red ▼ down,
 * neutral dash when flat / seed-only. `delta` is current − previous price.
 */
export function PriceMovement({
  delta,
  showValue = true,
}: {
  delta: number;
  showValue?: boolean;
}) {
  const dir = direction(delta);
  if (dir === "flat") {
    return (
      <span className="movement movement-flat num" aria-label="no change">
        <span aria-hidden="true">–</span>
      </span>
    );
  }
  const arrow = dir === "up" ? "▲" : "▼";
  const label = dir === "up" ? "up" : "down";
  return (
    <span
      className={`movement movement-${dir} num`}
      aria-label={`${label} ${signedMoney(delta)}`}
    >
      <span aria-hidden="true">{arrow}</span>
      {showValue ? <span>{signedMoney(delta)}</span> : null}
    </span>
  );
}
