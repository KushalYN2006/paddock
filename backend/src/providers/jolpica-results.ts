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
    limit: z.string(), offset: z.string(), total: z.string(),
    RaceTable: z.object({ Races: z.array(z.object({ season: z.string(), round: z.string(), raceName: z.string(), Results: z.array(classifiedResult).optional(), SprintResults: z.array(classifiedResult).optional() })) }),
  }),
});

const qualifyingResponseSchema = z.object({
  MRData: z.object({
    limit: z.string(), offset: z.string(), total: z.string(),
    RaceTable: z.object({ Races: z.array(z.object({ season: z.string(), round: z.string(), raceName: z.string(), QualifyingResults: z.array(z.object({ number: z.string().optional(), position: z.string().optional(), Driver: z.object({ driverId: z.string(), permanentNumber: z.string().optional(), givenName: z.string(), familyName: z.string(), nationality: z.string().optional() }), Constructor: z.object({ constructorId: z.string(), name: z.string(), nationality: z.string().optional() }) })).optional() })) }),
  }),
});

const pageSize = 100;

export interface ImportedResult {
  season: number;
  round: number;
  raceName: string;
  position: number | null;
  providerPoints: number;
  grid: number | null;
  laps: number | null;
  status: string;
  driver: { sourceId: string; number: number | null; givenName: string; familyName: string; nationality: string | null };
  team: { sourceId: string; name: string; nationality: string | null };
  timeMillis: number | null;
}

export interface ImportedQualifyingResult {
  season: number;
  round: number;
  raceName: string;
  position: number;
  driver: { sourceId: string; number: number | null; givenName: string; familyName: string; nationality: string | null };
  team: { sourceId: string; name: string; nationality: string | null };
}

export class JolpicaResultsProvider {
  readonly name = 'jolpica-f1';
  private readonly baseUrl: string;
  private lastRequestAt = 0;
  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch) { this.baseUrl = baseUrl.replace(/\/$/, ''); }

  async getResults(season: number, session: 'RACE' | 'SPRINT'): Promise<ImportedResult[]> {
    const path = session === 'RACE' ? 'results' : 'sprint';
    const output: ImportedResult[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const parsed = await this.fetchPage(`${this.baseUrl}/${season}/${path}.json?limit=${pageSize}&offset=${offset}`, responseSchema, 'results');
      const { limit, total, offset: actualOffset } = parsePageMetadata(parsed.MRData, offset);
      for (const race of parsed.MRData.RaceTable.Races) {
        const round = parseRaceRound(race.season, race.round, season);
        for (const result of (session === 'RACE' ? race.Results : race.SprintResults) ?? []) {
          const positionNumber = Number(result.position);
          const position = Number.isInteger(positionNumber) && positionNumber > 0 ? positionNumber : null;
          const providerPoints = Number(result.points);
          if (!Number.isFinite(providerPoints) || (position === null && providerPoints !== 0)) throw new Error(`Invalid ${session.toLowerCase()} classification in round ${round}.`);
          output.push({
            season, round, raceName: race.raceName, position, providerPoints,
            grid: result.grid ? Number(result.grid) || null : null,
            laps: result.laps ? Number(result.laps) || null : null,
            status: result.status ?? result.positionText ?? 'Unknown',
            driver: { sourceId: result.Driver.driverId, number: result.Driver.permanentNumber ? Number(result.Driver.permanentNumber) || null : null, givenName: result.Driver.givenName, familyName: result.Driver.familyName, nationality: result.Driver.nationality ?? null },
            team: { sourceId: result.Constructor.constructorId, name: result.Constructor.name, nationality: result.Constructor.nationality ?? null },
            timeMillis: result.Time?.millis ? Number(result.Time.millis) || null : null,
          });
        }
      }
      if (actualOffset + limit >= total || limit === 0) break;
    }
    return output;
  }

  async getQualifyingResults(season: number): Promise<ImportedQualifyingResult[]> {
    const output: ImportedQualifyingResult[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const parsed = await this.fetchPage(`${this.baseUrl}/${season}/qualifying.json?limit=${pageSize}&offset=${offset}`, qualifyingResponseSchema, 'qualifying');
      const { limit, total, offset: actualOffset } = parsePageMetadata(parsed.MRData, offset);
      for (const race of parsed.MRData.RaceTable.Races) {
        const round = parseRaceRound(race.season, race.round, season);
        for (const result of race.QualifyingResults ?? []) {
          const position = Number(result.position);
          if (!Number.isInteger(position) || position < 1) throw new Error(`Invalid qualifying position in round ${round}.`);
          output.push({ season, round, raceName: race.raceName, position,
            driver: { sourceId: result.Driver.driverId, number: result.Driver.permanentNumber ? Number(result.Driver.permanentNumber) || null : null, givenName: result.Driver.givenName, familyName: result.Driver.familyName, nationality: result.Driver.nationality ?? null },
            team: { sourceId: result.Constructor.constructorId, name: result.Constructor.name, nationality: result.Constructor.nationality ?? null },
          });
        }
      }
      if (actualOffset + limit >= total || limit === 0) break;
    }
    return output;
  }

  private async fetchPage<T extends z.ZodType>(url: string, schema: T, label: string): Promise<z.infer<T>> {
    const waitMs = Math.max(0, 250 - (Date.now() - this.lastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt = Date.now();
    const response = await this.fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'Paddock/0.1.0' } });
    if (response.status === 429) throw new Error('Jolpica rate limit reached; retry with backoff.');
    if (!response.ok) throw new Error(`Jolpica ${label} request failed (${response.status}).`);
    return schema.parse(await response.json());
  }
}

function parsePageMetadata(meta: { limit: string; offset: string; total: string }, requestedOffset: number) {
  const limit = Number(meta.limit); const offset = Number(meta.offset); const total = Number(meta.total);
  if (![limit, offset, total].every(Number.isInteger) || limit < 0 || offset !== requestedOffset || total < 0) throw new Error('Jolpica returned invalid pagination metadata.');
  return { limit, offset, total };
}

function parseRaceRound(raceSeason: string, raceRound: string, requestedSeason: number) {
  const season = Number(raceSeason); const round = Number(raceRound);
  if (season !== requestedSeason || !Number.isInteger(round) || round < 1) throw new Error('Provider returned data for the wrong season or an invalid round.');
  return round;
}
