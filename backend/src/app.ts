import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from './config/env.js';
import { buildCalculatorSummary, calculateScenario } from './scoring/calculator.js';
import { buildRaceRecapFacts, deriveRaceAnalysis } from './analysis/race-analysis.js';
import { backtestPredictionModel, buildPredictionEstimate, type PredictionSnapshot } from './scoring/predictions.js';
import { registerAdminRoutes } from './admin/routes.js';
import { RacingHubCareerProvider } from './providers/racinghub-career.js';

const prisma = new PrismaClient();
const careerStatsProvider = new RacingHubCareerProvider();
const yearSchema = z.coerce.number().int().min(1950).max(2100);
const roundSchema = z.coerce.number().int().min(1).max(60);

function apiError(code: string, message: string) {
  return { error: { code, message, details: [] }, meta: { season: new Date().getUTCFullYear(), throughRound: 0, updatedAt: null, stale: true, source: 'jolpica-f1' } };
}

function dataEnvelope<T>(data: T, status?: { seasonYear: number; throughRound: number; updatedAt: Date | null; stale: boolean; provider: string }) {
  return {
    data,
    meta: {
      season: status?.seasonYear ?? new Date().getUTCFullYear(),
      throughRound: status?.throughRound ?? 0,
      updatedAt: status?.updatedAt?.toISOString() ?? null,
      stale: status?.stale ?? true,
      source: status?.provider ?? 'jolpica-f1',
    },
  };
}

async function statusFor(year: number) {
  return prisma.dataStatus.findUnique({ where: { seasonYear: year } });
}

