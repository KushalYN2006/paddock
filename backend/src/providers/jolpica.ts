import { z } from 'zod';
import type { F1DataProvider, ScheduleRecord } from './types.js';

const circuitSchema = z.object({
  circuitId: z.string(),
  circuitName: z.string(),
  Location: z.object({
    locality: z.string().optional(),
    country: z.string().optional(),
    lat: z.string().optional(),
    long: z.string().optional(),
  }).optional(),
});

const raceSchema = z.object({
  season: z.string(),
  round: z.string(),
  raceName: z.string(),
  date: z.string().optional(),
  time: z.string().optional(),
  Circuit: circuitSchema.optional(),
  Sprint: z.unknown().optional(),
});

const scheduleResponseSchema = z.object({
  MRData: z.object({
    RaceTable: z.object({ Races: z.array(raceSchema) }),
  }),
});

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class JolpicaProvider implements F1DataProvider {
  readonly name = 'jolpica-f1';
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getSchedule(season: number): Promise<ScheduleRecord[]> {
    const url = `${this.baseUrl}/${season}/races.json?limit=100`;
    const response = await this.fetcher(url, { headers: { Accept: 'application/json' } });
    if (response.status === 429) throw new Error('Jolpica rate limit reached; retry with backoff.');
    if (!response.ok) throw new Error(`Jolpica schedule request failed (${response.status}).`);
    const body = scheduleResponseSchema.parse(await response.json());
    return body.MRData.RaceTable.Races.map((race) => {
      const raceYear = Number(race.season);
      const round = Number(race.round);
      if (raceYear !== season || !Number.isInteger(round) || round < 1) throw new Error('Provider returned a schedule row for the wrong season or an invalid round.');
      const circuit = race.Circuit;
      const dateText = race.date && race.time ? `${race.date}T${race.time}` : race.date;
      const scheduledStart = dateText ? new Date(dateText) : null;
      if (scheduledStart && !Number.isFinite(scheduledStart.getTime())) throw new Error(`Invalid scheduled date for round ${round}.`);
      return {
        season,
        round,
        sourceId: race.raceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: race.raceName,
        scheduledStart,
        circuit: circuit ? {
          sourceId: circuit.circuitId,
          name: circuit.circuitName,
          locality: circuit.Location?.locality ?? null,
          country: circuit.Location?.country ?? null,
          latitude: parseNumber(circuit.Location?.lat),
          longitude: parseNumber(circuit.Location?.long),
        } : null,
        isSprint: race.Sprint !== undefined,
      };
    }).sort((a, b) => a.round - b.round);
  }
}
