import { z } from 'zod';

const classifiedResult = z.object({
  number: z.string().optional(),
  position: z.string(),
  positionText: z.string().optional(),
  points: z.string(),
  grid: z.string().optional(),
  laps: z.string().optional(),
  status: z.string().optional(),
  Driver: z.object({ driverId: z.string(), permanentNumber: z.string().optional(), givenName: z.string(), familyName: z.string(), nationality: z.string().optional() }),
  Constructor: z.object({ constructorId: z.string(), name: z.string(), nationality: z.string().optional() }),
  Time: z.object({ millis: z.string().optional(), time: z.string().optional() }).optional(),
});

const responseSchema = z.object({
  MRData: z.object({
    RaceTable: z.object({ Races: z.array(z.object({ season: z.string(), round: z.string(), raceName: z.string(), Results: z.array(classifiedResult).optional(), SprintResults: z.array(classifiedResult).optional() })) }),
  }),
});

export interface ImportedResult {
  season: number;
  round: number;
  raceName: string;
  position: number;
  providerPoints: number;
  grid: number | null;
  laps: number | null;
  status: string;
  driver: { sourceId: string; number: number | null; givenName: string; familyName: string; nationality: string | null };
  team: { sourceId: string; name: string; nationality: string | null };
  timeMillis: number | null;
}

export class JolpicaResultsProvider {
  readonly name = 'jolpica-f1';
  private readonly baseUrl: string;
  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch) { this.baseUrl = baseUrl.replace(/\/$/, ''); }

  async getResults(season: number, session: 'RACE' | 'SPRINT'): Promise<ImportedResult[]> {
    const path = session === 'RACE' ? 'results' : 'sprint';
    const response = await this.fetcher(`${this.baseUrl}/${season}/${path}.json?limit=1000`, { headers: { Accept: 'application/json' } });
    if (response.status === 429) throw new Error('Jolpica rate limit reached; retry with backoff.');
    if (!response.ok) throw new Error(`Jolpica results request failed (${response.status}).`);
    const parsed = responseSchema.parse(await response.json());
    const output: ImportedResult[] = [];
    for (const race of parsed.MRData.RaceTable.Races) {
      const raceSeason = Number(race.season);
      const round = Number(race.round);
      if (raceSeason !== season || !Number.isInteger(round) || round < 1) throw new Error('Provider returned results for the wrong season or an invalid round.');
      for (const result of (session === 'RACE' ? race.Results : race.SprintResults) ?? []) {
        const position = Number(result.position);
        const providerPoints = Number(result.points);
        if (!Number.isFinite(providerPoints) || !Number.isInteger(position) || position < 1) throw new Error(`Invalid classification in round ${round}.`);
        output.push({
          season, round, raceName: race.raceName, position, providerPoints,
          grid: result.grid ? Number(result.grid) || null : null,
          laps: result.laps ? Number(result.laps) || null : null,
          status: result.status ?? 'Unknown',
          driver: { sourceId: result.Driver.driverId, number: result.Driver.permanentNumber ? Number(result.Driver.permanentNumber) || null : null, givenName: result.Driver.givenName, familyName: result.Driver.familyName, nationality: result.Driver.nationality ?? null },
          team: { sourceId: result.Constructor.constructorId, name: result.Constructor.name, nationality: result.Constructor.nationality ?? null },
          timeMillis: result.Time?.millis ? Number(result.Time.millis) || null : null,
        });
      }
    }
    return output;
  }
}
