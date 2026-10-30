import { describe, expect, it } from 'vitest';
import { scoreDeadHeats2026 } from './season-2026.js';

describe('2026 season scoring', () => {
  it('scores a full-distance Grand Prix under FIA Article A2.2', () => {
    expect(scoreDeadHeats2026([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'RACE'))
      .toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0]);
  });

  it('scores sprint positions and awards no points beyond eighth place', () => {
    expect(scoreDeadHeats2026([1, 2, 3, 4, 5, 6, 7, 8, 9], 'SPRINT'))
      .toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('shares points across tied positions', () => {
    expect(scoreDeadHeats2026([1, 1, 3], 'RACE')).toEqual([21.5, 21.5, 15]);
  });

  it('returns zero for invalid and unscored positions', () => {
    expect(scoreDeadHeats2026([0, -2, 99], 'RACE')).toEqual([0, 0, 0]);
  });
});
