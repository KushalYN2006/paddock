import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { scoreDeadHeats2026, type SessionType } from '../scoring/season-2026.js';
import { recalculateSeasonStandings } from './recalculate.js';
import { ADMIN_CSRF_COOKIE, ADMIN_SESSION_COOKIE, adminCookieOptions, createAdminSession, createCsrfToken, equalSecret, requireAdminCsrf, requireAdminSession, requireTrustedOrigin } from './auth.js';

const yearSchema = z.coerce.number().int().min(1950).max(2100);
const roundSchema = z.coerce.number().int().min(1).max(60);
const sessionSchema = z.enum(['RACE', 'SPRINT']);
const adminReasonSchema = z.enum(['source_correction', 'missing_provider_record', 'official_correction', 'classification_update', 'recap_source_update']);
const refreshes = new Map<number, { id: string; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; phase: string; updatedAt: string; message?: string }>();

function safeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function resultSnapshot(row: { id: string; roundId: string; driverId: string; constructorId: string; sessionType: string; gridPosition: number | null; finishPosition: number | null; classified: boolean; status: string | null; timeMillis: number | null; gapMillis: number | null; laps: number | null; points: number; fastestLap: number | null; sourcePayload: Prisma.JsonValue | null }) {
  return { id: row.id, roundId: row.roundId, driverId: row.driverId, constructorId: row.constructorId, sessionType: row.sessionType, gridPosition: row.gridPosition, finishPosition: row.finishPosition, classified: row.classified, status: row.status, timeMillis: row.timeMillis, gapMillis: row.gapMillis, laps: row.laps, points: row.points, fastestLap: row.fastestLap, sourcePayload: row.sourcePayload };
}

function addAudit(tx: Prisma.TransactionClient, input: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }) {
  return tx.auditLog.create({ data: { actor: 'configured-admin', action: input.action, entityType: input.entityType, entityId: input.entityId, before: input.before === undefined ? Prisma.JsonNull : safeJson(input.before), after: input.after === undefined ? Prisma.JsonNull : safeJson(input.after) } });
}

function addOverride(tx: Prisma.TransactionClient, input: { entityType: string; entityId: string; before: unknown; after: unknown; reason: string }) {
  return tx.manualOverride.create({ data: { entityType: input.entityType, entityId: input.entityId, field: 'record', previousValue: safeJson({ record: input.before }), overrideValue: safeJson({ record: input.after }), reason: input.reason } });
}

function createScriptArgs(script: string, year: number) {
  return import.meta.url.endsWith('.ts') ? ['--import', 'tsx', script, String(year)] : [script, String(year)];
}

function runScript(scriptName: 'import-schedule' | 'import-results', year: number) {
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const script = fileURLToPath(new URL(`../jobs/${scriptName}.${extension}`, import.meta.url));
  return new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, createScriptArgs(script, year), { cwd: process.cwd(), stdio: 'ignore', windowsHide: true, env: process.env });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

function launchRefresh(year: number) {
  const job = { id: crypto.randomUUID(), status: 'RUNNING' as const, phase: 'Updating schedule', updatedAt: new Date().toISOString() };
  refreshes.set(year, job);
  void (async () => {
    const scheduleOk = await runScript('import-schedule', year);
    if (!scheduleOk) { refreshes.set(year, { ...job, status: 'FAILED', phase: 'Schedule refresh failed', message: 'The schedule importer failed. Existing confirmed results remain authoritative.', updatedAt: new Date().toISOString() }); return; }
    refreshes.set(year, { ...job, phase: 'Validating results', updatedAt: new Date().toISOString() });
    const resultsOk = await runScript('import-results', year);
    refreshes.set(year, { ...job, status: resultsOk ? 'SUCCEEDED' : 'FAILED', phase: resultsOk ? 'Refresh complete' : 'Result import failed', ...(resultsOk ? {} : { message: 'The result importer failed validation. The last confirmed data remains available and is flagged stale.' }), updatedAt: new Date().toISOString() });
  })();
  return job;
}

