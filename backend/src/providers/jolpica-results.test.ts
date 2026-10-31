import { describe, expect, it } from 'vitest';
import { JolpicaResultsProvider } from './jolpica-results.js';

const result = (driverId: string, position: string, points: string) => ({
  position, positionText: position, points, number: '1', grid: '1', laps: '5', status: 'Finished',
  Driver: { driverId, permanentNumber: '1', givenName: 'Test', familyName: driverId, nationality: 'Test' },
  Constructor: { constructorId: 'team', name: 'Test Team', nationality: 'Test' },
});

const response = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Jolpica results provider', () => {
  it('follows provider pagination rather than treating the first 100 rows as a complete season', async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString(); urls.push(url);
      const offset = new URL(url).searchParams.get('offset');
      const race = offset === '0' ? { round: '1', raceName: 'Round 1', Results: [result('driver-a', '1', '25')] } : { round: '2', raceName: 'Round 2', Results: [result('driver-b', 'R', '0')] };
      const round = race.round;
      return response({ MRData: { limit: '100', offset, total: '101', RaceTable: { Races: [{ season: '2026', round, raceName: race.raceName, [offset === '0' ? 'Results' : 'Results']: race.Results }] } } });
    };
    const provider = new JolpicaResultsProvider('https://api.jolpi.ca/ergast/f1', fetcher);
    const rows = await provider.getResults(2026, 'RACE');

    expect(urls.map((url) => new URL(url).searchParams.get('offset'))).toEqual(['0', '100']);
    expect(rows.map((row) => [row.round, row.position, row.providerPoints])).toEqual([[1, 1, 25], [2, null, 0]]);
  });

  it('imports qualifying countback positions with driver and constructor identities', async () => {
    const fetcher: typeof fetch = async () => response({ MRData: {
      limit: '100', offset: '0', total: '2',
      RaceTable: { Races: [{ season: '2026', round: '1', raceName: 'Round 1', QualifyingResults: [
        { position: '1', Driver: { driverId: 'driver-a', givenName: 'A', familyName: 'One' }, Constructor: { constructorId: 'team-a', name: 'Team A' } },
        { position: '2', Driver: { driverId: 'driver-b', givenName: 'B', familyName: 'Two' }, Constructor: { constructorId: 'team-b', name: 'Team B' } },
      ] }] },
    } });
    const provider = new JolpicaResultsProvider('https://api.jolpi.ca/ergast/f1', fetcher);

    await expect(provider.getQualifyingResults(2026)).resolves.toMatchObject([
      { round: 1, position: 1, driver: { sourceId: 'driver-a' }, team: { sourceId: 'team-a' } },
      { round: 1, position: 2, driver: { sourceId: 'driver-b' }, team: { sourceId: 'team-b' } },
    ]);
  });
});
