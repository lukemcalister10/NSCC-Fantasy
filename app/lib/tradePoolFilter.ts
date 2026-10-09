import type { PlayerAvailabilityStatus } from './playerAvailability';

/** Browse-only filter: never changes selected trade IDs or trade validation. */
export function filterTradeInPool<T extends { id: string }>(
  pool: readonly T[],
  heldIds: ReadonlySet<string>,
  availability: ReadonlyMap<string, PlayerAvailabilityStatus>,
  onlyPlaying: boolean,
): T[] {
  return pool.filter(player => !heldIds.has(player.id)
    && (!onlyPlaying || availability.get(player.id) === 'available'));
}
