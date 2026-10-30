import { describe, expect, it } from 'vitest';
import { buildCalculatorSummary, calculateScenario, type CalculatorRound, type CalculatorStanding } from './calculator.js';

const standings: CalculatorStanding[] = [{ id: 'a', name: 'Driver A', position: 1, points: 100 }, { id: 'b', name: 'Driver B', position: 2, points: 70 }];
const rounds: CalculatorRound[] = [{ round: 3, name: 'Race 3', isSprint: true, isFuture: true }, { round: 4, name: 'Race 4', isSprint: false, isFuture: true }];

describe('championship calculator', () => {
  it('computes remaining race and sprint maximums and elimination', () => {
    const result = buildCalculatorSummary(standings, rounds, 2);
    expect(result.maximumPointsAvailable).toBe(58);
    expect(result.contenders[0]!.maximumFinalPoints).toBe(158);
    expect(result.contenders[1]!.titleStatus).toBe('ALIVE');
    expect(buildCalculatorSummary(standings, [], 2).contenders[1]!.titleStatus).toBe('ELIMINATED');
  });

  it('does not count past scheduled rounds without verified results as remaining', () => {
    const result = buildCalculatorSummary(standings, [{ round: 3, name: 'Past unverified', isSprint: true, isFuture: false }, rounds[1]!], 2);
    expect(result.maximumPointsAvailable).toBe(25);
    expect(result.pastUnconfirmedRounds).toBe(1);
    expect(result.racesRemaining).toBe(1);
  });

  it('adds scenario race and sprint points, then orders the projection', () => {
    const result = calculateScenario({ standings, rounds, throughRound: 2, entrantCount: 2, assignments: [{ round: 3, raceFinishes: [{ driverId: 'b', position: 1 }, { driverId: 'a', position: 2 }], sprintFinishes: [{ driverId: 'b', position: 1 }, { driverId: 'a', position: 2 }] }] });
    expect(result.standings[0]).toMatchObject({ id: 'a', projectedPoints: 125, projectedPosition: 1 });
    expect(result.standings[1]).toMatchObject({ id: 'b', projectedPoints: 103, projectedPosition: 2 });
  });

  it.each([
    ['duplicate position', [{ round: 3, raceFinishes: [{ driverId: 'a', position: 1 }, { driverId: 'b', position: 1 }] }]],
    ['duplicate driver', [{ round: 3, raceFinishes: [{ driverId: 'a', position: 1 }, { driverId: 'a', position: 2 }] }]],
    ['unknown round', [{ round: 8, raceFinishes: [{ driverId: 'a', position: 1 }] }]],
    ['completed round', [{ round: 1, raceFinishes: [{ driverId: 'a', position: 1 }] }]],
    ['unknown driver', [{ round: 3, raceFinishes: [{ driverId: 'unknown', position: 1 }] }]],
    ['position outside entrant count', [{ round: 3, raceFinishes: [{ driverId: 'a', position: 3 }] }]],
    ['too many entries', [{ round: 3, raceFinishes: [{ driverId: 'a', position: 1 }, { driverId: 'b', position: 2 }, { driverId: 'a', position: 3 }] }]],
    ['sprint on non-sprint weekend', [{ round: 4, raceFinishes: [], sprintFinishes: [{ driverId: 'a', position: 1 }] }]],
    ['duplicate round', [{ round: 3, raceFinishes: [] }, { round: 3, raceFinishes: [] }]],
  ])('rejects %s', (_name, assignments) => {
    expect(() => calculateScenario({ standings, rounds, throughRound: 2, entrantCount: 2, assignments })).toThrow();
  });
});
