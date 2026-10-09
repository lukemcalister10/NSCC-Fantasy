import { describe, expect, it } from 'vitest';
import { filterTradeInPool } from '../app/lib/tradePoolFilter';

const pool = [{ id: 'green' }, { id: 'red' }, { id: 'unknown' }, { id: 'held' }];
const held = new Set(['held']);
const availability = new Map([
  ['green', 'available'], ['red', 'unavailable'], ['held', 'available'],
] as const);
describe('trade-in playing filter', () => {
  it('off shows all non-held players, including red and unknown', () => {
    expect(filterTradeInPool(pool, held, availability, false).map(p=>p.id)).toEqual(['green','red','unknown']);
  });
  it('on shows only green dots and never held players', () => {
    expect(filterTradeInPool(pool, held, availability, true).map(p=>p.id)).toEqual(['green']);
  });
  it('missing availability is not treated as playing', () => {
    expect(filterTradeInPool(pool, held, new Map(), true)).toEqual([]);
  });
  it('refreshes with availability and does not mutate inputs', () => {
    const refreshed = new Map(availability);
    refreshed.set('green','unavailable');
    expect(filterTradeInPool(pool, held, refreshed, true)).toEqual([]);
    expect(pool).toHaveLength(4);
    expect(availability.get('green')).toBe('available');
    expect(held).toEqual(new Set(['held']));
  });
});
