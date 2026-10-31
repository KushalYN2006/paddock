import { describe, expect, it, vi } from 'vitest';
import { RacingHubCareerProvider } from './racinghub-career.js';

const response = {
  data: [{
    id: 'lewis-hamilton',
    name: 'Lewis Hamilton',
    total_championship_wins: 7,
    total_race_starts: 398,
    total_race_wins: 106,
    total_podiums: 208,
    total_pole_positions: 104,
    total_fastest_laps: 69,
  }],
};

describe('RacingHub career stats provider', () => {
  it('maps sourced career counts and matches names without diacritics', async () => {
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0]) => new Response(JSON.stringify(response), { status: 200 }));
    const provider = new RacingHubCareerProvider('https://racinghub.net/api/v1', fetcher);

    await expect(provider.getDriverCareer('Lewis Hamilton')).resolves.toEqual({
      available: true,
      championships: 7,
      starts: 398,
      wins: 106,
      podiums: 208,
      poles: 104,
      fastestLaps: 69,
      sourceUrl: 'https://racinghub.net/drivers/lewis-hamilton',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://racinghub.net/api/v1/drivers?q=Lewis+Hamilton&limit=10');
  });

  it('caches successful lookups for a day', async () => {
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0]) => new Response(JSON.stringify(response), { status: 200 }));
    const provider = new RacingHubCareerProvider('https://racinghub.net/api/v1', fetcher, () => 10_000);

    await provider.getDriverCareer('Lewis Hamilton');
    await provider.getDriverCareer('Lewis Hamilton');

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns null when the provider has no exact driver match', async () => {
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0]) => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const provider = new RacingHubCareerProvider('https://racinghub.net/api/v1', fetcher);

    await expect(provider.getDriverCareer('Unknown Driver')).resolves.toBeNull();
  });

  it('reports provider failures without inventing totals', async () => {
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0]) => new Response('', { status: 503 }));
    const provider = new RacingHubCareerProvider('https://racinghub.net/api/v1', fetcher);

    await expect(provider.getDriverCareer('Lewis Hamilton')).rejects.toThrow('RacingHub career request failed (503).');
  });
});
