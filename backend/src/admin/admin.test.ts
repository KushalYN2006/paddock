import { describe, expect, it } from 'vitest';
import { createAdminSession, equalSecret, verifyAdminSession } from './auth.js';
import { rankStandingRows } from './recalculate.js';

describe('admin session security', () => {
  it('compares access keys without accepting a different key', () => {
    expect(equalSecret('same-key', 'same-key')).toBe(true);
    expect(equalSecret('same-key', 'other-key')).toBe(false);
    expect(equalSecret('short', 'a-much-longer-key')).toBe(false);
  });

  it('issues a short-lived, signed role-only session', () => {
    const session = createAdminSession();
    expect(verifyAdminSession(session)).toBe(true);
    expect(verifyAdminSession(`${session}x`)).toBe(false);
    expect(verifyAdminSession(undefined)).toBe(false);
  });
});

describe('admin standings recalculation', () => {
  it('ranks by points, wins, then successive finishing places', () => {
    const rows = rankStandingRows([
      { entityId: 'a', name: 'A', points: 20, wins: 1, placeCounts: new Map([[1, 1]]) },
      { entityId: 'b', name: 'B', points: 20, wins: 0, placeCounts: new Map([[2, 2]]) },
      { entityId: 'c', name: 'C', points: 10, wins: 0, placeCounts: new Map([[3, 1]]) },
    ]);
    expect(rows.map((row) => row.entityId)).toEqual(['a', 'b', 'c']);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it('refuses to invent a tie-break when records are identical', () => {
    const tie = { points: 10, wins: 0, placeCounts: new Map<number, number>() };
    expect(() => rankStandingRows([{ entityId: 'a', name: 'A', ...tie }, { entityId: 'b', name: 'B', ...tie }])).toThrow(/verified qualifying data/);
  });
});
