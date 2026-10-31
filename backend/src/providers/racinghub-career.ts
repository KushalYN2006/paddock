import { z } from 'zod';

const driverCareerSchema = z.object({
  id: z.string(),
  name: z.string(),
  total_championship_wins: z.number().int().nonnegative(),
  total_race_starts: z.number().int().nonnegative(),
  total_race_wins: z.number().int().nonnegative(),
  total_podiums: z.number().int().nonnegative(),
  total_pole_positions: z.number().int().nonnegative(),
  total_fastest_laps: z.number().int().nonnegative(),
});

const responseSchema = z.object({ data: z.array(driverCareerSchema) });

export interface DriverCareerStats {
  available: true;
  championships: number;
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  sourceUrl: string;
}

const cacheDurationMs = 24 * 60 * 60 * 1000;

export class RacingHubCareerProvider {
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<DriverCareerStats | null> }>();

  constructor(
    private readonly baseUrl = 'https://racinghub.net/api/v1',
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  getDriverCareer(name: string): Promise<DriverCareerStats | null> {
    const query = name.trim();
    if (!query) return Promise.resolve(null);
    const key = normalizeName(query);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const value = this.fetchDriverCareer(query).catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { expiresAt: this.now() + cacheDurationMs, value });
    return value;
  }

  private async fetchDriverCareer(name: string): Promise<DriverCareerStats | null> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/drivers`);
    url.searchParams.set('q', name);
    url.searchParams.set('limit', '10');
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Paddock/0.1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`RacingHub career request failed (${response.status}).`);
    const parsed = responseSchema.parse(await response.json());
    const wantedName = normalizeName(name);
    const driver = parsed.data.find((item) => normalizeName(item.name) === wantedName);
    if (!driver) return null;
    return {
      available: true,
      championships: driver.total_championship_wins,
      starts: driver.total_race_starts,
      wins: driver.total_race_wins,
      podiums: driver.total_podiums,
      poles: driver.total_pole_positions,
      fastestLaps: driver.total_fastest_laps,
      sourceUrl: `https://racinghub.net/drivers/${encodeURIComponent(driver.id)}`,
    };
  }
}

function normalizeName(name: string) {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
}