export async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(helmet);
  const allowedOrigins = [
    env.CORS_ORIGIN,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ];
  await app.register(cors, { origin: [...new Set(allowedOrigins)], credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(cookie);
  await registerAdminRoutes(app, prisma);

  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', database: 'unavailable' });
    }
  });

  const glossary = [
    { id: 'grand-prix', label: 'Grand Prix', definition: 'The main event of an F1 race weekend. A Grand Prix usually includes practice, qualifying and a Sunday race; Sprint weekends add a shorter Sprint event.' },
    { id: 'constructor', label: 'Constructor', definition: 'The team that designs and enters a car. Drivers score for themselves and their constructor in the championship.' },
    { id: 'pit-stop', label: 'Pit stop', definition: 'A stop in the pit lane, most often to change tyres or repair the car. The crew must work within the pit lane speed limit.' },
    { id: 'qualifying', label: 'Qualifying', definition: 'A timed session that sets the starting order for the Grand Prix. The session format and any Sprint-weekend changes are defined by that season’s regulations.' },
    { id: 'safety-car', label: 'Safety car', definition: 'A controlled pace car deployed when conditions require the field to slow and queue. It can affect gaps and pit-stop strategy.' },
    { id: 'parc-ferme', label: 'Parc fermé', definition: 'A restricted setup period during which teams cannot freely change a car. The applicable restrictions depend on the event regulations.' },
  ];
  const guide = [
    { id: 'weekend', title: 'A race weekend, in three steps', body: 'Practice gives teams time to learn about the car and circuit. Qualifying determines the grid for the Grand Prix. The Grand Prix is the main race, where drivers compete for finishing position and championship points. Sprint weekends use a different session schedule; check the selected season’s event format.' },
    { id: 'championship', title: 'Two championships run together', body: 'Every driver competes for the Drivers’ Championship. Each driver also earns points for their constructor, which competes in the Constructors’ Championship. The points awarded depend on the season’s rules and session type.' },
    { id: 'racecraft', title: 'Why strategy matters', body: 'Teams make decisions about tyres, pit stops and when to respond to changing track conditions. A safety car or a slow stop can change the race order. Results on this site are shown only after verified classification data is available.' },
    { id: '2026', title: 'Rules are season-specific', body: 'Technical and sporting rules can change from year to year. For 2026, consult the FIA’s current regulations for exact procedures and scoring. This guide sticks to broad concepts and does not present a rule summary as a substitute for the regulations.', sourceUrl: 'https://www.fia.com/regulation/category/110' },
  ];
  const quiz = [
    { id: 'points-destination', topic: 'Championships', question: 'A driver earns points in a Grand Prix. Which championship do those points contribute to?', options: ['Drivers’ and Constructors’ Championships', 'Only the Drivers’ Championship', 'Only the Constructors’ Championship'], correctIndex: 0, explanation: 'A driver’s result contributes to their individual total and to the constructor they represent.' },
    { id: 'grid-order', topic: 'Race weekend', question: 'What does Grand Prix qualifying primarily determine?', options: ['The starting order for the Grand Prix', 'The final championship standings', 'Which team can make a pit stop'], correctIndex: 0, explanation: 'Qualifying sets the starting grid, subject to any penalties or official decisions.' },
    { id: 'safety-car-purpose', topic: 'Racecraft', question: 'What is a key purpose of the safety car?', options: ['Slow and group cars when conditions require it', 'Award bonus championship points', 'Set the fastest lap'], correctIndex: 0, explanation: 'The safety car controls the field’s pace while an incident or unsafe condition is addressed.' },
  ];
  app.get('/api/v1/learn/guide', async (request, reply) => {
    const parsed = z.object({ season: yearSchema.optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Season must be a year from 1950 to 2100.'));
    return dataEnvelope({ season: parsed.data.season ?? new Date().getUTCFullYear(), sections: guide });
  });
  app.get('/api/v1/learn/glossary', async () => dataEnvelope(glossary));
  app.get('/api/v1/learn/quizzes', async () => dataEnvelope(quiz.map(({ id, topic, question, options }) => ({ id, topic, question, options }))));
  app.post('/api/v1/learn/quizzes/:id/answers', async (request, reply) => {
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const body = z.object({ answerIndex: z.number().int().min(0).max(20) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(apiError('INVALID_ANSWER', 'Provide a valid answer index.'));
    const question = quiz.find((item) => item.id === params.data.id);
    if (!question) return reply.code(404).send(apiError('NOT_FOUND', 'Quiz question not found.'));
    return dataEnvelope({ correct: body.data.answerIndex === question.correctIndex, correctIndex: question.correctIndex, explanation: question.explanation });
  });

  app.get('/api/v1/status', async (request, reply) => {
    const parsed = z.object({ season: yearSchema.optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Season must be a year from 1950 to 2100.'));
    const query = parsed.data;
    const season = query.season ?? new Date().getUTCFullYear();
    const status = await statusFor(season);
    const lastRound = status?.throughRound ? await prisma.round.findUnique({ where: { seasonYear_number: { seasonYear: season, number: status.throughRound } } }) : null;
    return dataEnvelope(status ? {
      season: status.seasonYear,
      throughRound: status.throughRound,
      throughRoundName: lastRound?.name ?? null,
      updatedAt: status.updatedAt?.toISOString() ?? null,
      stale: status.stale,
      provider: status.provider,
      lastError: status.lastError,
    } : {
      season,
      throughRound: 0,
      throughRoundName: null,
      updatedAt: null,
      stale: true,
      provider: 'jolpica-f1',
      lastError: null,
    }, status ?? undefined);
  });

  app.get('/api/v1/seasons', async () => {
    const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' }, include: { dataStatus: true } });
    const currentYear = new Date().getUTCFullYear();
    return dataEnvelope(seasons.map(({ year, isCurrent, dataStatus }) => ({
      year, isCurrent: isCurrent || year === currentYear, readOnly: !isCurrent && year !== currentYear,
      throughRound: dataStatus?.throughRound ?? 0,
    })), await statusFor(currentYear) ?? undefined);
  });

  app.get('/api/v1/seasons/:year/calculator/summary', async (request, reply) => {
    const parsed = z.object({ year: yearSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_SEASON', 'Season must be a year from 1950 to 2100.'));
    const year = parsed.data.year;
    if (year !== 2026) return reply.code(422).send(apiError('RULESET_UNAVAILABLE', `Calculator rules are not verified for ${year}.`));
    const [status, rounds, entrantCount] = await Promise.all([
      statusFor(year),
      prisma.round.findMany({ where: { seasonYear: year }, orderBy: { number: 'asc' } }),
      prisma.driverSeasonEntry.findMany({ where: { seasonYear: year }, distinct: ['driverId'], select: { driverId: true } }),
    ]);
    const throughRound = status?.throughRound ?? 0;
    if (!throughRound) return reply.code(422).send(apiError('NOT_ENOUGH_DATA', 'Verified standings are not available for this season yet.'));
    const rows = await prisma.driverStanding.findMany({ where: { seasonYear: year, throughRound }, orderBy: { position: 'asc' }, include: { driver: true } });
    return dataEnvelope({ ...buildCalculatorSummary(rows.map((row) => ({ id: row.driverId, name: row.driver.displayName, position: row.position, points: row.points })), rounds.map((round) => ({ round: round.number, name: round.name, isSprint: round.isSprint, isFuture: Boolean(round.scheduledStart && round.scheduledStart > new Date()) })), throughRound), entrantCount: entrantCount.length }, status ?? undefined);
  });

  app.post('/api/v1/seasons/:year/calculator/scenario', async (request, reply) => {
    const parsed = z.object({ params: z.object({ year: yearSchema }), body: z.object({ rounds: z.array(z.object({ round: roundSchema, raceFinishes: z.array(z.object({ driverId: z.string().min(1), position: z.number().int() })).max(40), sprintFinishes: z.array(z.object({ driverId: z.string().min(1), position: z.number().int() })).max(40).optional() })).max(30) }) }).safeParse({ params: request.params, body: request.body });
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_SCENARIO', 'Scenario input is invalid or exceeds the supported limit.'));
    const year = parsed.data.params.year;
    if (year !== 2026) return reply.code(422).send(apiError('RULESET_UNAVAILABLE', `Calculator rules are not verified for ${year}.`));
    const [status, rounds, entrants] = await Promise.all([
      statusFor(year),
      prisma.round.findMany({ where: { seasonYear: year }, orderBy: { number: 'asc' } }),
      prisma.driverSeasonEntry.findMany({ where: { seasonYear: year }, distinct: ['driverId'], select: { driverId: true } }),
    ]);
    const throughRound = status?.throughRound ?? 0;
    if (!throughRound) return reply.code(422).send(apiError('NOT_ENOUGH_DATA', 'Verified standings are not available for this season yet.'));
    const rows = await prisma.driverStanding.findMany({ where: { seasonYear: year, throughRound }, orderBy: { position: 'asc' }, include: { driver: true } });
    try {
      const data = calculateScenario({ standings: rows.map((row) => ({ id: row.driverId, name: row.driver.displayName, position: row.position, points: row.points })), rounds: rounds.map((round) => ({ round: round.number, name: round.name, isSprint: round.isSprint, isFuture: Boolean(round.scheduledStart && round.scheduledStart > new Date()) })), throughRound, entrantCount: entrants.length, assignments: parsed.data.body.rounds });
      return dataEnvelope(data, status ?? undefined);
    } catch (error) {
      return reply.code(422).send({ ...apiError('INVALID_SCENARIO', error instanceof Error ? error.message : 'Scenario assignments are invalid.'), error: { code: 'INVALID_SCENARIO', message: error instanceof Error ? error.message : 'Scenario assignments are invalid.', details: [] } });
    }
  });

  app.get('/api/v1/seasons/:year/predictions', async (request, reply) => {
    const parsed = z.object({ year: yearSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_SEASON', 'Season must be a valid year.'));
    const year = parsed.data.year;
    const [status, rounds, currentRows, historical] = await Promise.all([
      statusFor(year),
      prisma.round.findMany({ where: { seasonYear: year }, orderBy: { number: 'asc' }, select: { number: true, scheduledStart: true } }),
      prisma.driverStanding.findMany({ where: { seasonYear: year }, orderBy: [{ throughRound: 'asc' }, { position: 'asc' }], include: { driver: true } }),
      prisma.season.findMany({ where: { year: { lt: year } }, select: { year: true, rounds: { select: { number: true } }, dataStatus: { select: { throughRound: true } }, driverStandings: { orderBy: [{ throughRound: 'asc' }, { position: 'asc' }], include: { driver: true } } } }),
    ]);
    const currentByRound = new Map<number, PredictionSnapshot>();
    for (const row of currentRows) {
      const snapshot = currentByRound.get(row.throughRound) ?? { round: row.throughRound, drivers: [] };
      snapshot.drivers.push({ id: row.driverId, name: row.driver.displayName, points: row.points });
      currentByRound.set(row.throughRound, snapshot);
    }
    const backtestSeasons = historical.flatMap((season) => {
      const finalRound = Math.max(0, ...season.rounds.map((round) => round.number));
      if (finalRound < 5 || !season.dataStatus || season.dataStatus.throughRound < finalRound) return [];
      const byRound = new Map<number, PredictionSnapshot>();
      for (const row of season.driverStandings) {
        const snapshot = byRound.get(row.throughRound) ?? { round: row.throughRound, drivers: [] };
        snapshot.drivers.push({ id: row.driverId, name: row.driver.displayName, points: row.points });
        byRound.set(row.throughRound, snapshot);
      }
      return [{ season: season.year, rounds: [...byRound.values()] }];
    });
    const backtest = backtestPredictionModel(backtestSeasons);
    const throughRound = status?.throughRound ?? 0;
    const history = [...currentByRound.values()].filter((snapshot) => snapshot.round <= throughRound).sort((a, b) => a.round - b.round).slice(-4);
    const unconfirmedPastRounds = rounds.filter((round) => round.number > throughRound && round.scheduledStart !== null && round.scheduledStart <= new Date()).length;
    const result = buildPredictionEstimate({ season: year, throughRound, finalRound: Math.max(0, ...rounds.map((round) => round.number)), unconfirmedPastRounds, history, backtest });
    return dataEnvelope(result, status ?? undefined);
  });

  app.get('/api/v1/seasons/:year/calendar', async (request, reply) => {
    const params = z.object({ year: yearSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(apiError('INVALID_SEASON', 'Season must be a year from 1950 to 2100.'));
    const { year } = params.data;
    const [rounds, status] = await Promise.all([
      prisma.round.findMany({ where: { seasonYear: year }, orderBy: { number: 'asc' }, include: { circuit: true, results: { where: { sessionType: 'RACE', finishPosition: 1 }, include: { driver: true } } } }),
      statusFor(year),
    ]);
    return dataEnvelope(rounds.map((round) => ({
      round: round.number,
      name: round.name,
      scheduledStart: round.scheduledStart?.toISOString() ?? null,
      scheduleUpdatedAt: round.scheduleUpdatedAt?.toISOString() ?? null,
      status: round.number <= (status?.throughRound ?? 0) ? 'COMPLETED' : round.scheduledStart && round.scheduledStart > new Date() ? 'UPCOMING' : 'UNKNOWN',
      circuit: round.circuit?.name ?? null,
      winner: round.results[0]?.driver.displayName ?? null,
    })), status ?? undefined);
  });

  app.get('/api/v1/seasons/:year/races', async (request, reply) => {
    const parsed = z.object({ params: z.object({ year: yearSchema }), query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0), order: z.enum(['asc', 'desc']).default('asc') }) }).safeParse({ params: request.params, query: request.query });
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid season or pagination values.'));
    const { year } = parsed.data.params;
    const { limit, offset, order } = parsed.data.query;
    const [rounds, total, status] = await Promise.all([
      prisma.round.findMany({ where: { seasonYear: year }, orderBy: { number: order }, skip: offset, take: limit, include: { circuit: true, results: { where: { sessionType: 'RACE', finishPosition: 1 }, include: { driver: true } } } }),
      prisma.round.count({ where: { seasonYear: year } }),
      statusFor(year),
    ]);
    return { ...dataEnvelope(rounds.map((round) => ({
      round: round.number, name: round.name, scheduledStart: round.scheduledStart?.toISOString() ?? null, scheduleUpdatedAt: round.scheduleUpdatedAt?.toISOString() ?? null,
      status: round.number <= (status?.throughRound ?? 0) ? 'COMPLETED' : round.scheduledStart && round.scheduledStart > new Date() ? 'UPCOMING' : 'UNKNOWN',
      circuit: round.circuit?.name ?? null, winner: round.results[0]?.driver.displayName ?? null,
    })), status ?? undefined), meta: { season: year, throughRound: status?.throughRound ?? 0, updatedAt: status?.updatedAt?.toISOString() ?? null, stale: status?.stale ?? true, source: status?.provider ?? 'jolpica-f1', pagination: { limit, offset, total } } };
  });

  app.get('/api/v1/seasons/:year/standings/drivers', async (request, reply) => {
    const parsed = z.object({ params: z.object({ year: yearSchema }), query: z.object({ throughRound: roundSchema.optional() }) }).safeParse({ params: request.params, query: request.query });
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid season or round.'));
    const { year } = parsed.data.params;
    const status = await statusFor(year);
    const throughRound = parsed.data.query.throughRound ?? status?.throughRound ?? 0;
    const rows = await prisma.driverStanding.findMany({ where: { seasonYear: year, throughRound }, orderBy: { position: 'asc' }, include: { driver: { include: { entries: { where: { seasonYear: year }, orderBy: { validFromRound: 'desc' }, include: { team: true }, take: 1 } } } } });
    return dataEnvelope(rows.map((row) => ({ position: row.position, name: row.driver.displayName, team: row.driver.entries[0]?.team.name, points: row.points, wins: row.wins, podiums: row.podiums })), status ?? undefined);
  });

  app.get('/api/v1/seasons/:year/standings/constructors', async (request, reply) => {
    const parsed = z.object({ params: z.object({ year: yearSchema }), query: z.object({ throughRound: roundSchema.optional() }) }).safeParse({ params: request.params, query: request.query });
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid season or round.'));
    const { year } = parsed.data.params;
    const status = await statusFor(year);
    const throughRound = parsed.data.query.throughRound ?? status?.throughRound ?? 0;
    const rows = await prisma.constructorStanding.findMany({ where: { seasonYear: year, throughRound }, orderBy: { position: 'asc' }, include: { team: true } });
    return dataEnvelope(rows.map((row) => ({ position: row.position, name: row.team.name, points: row.points, wins: row.wins })), status ?? undefined);
  });

  app.get('/api/v1/seasons/:year/standings/:kind/history', async (request, reply) => {
    const parsed = z.object({ params: z.object({ year: yearSchema, kind: z.enum(['drivers', 'constructors']) }) }).safeParse(request);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Choose drivers or constructors and a valid season.'));
    const { year, kind } = parsed.data.params;
    const status = await statusFor(year);
    const latestRound = status?.throughRound ?? 0;
    if (!latestRound) return dataEnvelope({ series: [], rounds: [] }, status ?? undefined);
    if (kind === 'drivers') {
      const [leaders, snapshots] = await Promise.all([
        prisma.driverStanding.findMany({ where: { seasonYear: year, throughRound: latestRound }, orderBy: { position: 'asc' }, take: 5, include: { driver: true } }),
        prisma.driverStanding.findMany({ where: { seasonYear: year, throughRound: { lte: latestRound } }, orderBy: [{ throughRound: 'asc' }, { position: 'asc' }] }),
      ]);
      const ids = new Set(leaders.map((row) => row.driverId));
      const series = leaders.map((row) => ({ id: row.driverId, name: row.driver.displayName }));
      const byRound = new Map<number, Array<{ id: string; points: number }>>();
      for (const row of snapshots) if (ids.has(row.driverId)) byRound.set(row.throughRound, [...(byRound.get(row.throughRound) ?? []), { id: row.driverId, points: row.points }]);
      return dataEnvelope({ series, rounds: [...byRound.entries()].map(([round, values]) => ({ round, values })) }, status ?? undefined);
    }
    const [leaders, snapshots] = await Promise.all([
      prisma.constructorStanding.findMany({ where: { seasonYear: year, throughRound: latestRound }, orderBy: { position: 'asc' }, take: 5, include: { team: true } }),
      prisma.constructorStanding.findMany({ where: { seasonYear: year, throughRound: { lte: latestRound } }, orderBy: [{ throughRound: 'asc' }, { position: 'asc' }] }),
    ]);
    const ids = new Set(leaders.map((row) => row.constructorId));
    const series = leaders.map((row) => ({ id: row.constructorId, name: row.team.name }));
    const byRound = new Map<number, Array<{ id: string; points: number }>>();
    for (const row of snapshots) if (ids.has(row.constructorId)) byRound.set(row.throughRound, [...(byRound.get(row.throughRound) ?? []), { id: row.constructorId, points: row.points }]);
    return dataEnvelope({ series, rounds: [...byRound.entries()].map(([round, values]) => ({ round, values })) }, status ?? undefined);
  });

  app.get('/api/v1/seasons/:year/movers', async (request, reply) => {
    const parsed = z.object({ year: yearSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_SEASON', 'Season must be a year from 1950 to 2100.'));
    const { year } = parsed.data;
    const status = await statusFor(year);
    const throughRound = status?.throughRound ?? 0;
    if (throughRound < 2) return dataEnvelope([], status ?? undefined);
    const [current, previous] = await Promise.all([
      prisma.driverStanding.findMany({ where: { seasonYear: year, throughRound }, include: { driver: true } }),
      prisma.driverStanding.findMany({ where: { seasonYear: year, throughRound: throughRound - 1 } }),
    ]);
    const previousPosition = new Map(previous.map((row) => [row.driverId, row.position]));
    return dataEnvelope(current.map((row) => ({ id: row.driverId, name: row.driver.displayName, position: row.position, change: (previousPosition.get(row.driverId) ?? row.position) - row.position }))
      .filter((row) => row.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.position - b.position), status ?? undefined);
  });

  app.get('/api/v1/seasons/:year/races/:round', async (request, reply) => {
    const parsed = z.object({ year: yearSchema, round: roundSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_RACE', 'Invalid season or round.'));
    const { year, round: roundNumber } = parsed.data;
    const [round, status] = await Promise.all([
      prisma.round.findUnique({ where: { seasonYear_number: { seasonYear: year, number: roundNumber } }, include: { circuit: true, results: { orderBy: [{ sessionType: 'asc' }, { finishPosition: 'asc' }], include: { driver: true, team: true } }, recaps: { orderBy: { createdAt: 'asc' } } } }),
      statusFor(year),
    ]);
    if (!round) return reply.code(404).send({ error: { code: 'RACE_NOT_FOUND', message: 'No race is available for that round.' } });
    const sourcedRecaps = round.recaps.filter((entry) => (entry.kind === 'FACT' || entry.kind === 'INTERPRETATION') && typeof entry.sourceUrl === 'string' && entry.sourceUrl.length > 0);
    const recap = buildRaceRecapFacts(round.results.filter((result) => result.sessionType === 'RACE').map((result) => ({ driver: result.driver.displayName, position: result.finishPosition, gridPosition: result.gridPosition })), sourcedRecaps.map((entry) => ({ kind: entry.kind as 'FACT' | 'INTERPRETATION', category: entry.category, body: entry.body, sourceUrl: entry.sourceUrl!, sourceLabel: entry.sourceLabel })));
    return dataEnvelope({ round: round.number, name: round.name, circuit: round.circuit?.name ?? null, scheduledStart: round.scheduledStart?.toISOString() ?? null,
      results: round.results.filter((result) => result.sessionType === 'RACE').map((result) => ({ position: result.finishPosition, driver: result.driver.displayName, constructor: result.team.name, points: result.points, status: result.status })),
      sprintResults: round.results.filter((result) => result.sessionType === 'SPRINT').map((result) => ({ position: result.finishPosition, driver: result.driver.displayName, constructor: result.team.name, points: result.points, status: result.status })),
      recap: { ...recap, unsupportedEntryCount: round.recaps.length - sourcedRecaps.length },
    }, status ?? undefined);
  });

  app.get('/api/v1/seasons/:year/races/:round/analysis', async (request, reply) => {
    const parsed = z.object({ year: yearSchema, round: roundSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_RACE', 'Invalid season or round.'));
    const { year, round: roundNumber } = parsed.data;
    const [round, status] = await Promise.all([
      prisma.round.findUnique({ where: { seasonYear_number: { seasonYear: year, number: roundNumber } }, include: { results: { where: { sessionType: 'RACE' }, orderBy: { finishPosition: 'asc' }, include: { driver: true, team: true } }, qualifying: { include: { driver: true } }, pitStops: { select: { id: true } } } }),
      statusFor(year),
    ]);
    if (!round) return reply.code(404).send({ error: { code: 'RACE_NOT_FOUND', message: 'No race is available for that round.' } });
    const report = deriveRaceAnalysis(
      round.results.map((result) => ({ driverId: result.driverId, driver: result.driver.displayName, teamId: result.constructorId, team: result.team.name, gridPosition: result.gridPosition, finishPosition: result.finishPosition, status: result.status })),
      round.qualifying.map((result) => ({ driverId: result.driverId, driver: result.driver.displayName, position: result.position })),
      { recordCount: round.pitStops.length, verified: false },
    );
    return dataEnvelope({ round: round.number, name: round.name, ...report }, status ?? undefined);
  });

  app.get('/api/v1/drivers', async (request, reply) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0), season: yearSchema.optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid driver-list filters.'));
    const { limit, offset, season } = parsed.data;
    const selectedSeason = season ?? new Date().getUTCFullYear();
    const [drivers, total, status] = await Promise.all([
      prisma.driver.findMany({ orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }], skip: offset, take: limit, include: { entries: { where: { seasonYear: selectedSeason, validToRound: null }, orderBy: { validFromRound: 'desc' }, include: { team: true }, take: 1 } } }),
      prisma.driver.count(),
      statusFor(selectedSeason),
    ]);
    const envelope = dataEnvelope(drivers.map((driver) => ({ id: driver.id, name: driver.displayName, nationality: driver.nationality, team: driver.entries[0]?.team.name ?? null, number: driver.entries[0]?.racingNumber ?? null })), status ?? undefined);
    return { ...envelope, meta: { ...envelope.meta, pagination: { limit, offset, total } } };
  });

  app.get('/api/v1/drivers/:id', async (request, reply) => {
    const parsed = z.object({ params: z.object({ id: z.string().min(1).max(100) }), query: z.object({ season: yearSchema.optional() }) }).safeParse({ params: request.params, query: request.query });
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_DRIVER', 'Invalid driver identifier.'));
    const { id } = parsed.data.params;
    const driver = await prisma.driver.findUnique({ where: { id }, include: { entries: { where: parsed.data.query.season ? { seasonYear: parsed.data.query.season } : undefined, orderBy: { seasonYear: 'desc' }, take: 1, include: { season: true, team: true } } } });
    if (!driver) return reply.code(404).send({ error: { code: 'DRIVER_NOT_FOUND', message: 'No driver is available with that identifier.' } });
    const entry = driver.entries[0];
    const seasonYear = parsed.data.query.season ?? entry?.seasonYear ?? null;
    const status = seasonYear ? await statusFor(seasonYear) : null;
    const throughRound = status?.throughRound ?? 0;
    const [results, qualifying, standing, throughRoundRecord] = entry && throughRound ? await Promise.all([
      prisma.result.findMany({ where: { driverId: driver.id, round: { seasonYear: entry.seasonYear, number: { lte: throughRound } } }, select: { sessionType: true, finishPosition: true, points: true } }),
      prisma.qualifyingResult.findMany({ where: { driverId: driver.id, round: { seasonYear: entry.seasonYear, number: { lte: throughRound } } }, select: { position: true, roundId: true } }),
      prisma.driverStanding.findUnique({ where: { seasonYear_throughRound_driverId: { seasonYear: entry.seasonYear, throughRound, driverId: driver.id } }, select: { position: true, points: true } }),
      prisma.round.findUnique({ where: { seasonYear_number: { seasonYear: entry.seasonYear, number: throughRound } }, select: { name: true } }),
    ]) : [[], [], null, null] as const;
    const raceResults = results.filter((result) => result.sessionType === 'RACE');
    const currentStats = entry && throughRound ? {
      available: true,
      throughRound,
      throughRoundName: throughRoundRecord?.name ?? null,
      position: standing?.position ?? null,
      points: standing?.points ?? results.reduce((total, result) => total + result.points, 0),
      wins: raceResults.filter((result) => result.finishPosition === 1).length,
      podiums: raceResults.filter((result) => result.finishPosition !== null && result.finishPosition <= 3).length,
      poles: qualifying.length >= Math.max(0, throughRound - Math.max(1, entry.validFromRound ?? 1) + 1) ? qualifying.filter((result) => result.position === 1).length : null,
    } : { available: false, throughRound, throughRoundName: null, position: null, points: null, wins: null, podiums: null, poles: null };
    return dataEnvelope({ id: driver.id, name: driver.displayName, nationality: driver.nationality, biography: driver.biography, imageUrl: driver.imageUrl, imageCredit: driver.imageCredit, season: entry?.seasonYear ?? seasonYear, team: entry?.team.name ?? null, number: entry?.racingNumber ?? null, currentStats, career: { available: false, reason: 'Career record is loading from the historical statistics source.' } }, status ?? undefined);
  });

  app.get('/api/v1/drivers/:id/career', async (request, reply) => {
    const parsed = z.object({ params: z.object({ id: z.string().min(1).max(100) }) }).safeParse({ params: request.params });
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_DRIVER', 'Invalid driver identifier.'));
    const driver = await prisma.driver.findUnique({ where: { id: parsed.data.params.id }, select: { displayName: true } });
    if (!driver) return reply.code(404).send(apiError('DRIVER_NOT_FOUND', 'No driver is available with that identifier.'));
    try {
      const career = await careerStatsProvider.getDriverCareer(driver.displayName);
      return dataEnvelope(career ? { ...career, reason: null } : { available: false, reason: 'No matching career record was returned by the historical statistics source.' });
    } catch {
      return dataEnvelope({ available: false, reason: 'Career statistics are temporarily unavailable from the historical statistics source.' });
    }
  });

  app.get('/api/v1/teams', async (request, reply) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0), season: yearSchema.optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid team-list filters.'));
    const { limit, offset, season } = parsed.data;
    const selectedSeason = season ?? new Date().getUTCFullYear();
    const [teams, total, status] = await Promise.all([
      prisma.constructor.findMany({ orderBy: { name: 'asc' }, skip: offset, take: limit, include: { entries: { where: { seasonYear: selectedSeason, validToRound: null }, orderBy: { validFromRound: 'asc' }, include: { driver: true } } } }),
      prisma.constructor.count(),
      statusFor(selectedSeason),
    ]);
    const envelope = dataEnvelope(teams.map((team) => ({ id: team.id, name: team.name, nationality: team.nationality, drivers: team.entries.map((entry) => entry.driver.displayName) })), status ?? undefined);
    return { ...envelope, meta: { ...envelope.meta, pagination: { limit, offset, total } } };
  });

  app.get('/api/v1/teams/:id', async (request, reply) => {
    const parsed = z.object({ params: z.object({ id: z.string().min(1).max(100) }), query: z.object({ season: yearSchema.optional() }) }).safeParse({ params: request.params, query: request.query });
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_TEAM', 'Invalid team identifier.'));
    const { id } = parsed.data.params;
    const seasonYear = parsed.data.query.season ?? new Date().getUTCFullYear();
    const team = await prisma.constructor.findUnique({ where: { id }, include: { entries: { where: { seasonYear, validToRound: null }, orderBy: { validFromRound: 'desc' }, include: { driver: true } } } });
    if (!team) return reply.code(404).send({ error: { code: 'TEAM_NOT_FOUND', message: 'No team is available with that identifier.' } });
    const status = await statusFor(seasonYear);
    const throughRound = status?.throughRound ?? 0;
    const [standing, throughRoundRecord] = throughRound ? await Promise.all([
      prisma.constructorStanding.findUnique({ where: { seasonYear_throughRound_constructorId: { seasonYear, throughRound, constructorId: team.id } }, select: { position: true, points: true, wins: true } }),
      prisma.round.findUnique({ where: { seasonYear_number: { seasonYear, number: throughRound } }, select: { name: true } }),
    ]) : [null, null] as const;
    const currentStats = standing ? { available: true, throughRound, throughRoundName: throughRoundRecord?.name ?? null, position: standing.position, points: standing.points, wins: standing.wins } : { available: false, throughRound, throughRoundName: null, position: null, points: null, wins: null };
    return dataEnvelope({ id: team.id, name: team.name, nationality: team.nationality, season: seasonYear, drivers: team.entries.map((item) => item.driver.displayName), currentStats, logoUrl: team.logoUrl, logoCredit: team.logoCredit }, status ?? undefined);
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.code(500).send(apiError('INTERNAL_ERROR', 'The request could not be completed.'));
  });
  app.addHook('onClose', async () => { await prisma.$disconnect(); });
  return app;
}
