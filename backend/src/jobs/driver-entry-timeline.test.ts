import { describe, expect, it } from 'vitest';
import { planEntryTransition, type DriverEntryRange } from './driver-entry-timeline.js';

const entry = (id: string, constructorId: string, validFromRound: number, validToRound: number | null = null): DriverEntryRange => ({ id, constructorId, validFromRound, validToRound });

describe('driver team history reconciliation', () => {
  it('extends a later qualifying entry back to a race start without qualifying', () => {
    expect(planEntryTransition([entry('r2', 'red-bull', 2)], 1, 'red-bull')).toEqual({ action: 'extend', entry: entry('r2', 'red-bull', 2), closeEntryId: null });
  });

  it('deduplicates overlapping active rows for the same constructor', () => {
    expect(planEntryTransition([entry('r1', 'red-bull', 1), entry('r2', 'red-bull', 2)], 2, 'red-bull')).toEqual({ action: 'deduplicate', entry: entry('r1', 'red-bull', 1), removeIds: ['r2'] });
  });

  it('bounds a newly created team entry before the next known team change', () => {
    expect(planEntryTransition([entry('future', 'ferrari', 6)], 1, 'williams')).toEqual({ action: 'create', closeEntryId: null, validToRound: 5 });
  });

  it('rejects two different teams for the same race round', () => {
    expect(() => planEntryTransition([entry('current', 'red-bull', 2)], 2, 'ferrari')).toThrow(/Conflicting team association/);
  });
});
