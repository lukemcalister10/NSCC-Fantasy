import type { PlayerAvailabilityStatus } from './playerAvailability';
import { availableOnAnyDay } from './availabilityTypes';

/** Browse-only filter: never changes selected trade IDs or trade validation. */
export function filterTradeInPool<T extends { id: string }>(
  pool: readonly T[],
  heldIds: ReadonlySet<string>,
  availability: ReadonlyMap<string, PlayerAvailabilityStatus>,
  onlyPlaying: boolean,
): T[] {
  return pool.filter(player => !heldIds.has(player.id)
    && (!onlyPlaying || availableOnAnyDay(availability.get(player.id))));
}
