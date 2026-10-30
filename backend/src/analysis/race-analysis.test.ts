import { describe, expect, it } from 'vitest';
import { buildRaceRecapFacts, deriveRaceAnalysis, type RaceAnalysisResult } from './race-analysis.js';

const results: RaceAnalysisResult[] = [
  { driverId: 'a', driver: 'Driver A', teamId: 'team', team: 'Team', gridPosition: 4, finishPosition: 2, status: 'Finished' },
  { driverId: 'b', driver: 'Driver B', teamId: 'team', team: 'Team', gridPosition: 2, finishPosition: 4, status: 'Finished' },
  { driverId: 'c', driver: 'Driver C', teamId: 'other', team: 'Other', gridPosition: null, finishPosition: null, status: 'Retired' },
];

describe('race analysis', () => {
  it('builds only classification-backed, attributed recap facts', () => {
    const recap = buildRaceRecapFacts([
      { driver: 'Driver A', position: 1, gridPosition: 3 },
      { driver: 'Driver B', position: 2, gridPosition: 1 },
      { driver: 'Driver C', position: 3, gridPosition: 5 },
    ], []);
    expect(recap.available).toBe(true);
    expect(recap.narrativeAvailable).toBe(false);
    expect(recap.entries.map((entry) => entry.category)).toEqual(['WINNER', 'PODIUM', 'POSITIONS GAINED']);
    expect(recap.entries.every((entry) => entry.kind === 'FACT' && entry.sourceUrl.includes('jolpica-f1'))).toBe(true);
  });

  it('derives grid-to-finish positions change and teammate result', () => {
    const report = deriveRaceAnalysis(results, [], { recordCount: 0, verified: false });
    expect(report.positions.rows.slice(0, 2).map((row) => row.positionsChange)).toEqual([2, -2]);
    expect(report.teammateBattles.rows).toEqual([{ team: 'Team', driverA: 'Driver A', driverB: 'Driver B', finishA: 2, finishB: 4, outcome: 'DRIVER_A_AHEAD' }]);
  });

  it('uses only joined, verified qualifying rows and exposes unsupported metrics', () => {
    const report = deriveRaceAnalysis(results, [{ driverId: 'a', driver: 'Driver A', position: 3 }, { driverId: 'missing', driver: 'Missing', position: 1 }], { recordCount: 2, verified: false });
    expect(report.qualifyingVsRace.rows).toEqual([{ driverId: 'a', driver: 'Driver A', qualifyingPosition: 3, finishPosition: 2, positionsChange: 1 }]);
    expect(report.pitStops).toMatchObject({ available: false, recordCount: 2 });
    expect(report.positions.rows[2]).toMatchObject({ positionsChange: null, label: 'Unavailable' });
  });

  it('returns clear unavailable states without source data', () => {
    const report = deriveRaceAnalysis([], [], { recordCount: 0, verified: false });
    expect(report.positions.available).toBe(false);
    expect(report.qualifyingVsRace.reason).toContain('not stored');
    expect(report.teammateBattles.available).toBe(false);
  });
});