export async function registerAdminRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post('/api/v1/admin/session', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, preHandler: [requireTrustedOrigin] }, async (request, reply) => {
    if (!env.ADMIN_ACCESS_KEY) return reply.code(503).send({ error: { code: 'ADMIN_NOT_CONFIGURED', message: 'Admin maintenance is disabled until an access key is configured.' } });
    const parsed = z.object({ accessKey: z.string().min(32).max(256) }).safeParse(request.body);
    if (!parsed.success || !equalSecret(parsed.data.accessKey, env.ADMIN_ACCESS_KEY)) return reply.code(401).send({ error: { code: 'INVALID_ADMIN_CREDENTIAL', message: 'The access key was not accepted.' } });
    const csrf = createCsrfToken();
    reply.setCookie(ADMIN_SESSION_COOKIE, createAdminSession(), { ...adminCookieOptions(), httpOnly: true, maxAge: 4 * 60 * 60 });
    reply.setCookie(ADMIN_CSRF_COOKIE, csrf, { ...adminCookieOptions(), httpOnly: false, maxAge: 4 * 60 * 60 });
    return { data: { authenticated: true }, meta: { stored: false } };
  });

  app.get('/api/v1/admin/session', { preHandler: [requireAdminSession] }, async () => ({ data: { authenticated: true }, meta: { stored: false } }));
  app.delete('/api/v1/admin/session', { preHandler: [requireTrustedOrigin] }, async (_request, reply) => {
    reply.clearCookie(ADMIN_SESSION_COOKIE, adminCookieOptions());
    reply.clearCookie(ADMIN_CSRF_COOKIE, adminCookieOptions());
    return { data: { authenticated: false }, meta: { stored: false } };
  });

  app.get('/api/v1/admin/status', { preHandler: [requireAdminSession] }, async () => {
    const seasons = await prisma.dataStatus.findMany({ orderBy: { seasonYear: 'desc' }, select: { seasonYear: true, throughRound: true, updatedAt: true, lastAttemptAt: true, lastError: true, stale: true, provider: true } });
    return { data: seasons, meta: { adminConfigured: Boolean(env.ADMIN_ACCESS_KEY) } };
  });

  app.get('/api/v1/admin/validation/:year', { preHandler: [requireAdminSession] }, async (request, reply) => {
    const parsed = z.object({ year: yearSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_SEASON', message: 'Season must be a valid year.' } });
    const seasonYear = parsed.data.year;
    const [status, rounds, results, qualifyingCount, pitStopCount] = await Promise.all([
      prisma.dataStatus.findUnique({ where: { seasonYear } }),
      prisma.round.findMany({ where: { seasonYear }, orderBy: { number: 'asc' }, select: { id: true, number: true, name: true, isSprint: true, scheduledStart: true } }),
      prisma.result.findMany({ where: { round: { seasonYear } }, include: { round: true, driver: true } }),
      prisma.qualifyingResult.count({ where: { round: { seasonYear } } }),
      prisma.pitStop.count({ where: { round: { seasonYear } } }),
    ]);
    const sessionGroups = new Map<string, typeof results>();
    for (const result of results) sessionGroups.set(`${result.round.number}:${result.sessionType}`, [...(sessionGroups.get(`${result.round.number}:${result.sessionType}`) ?? []), result]);
    const checks = [...sessionGroups.entries()].map(([key, rows]) => {
      const positions = rows.map((row) => row.finishPosition).filter((position): position is number => position !== null);
      const duplicatePositions = positions.filter((position, index) => positions.indexOf(position) !== index);
      let pointsMatch = true;
      if (seasonYear === 2026 && (key.endsWith(':RACE') || key.endsWith(':SPRINT'))) {
        const session: SessionType = key.endsWith(':SPRINT') ? 'SPRINT' : 'RACE';
        const scores = scoreDeadHeats2026(rows.map((row) => row.finishPosition ?? 0), session);
        pointsMatch = rows.every((row, index) => Math.abs(row.points - (scores[index] ?? 0)) < 0.001);
      }
      return { round: rows[0]?.round.number, session: rows[0]?.sessionType, resultCount: rows.length, missingPositions: rows.filter((row) => row.finishPosition === null).length, duplicatePositions: [...new Set(duplicatePositions)], pointsMatch };
    });
    const issues = checks.filter((check) => check.missingPositions || check.duplicatePositions.length || !check.pointsMatch);
    const unsupportedRuleSet = seasonYear !== 2026;
    return { data: { season: seasonYear, ruleset: unsupportedRuleSet ? null : 'FIA-2026-A2.2-ISS02', freshness: status ? { throughRound: status.throughRound, stale: status.stale, lastAttemptAt: status.lastAttemptAt?.toISOString() ?? null, lastError: status.lastError } : null, coverage: { scheduleRounds: rounds.length, raceResults: results.filter((row) => row.sessionType === 'RACE').length, sprintResults: results.filter((row) => row.sessionType === 'SPRINT').length, qualifyingResults: qualifyingCount, pitStopRecords: pitStopCount }, unsupportedRuleSet, rounds: rounds.map((round) => ({ round: round.number, name: round.name, isSprint: round.isSprint, hasRaceResults: results.some((result) => result.roundId === round.id && result.sessionType === 'RACE'), hasSprintResults: !round.isSprint || results.some((result) => result.roundId === round.id && result.sessionType === 'SPRINT') })), checks, issues }, meta: { updatedAt: status?.updatedAt?.toISOString() ?? null, stale: status?.stale ?? true } };
  });

  app.get('/api/v1/admin/seasons/:year/races/:round/results', { preHandler: [requireAdminSession] }, async (request, reply) => {
    const parsed = z.object({ year: yearSchema, round: roundSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_RACE', message: 'Invalid season or round.' } });
    const round = await prisma.round.findUnique({ where: { seasonYear_number: { seasonYear: parsed.data.year, number: parsed.data.round } }, include: { results: { orderBy: [{ sessionType: 'asc' }, { finishPosition: 'asc' }], include: { driver: true, team: true } } } });
    if (!round) return reply.code(404).send({ error: { code: 'ROUND_NOT_FOUND', message: 'Round not found.' } });
    return { data: round.results.map((result) => ({ id: result.id, session: result.sessionType, driverId: result.driverId, driver: result.driver.displayName, constructor: result.team.name, gridPosition: result.gridPosition, finishPosition: result.finishPosition, status: result.status, points: result.points })) };
  });

  app.get('/api/v1/admin/overrides', { preHandler: [requireAdminSession] }, async (request, reply) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_QUERY', message: 'Override limit must be from 1 to 100.' } });
    const entries = await prisma.manualOverride.findMany({ where: { revertedAt: null }, orderBy: { createdAt: 'desc' }, take: parsed.data.limit });
    return { data: entries.map((entry) => ({ id: entry.id, entityType: entry.entityType, entityId: entry.entityId, reason: entry.reason, createdAt: entry.createdAt })) };
  });

  app.get('/api/v1/admin/audit', { preHandler: [requireAdminSession] }, async (request, reply) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_QUERY', message: 'Audit limit must be from 1 to 100.' } });
    const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: parsed.data.limit, select: { id: true, actor: true, action: true, entityType: true, entityId: true, before: true, after: true, createdAt: true } });
    return { data: entries, meta: { count: entries.length } };
  });

  app.get('/api/v1/admin/refresh/:year', { preHandler: [requireAdminSession] }, async (request, reply) => {
    const parsed = z.object({ year: yearSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_SEASON', message: 'Season must be a valid year.' } });
    return { data: refreshes.get(parsed.data.year) ?? { status: 'NOT_RUN', phase: 'No manual refresh has run in this process.' } };
  });

  app.post('/api/v1/admin/refresh/:year', { preHandler: [requireAdminSession, requireAdminCsrf] }, async (request, reply) => {
    const parsed = z.object({ year: yearSchema }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_SEASON', message: 'Season must be a valid year.' } });
    const running = refreshes.get(parsed.data.year);
    if (running?.status === 'RUNNING') return reply.code(409).send({ error: { code: 'REFRESH_ALREADY_RUNNING', message: 'A refresh is already running for this season.' } });
    const job = launchRefresh(parsed.data.year);
    await prisma.auditLog.create({ data: { actor: 'configured-admin', action: 'REFRESH_STARTED', entityType: 'Season', entityId: String(parsed.data.year), after: safeJson({ jobId: job.id }) } });
    return reply.code(202).send({ data: job });
  });

  app.patch('/api/v1/admin/results/:id', { preHandler: [requireAdminSession, requireAdminCsrf] }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const body = z.object({ gridPosition: z.number().int().min(1).max(40).nullable().optional(), finishPosition: z.number().int().min(1).max(40).nullable().optional(), status: z.string().min(1).max(80).optional(), reason: adminReasonSchema, sourceUrl: z.url() }).refine((value) => value.gridPosition !== undefined || value.finishPosition !== undefined || value.status !== undefined).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: { code: 'INVALID_CORRECTION', message: 'Provide a supported result field, a source URL, and a reason of at least 10 characters.' } });
    try {
      const changed = await prisma.$transaction(async (tx) => {
        const result = await tx.result.findUnique({ where: { id: params.data.id }, include: { round: true } });
        if (!result) throw new Error('RESULT_NOT_FOUND');
        if (result.round.seasonYear !== 2026 || !['RACE', 'SPRINT'].includes(result.sessionType)) throw new Error('No verified scoring ruleset is available for this result session.');
        const entrantCount = await tx.driverSeasonEntry.count({ where: { seasonYear: result.round.seasonYear, validFromRound: { lte: result.round.number }, OR: [{ validToRound: null }, { validToRound: { gte: result.round.number } }] } });
        const finishPosition = body.data.finishPosition === undefined ? result.finishPosition : body.data.finishPosition;
        const gridPosition = body.data.gridPosition === undefined ? result.gridPosition : body.data.gridPosition;
        if (finishPosition !== null && finishPosition > entrantCount) throw new Error(`Finishing position must be within the ${entrantCount} event entrants.`);
        if (gridPosition !== null && gridPosition > entrantCount) throw new Error(`Grid position must be within the ${entrantCount} event entrants.`);
        if (finishPosition !== null && await tx.result.count({ where: { id: { not: result.id }, roundId: result.roundId, sessionType: result.sessionType, finishPosition } })) throw new Error(`P${finishPosition} is already assigned in this classification.`);
        const before = resultSnapshot(result);
        const sourcePayload = { manualCorrection: { sourceUrl: body.data.sourceUrl, reason: body.data.reason } };
        const after = await tx.result.update({ where: { id: result.id }, data: { gridPosition, finishPosition, status: body.data.status ?? result.status, points: result.points, sourcePayload }, include: { round: true } });
        const sessionRows = await tx.result.findMany({ where: { roundId: result.roundId, sessionType: result.sessionType }, orderBy: { finishPosition: 'asc' } });
        const scores = scoreDeadHeats2026(sessionRows.map((row) => row.finishPosition ?? 0), result.sessionType as SessionType);
        for (const [index, row] of sessionRows.entries()) await tx.result.update({ where: { id: row.id }, data: { points: scores[index] ?? 0 } });
        const status = await tx.dataStatus.findUnique({ where: { seasonYear: result.round.seasonYear } });
        if (!status?.throughRound) throw new Error('No confirmed standings exist to recalculate for this season.');
        await recalculateSeasonStandings(tx, result.round.seasonYear, status.throughRound);
        const afterSnapshot = resultSnapshot({ ...after, points: scores[sessionRows.findIndex((row) => row.id === result.id)] ?? after.points });
        await addOverride(tx, { entityType: 'Result', entityId: result.id, before, after: afterSnapshot, reason: body.data.reason });
        await addAudit(tx, { action: 'RESULT_CORRECTED', entityType: 'Result', entityId: result.id, before, after: afterSnapshot });
        return { id: result.id, points: afterSnapshot.points, season: result.round.seasonYear, round: result.round.number };
      });
      return { data: changed };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Result correction failed.';
      const code = message === 'RESULT_NOT_FOUND' ? 404 : message.includes('already assigned') || message.includes('must be within') ? 422 : 409;
      return reply.code(code).send({ error: { code: code === 404 ? 'RESULT_NOT_FOUND' : 'CORRECTION_REJECTED', message } });
    }
  });

  app.put('/api/v1/admin/seasons/:year/races/:round/results/:session/:driverId', { preHandler: [requireAdminSession, requireAdminCsrf] }, async (request, reply) => {
    const params = z.object({ year: yearSchema, round: roundSchema, session: sessionSchema, driverId: z.string().min(1).max(100) }).safeParse(request.params);
    const body = z.object({ gridPosition: z.number().int().min(1).max(40).nullable(), finishPosition: z.number().int().min(1).max(40), status: z.string().min(1).max(80), reason: adminReasonSchema, sourceUrl: z.url() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: { code: 'INVALID_RESULT', message: 'Provide a valid event result, source URL, and reason.' } });
    try {
      const data = await prisma.$transaction(async (tx) => {
        const round = await tx.round.findUnique({ where: { seasonYear_number: { seasonYear: params.data.year, number: params.data.round } } });
        if (!round) throw new Error('ROUND_NOT_FOUND');
        if (!round.scheduledStart || round.scheduledStart > new Date()) throw new Error('Only a past scheduled round can be manually classified.');
        const status = await tx.dataStatus.findUnique({ where: { seasonYear: params.data.year } });
        if (!status || params.data.round > status.throughRound) throw new Error('The round must be within the confirmed data range before manual entry.');
        if (params.data.session === 'SPRINT' && !round.isSprint) throw new Error('Sprint results can only be added to a Sprint weekend.');
        const entry = await tx.driverSeasonEntry.findFirst({ where: { seasonYear: params.data.year, driverId: params.data.driverId, validFromRound: { lte: params.data.round }, OR: [{ validToRound: null }, { validToRound: { gte: params.data.round } }] }, include: { team: true } });
        if (!entry) throw new Error('Driver is not an entrant for this event.');
        const entrantCount = await tx.driverSeasonEntry.count({ where: { seasonYear: params.data.year, validFromRound: { lte: params.data.round }, OR: [{ validToRound: null }, { validToRound: { gte: params.data.round } }] } });
        if (body.data.finishPosition > entrantCount || (body.data.gridPosition !== null && body.data.gridPosition > entrantCount)) throw new Error(`Positions must be within the ${entrantCount} event entrants.`);
        if (await tx.result.count({ where: { roundId: round.id, sessionType: params.data.session, finishPosition: body.data.finishPosition, driverId: { not: params.data.driverId } } })) throw new Error(`P${body.data.finishPosition} is already assigned in this classification.`);
        const beforeRow = await tx.result.findUnique({ where: { roundId_driverId_sessionType: { roundId: round.id, driverId: params.data.driverId, sessionType: params.data.session } } });
        const before = beforeRow ? resultSnapshot(beforeRow) : null;
        const existing = await tx.result.upsert({
          where: { roundId_driverId_sessionType: { roundId: round.id, driverId: params.data.driverId, sessionType: params.data.session } },
          create: { roundId: round.id, driverId: params.data.driverId, constructorId: entry.constructorId, sessionType: params.data.session, gridPosition: body.data.gridPosition, finishPosition: body.data.finishPosition, classified: true, status: body.data.status, points: 0, sourcePayload: { manualCorrection: { sourceUrl: body.data.sourceUrl, reason: body.data.reason } } },
          update: { constructorId: entry.constructorId, gridPosition: body.data.gridPosition, finishPosition: body.data.finishPosition, classified: true, status: body.data.status, sourcePayload: { manualCorrection: { sourceUrl: body.data.sourceUrl, reason: body.data.reason } } },
        });
        const rows = await tx.result.findMany({ where: { roundId: round.id, sessionType: params.data.session }, orderBy: { finishPosition: 'asc' } });
        const scores = scoreDeadHeats2026(rows.map((row) => row.finishPosition ?? 0), params.data.session);
        for (const [index, row] of rows.entries()) await tx.result.update({ where: { id: row.id }, data: { points: scores[index] ?? 0 } });
        await recalculateSeasonStandings(tx, params.data.year, status.throughRound);
        const updated = resultSnapshot({ ...existing, points: scores[rows.findIndex((row) => row.id === existing.id)] ?? existing.points });
        await addOverride(tx, { entityType: 'Result', entityId: existing.id, before, after: updated, reason: body.data.reason });
        await addAudit(tx, { action: before ? 'RESULT_CORRECTED' : 'RESULT_ENTERED', entityType: 'Result', entityId: existing.id, before, after: updated });
        return { resultId: existing.id, round: round.number, session: params.data.session, points: updated.points };
      });
      return reply.code(200).send({ data });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Manual result could not be stored.';
      const code = message === 'ROUND_NOT_FOUND' ? 404 : message.includes('already assigned') || message.includes('Positions must') || message.includes('only be added') || message.includes('Only a past') || message.includes('not an entrant') || message.includes('confirmed data range') ? 422 : 409;
      return reply.code(code).send({ error: { code: code === 404 ? 'ROUND_NOT_FOUND' : 'RESULT_REJECTED', message } });
    }
  });

  app.post('/api/v1/admin/seasons/:year/races/:round/qualifying', { preHandler: [requireAdminSession, requireAdminCsrf] }, async (request, reply) => {
    const params = z.object({ year: yearSchema, round: roundSchema }).safeParse(request.params);
    const body = z.object({ results: z.array(z.object({ driverId: z.string().min(1), position: z.number().int().min(1).max(40) })).min(1).max(40, 'At most 40 qualifying entries are accepted.'), reason: adminReasonSchema, sourceUrl: z.url() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: { code: 'INVALID_QUALIFYING', message: 'Provide qualifying entries, a source URL, and a reason.' } });
    if (new Set(body.data.results.map((row) => row.driverId)).size !== body.data.results.length || new Set(body.data.results.map((row) => row.position)).size !== body.data.results.length) return reply.code(422).send({ error: { code: 'INVALID_QUALIFYING', message: 'Drivers and qualifying positions must be unique.' } });
    try {
      const result = await prisma.$transaction(async (tx) => {
        const round = await tx.round.findUnique({ where: { seasonYear_number: { seasonYear: params.data.year, number: params.data.round } } });
        if (!round || !round.scheduledStart || round.scheduledStart > new Date()) throw new Error('A past scheduled round is required.');
        const drivers = await tx.driverSeasonEntry.findMany({ where: { seasonYear: params.data.year, validFromRound: { lte: params.data.round }, OR: [{ validToRound: null }, { validToRound: { gte: params.data.round } }] }, select: { driverId: true } });
        if (body.data.results.some((row) => !drivers.some((entry) => entry.driverId === row.driverId) || row.position > drivers.length)) throw new Error(`Qualifying entries must use event drivers and positions from 1 to ${drivers.length}.`);
        const saved = [];
        for (const item of body.data.results) {
          const where = { roundId_driverId: { roundId: round.id, driverId: item.driverId } };
          const prior = await tx.qualifyingResult.findUnique({ where });
          const before = prior ? { ...prior } : null;
          const updated = await tx.qualifyingResult.upsert({ where, create: { roundId: round.id, driverId: item.driverId, position: item.position, sourcePayload: { manualCorrection: { sourceUrl: body.data.sourceUrl, reason: body.data.reason } } }, update: { position: item.position, sourcePayload: { manualCorrection: { sourceUrl: body.data.sourceUrl, reason: body.data.reason } } } });
          await addOverride(tx, { entityType: 'QualifyingResult', entityId: updated.id, before, after: updated, reason: body.data.reason });
          await addAudit(tx, { action: before ? 'QUALIFYING_CORRECTED' : 'QUALIFYING_ENTERED', entityType: 'QualifyingResult', entityId: updated.id, before, after: updated });
          saved.push(updated.id);
        }
        return { round: round.number, saved: saved.length };
      });
      return { data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Qualifying data could not be stored.';
      return reply.code(message.includes('past scheduled') ? 422 : 422).send({ error: { code: 'QUALIFYING_REJECTED', message } });
    }
  });

  app.post('/api/v1/admin/seasons/:year/races/:round/recaps', { preHandler: [requireAdminSession, requireAdminCsrf] }, async (request, reply) => {
    const params = z.object({ year: yearSchema, round: roundSchema }).safeParse(request.params);
    const body = z.object({ kind: z.enum(['FACT', 'INTERPRETATION']), category: z.string().trim().min(2).max(60), body: z.string().trim().min(10).max(1400), sourceUrl: z.url(), sourceLabel: z.string().trim().min(2).max(100), reason: adminReasonSchema }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: { code: 'INVALID_RECAP', message: 'Recap entries require a type, category, body, source, and editorial reason.' } });
    try {
      const entry = await prisma.$transaction(async (tx) => {
        const round = await tx.round.findUnique({ where: { seasonYear_number: { seasonYear: params.data.year, number: params.data.round } } });
        if (!round || !round.scheduledStart || round.scheduledStart > new Date()) throw new Error('A past scheduled round is required.');
        const saved = await tx.recapEntry.create({ data: { roundId: round.id, kind: body.data.kind, category: body.data.category, body: body.data.body, sourceUrl: body.data.sourceUrl, sourceLabel: body.data.sourceLabel } });
        await addOverride(tx, { entityType: 'RecapEntry', entityId: saved.id, before: null, after: saved, reason: body.data.reason });
        await addAudit(tx, { action: 'RECAP_ENTERED', entityType: 'RecapEntry', entityId: saved.id, after: saved });
        return saved;
      });
      return reply.code(201).send({ data: { id: entry.id, kind: entry.kind, category: entry.category } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recap entry could not be stored.';
      return reply.code(message.includes('past scheduled') ? 422 : 404).send({ error: { code: 'RECAP_REJECTED', message } });
    }
  });

  app.post('/api/v1/admin/overrides/:id/revert', { preHandler: [requireAdminSession, requireAdminCsrf] }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const body = z.object({ reason: adminReasonSchema }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: { code: 'INVALID_ROLLBACK', message: 'A rollback reason of at least 10 characters is required.' } });
    try {
      const output = await prisma.$transaction(async (tx) => {
        const override = await tx.manualOverride.findUnique({ where: { id: params.data.id } });
        if (!override) throw new Error('OVERRIDE_NOT_FOUND');
        if (override.revertedAt) throw new Error('OVERRIDE_ALREADY_REVERTED');
        const beforeJson = override.previousValue as { record?: unknown } | null;
        const afterJson = override.overrideValue as { record?: unknown };
        const prior = beforeJson?.record ?? null;
        const current = afterJson.record;
        if (override.entityType === 'Result') {
          const result = await tx.result.findUnique({ where: { id: override.entityId }, include: { round: true } });
          if (!result || JSON.stringify(resultSnapshot(result)) !== JSON.stringify(current)) throw new Error('OVERRIDE_CONFLICT');
          const before = resultSnapshot(result);
          if (prior === null) await tx.result.delete({ where: { id: result.id } });
          else await tx.result.update({ where: { id: result.id }, data: prior as Prisma.ResultUncheckedUpdateInput });
          const status = await tx.dataStatus.findUnique({ where: { seasonYear: result.round.seasonYear } });
          if (status?.throughRound) await recalculateSeasonStandings(tx, result.round.seasonYear, status.throughRound);
          await tx.manualOverride.update({ where: { id: override.id }, data: { revertedAt: new Date() } });
          await addAudit(tx, { action: 'MANUAL_OVERRIDE_REVERTED', entityType: override.entityType, entityId: override.entityId, before, after: prior });
          return { entityType: override.entityType, entityId: override.entityId };
        }
        if (override.entityType === 'QualifyingResult') {
          const row = await tx.qualifyingResult.findUnique({ where: { id: override.entityId } });
          if (!row || JSON.stringify(row) !== JSON.stringify(current)) throw new Error('OVERRIDE_CONFLICT');
          const before = { ...row };
          if (prior === null) await tx.qualifyingResult.delete({ where: { id: row.id } });
          else await tx.qualifyingResult.update({ where: { id: row.id }, data: prior as Prisma.QualifyingResultUncheckedUpdateInput });
          await tx.manualOverride.update({ where: { id: override.id }, data: { revertedAt: new Date() } });
          await addAudit(tx, { action: 'MANUAL_OVERRIDE_REVERTED', entityType: override.entityType, entityId: override.entityId, before, after: prior });
          return { entityType: override.entityType, entityId: override.entityId };
        }
        if (override.entityType === 'RecapEntry') {
          const row = await tx.recapEntry.findUnique({ where: { id: override.entityId } });
          if (!row || JSON.stringify(row) !== JSON.stringify(current)) throw new Error('OVERRIDE_CONFLICT');
          const before = { ...row };
          if (prior === null) await tx.recapEntry.delete({ where: { id: row.id } });
          else await tx.recapEntry.update({ where: { id: row.id }, data: prior as Prisma.RecapEntryUncheckedUpdateInput });
          await tx.manualOverride.update({ where: { id: override.id }, data: { revertedAt: new Date() } });
          await addAudit(tx, { action: 'MANUAL_OVERRIDE_REVERTED', entityType: override.entityType, entityId: override.entityId, before, after: prior });
          return { entityType: override.entityType, entityId: override.entityId };
        }
        throw new Error('OVERRIDE_TYPE_UNSUPPORTED');
      });
      return { data: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rollback failed.';
      const statusCode = message === 'OVERRIDE_NOT_FOUND' ? 404 : message.includes('CONFLICT') || message.includes('ALREADY') ? 409 : 422;
      return reply.code(statusCode).send({ error: { code: message, message: message === 'OVERRIDE_CONFLICT' ? 'This record changed after the override. Refresh audit history before retrying.' : message } });
    }
  });
}
