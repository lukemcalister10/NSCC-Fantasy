import type { PlayerAvailabilityStatus } from './playerAvailability';
import { availableOnAnyDay } from './availabilityTypes';

/** Keep inactive records in the ownership lookup, but never offer new purchases. */
export function selectablePlayers<T extends { id: string; active?: boolean }>(pool: readonly T[]): T[] {
  return pool.filter(player => player.active !== false);
}

/** Browse-only filter: never changes selected trade IDs or trade validation. */
export function filterTradeInPool<T extends { id: string; active?: boolean }>(
  pool: readonly T[],
  heldIds: ReadonlySet<string>,
  availability: ReadonlyMap<string, PlayerAvailabilityStatus>,
  onlyPlaying: boolean,
): T[] {
  return selectablePlayers(pool).filter(player => !heldIds.has(player.id)
    && (!onlyPlaying || availableOnAnyDay(availability.get(player.id))));
}
