import { describe, expect, it } from 'vitest';
import { rankStandings, unresolvedRaceCountbackTies } from './standings.js';

const row = (entityId: string, overrides: Partial<Parameters<typeof rankStandings>[0][number]> = {}) => ({
  entityId, name: entityId, points: 10, wins: 0,
  racePlaces: new Map<number, number>(), qualifyingPlaces: new Map<number, number>(),
  ...overrides,
});

describe('official championship countback', () => {
  it('uses race wins, then the count of successive race positions', () => {
    const ranked = rankStandings([
      row('second-place', { racePlaces: new Map([[2, 2]]) }),
      row('winner', { points: 20, wins: 1, racePlaces: new Map([[1, 1]]) }),
      row('runner-up', { racePlaces: new Map([[1, 1]]) }),
    ]);
    expect(ranked.map(({ entityId, rank }) => [entityId, rank])).toEqual([['winner', 1], ['runner-up', 2], ['second-place', 3]]);
  });

  it('uses qualifying countback only after race countback is tied', () => {
    const ranked = rankStandings([
      row('B', { qualifyingPlaces: new Map([[2, 1]]) }),
      row('A', { qualifyingPlaces: new Map([[1, 1]]) }),
    ]);
    expect(ranked.map(({ entityId, rank }) => [entityId, rank])).toEqual([['A', 1], ['B', 2]]);
  });

  it('represents a tie when all published countback criteria remain equal', () => {
    const tied = [row('A'), row('B')];
    expect(unresolvedRaceCountbackTies(tied)).toEqual(new Set(['A', 'B']));
    expect(rankStandings(tied).map((item) => item.rank)).toEqual([1, 1]);
  });

  it('does not allow qualifying data to override a race countback result', () => {
    const ranked = rankStandings([
      row('A', { racePlaces: new Map([[1, 1]]), qualifyingPlaces: new Map([[5, 1]]) }),
      row('B', { racePlaces: new Map([[2, 1]]), qualifyingPlaces: new Map([[1, 1]]) }),
    ]);
    expect(ranked.map(({ entityId, rank }) => [entityId, rank])).toEqual([['A', 1], ['B', 2]]);
  });
});
