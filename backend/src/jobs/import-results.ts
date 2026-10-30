import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { JolpicaResultsProvider, type ImportedResult } from '../providers/jolpica-results.js';
import { scoreDeadHeats2026, type SessionType } from '../scoring/season-2026.js';

const prisma = new PrismaClient();
const season = z.coerce.number().int().min(1950).max(2100).parse(process.argv.slice(2).filter((arg) => arg !== '--')[0]);
const provider = new JolpicaResultsProvider(env.DATA_PROVIDER_URL);
type SessionRows = Map<number, ImportedResult[]>;

function groupByRound(rows: ImportedResult[]): SessionRows {
  const grouped: SessionRows = new Map();
  for (const row of rows) grouped.set(row.round, [...(grouped.get(row.round) ?? []), row]);
  return grouped;
}

function validateSession(rows: ImportedResult[], session: SessionType) {
  const driverIds = rows.map((row) => row.driver.sourceId);
  if (new Set(driverIds).size !== driverIds.length) throw new Error(`Duplicate driver in ${session.toLowerCase()} classification for round ${rows[0]?.round}.`);
  const expectedPoints = scoreDeadHeats2026(rows.map((row) => row.position), session);
  for (const [index, row] of rows.entries()) {
    if (Math.abs(expectedPoints[index]! - row.providerPoints) > 0.001) {
      throw new Error(`Scoring mismatch in ${session.toLowerCase()} round ${row.round} for ${row.driver.givenName} ${row.driver.familyName}; no unverified points were stored.`);
    }
  }
}

function standingsFor<T extends { id: string; name: string }>(
  entities: Map<string, T>,
  results: Array<{ entityId: string; position: number | null; points: number; sessionType: string }>,
) {
  const counts = new Map<string, Map<number, number>>();
  const totals = new Map<string, number>();
  const wins = new Map<string, number>();
  for (const result of results) {
    totals.set(result.entityId, (totals.get(result.entityId) ?? 0) + result.points);
    if (result.position !== null && result.sessionType === 'RACE') {
      const positions = counts.get(result.entityId) ?? new Map<number, number>();
      positions.set(result.position, (positions.get(result.position) ?? 0) + 1);
      counts.set(result.entityId, positions);
      if (result.position === 1) wins.set(result.entityId, (wins.get(result.entityId) ?? 0) + 1);
    }
  }
  const rows = [...entities.values()].map((entity) => ({
    entity,
    points: totals.get(entity.id) ?? 0,
    wins: wins.get(entity.id) ?? 0,
    counts: counts.get(entity.id) ?? new Map<number, number>(),
  }));
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || Array.from({ length: 25 }, (_, i) => i + 2).reduce((order, position) => order || (b.counts.get(position) ?? 0) - (a.counts.get(position) ?? 0), 0) || a.entity.name.localeCompare(b.entity.name));
  let previous: typeof rows[number] | undefined;
  let rank = 0;
  return rows.map((row, index) => {
    const sameSportingResult = previous && previous.points === row.points && previous.wins === row.wins && Array.from({ length: 25 }, (_, i) => i + 2).every((position) => (previous?.counts.get(position) ?? 0) === (row.counts.get(position) ?? 0));
    if (!sameSportingResult) rank = index + 1;
    previous = row;
    return { ...row, rank };
  });
}

async function importResults() {
  if (season !== 2026) throw new Error('Only the 2026 ruleset has been encoded. Historical result imports are disabled until their rules are verified.');
  const schedule = await prisma.round.findMany({ where: { seasonYear: season }, orderBy: { number: 'asc' } });
  if (!schedule.length) throw new Error(`Import the ${season} schedule before importing results.`);
  const [races, sprints] = await Promise.all([provider.getResults(season, 'RACE'), provider.getResults(season, 'SPRINT')]);
  const raceGroups = groupByRound(races);
  const sprintGroups = groupByRound(sprints);
  if (!raceGroups.size) throw new Error(`No confirmed ${season} race results were returned.`);
  const throughRound = Math.max(...raceGroups.keys());
  const latestExpectedCompleteRound = schedule
    .filter((item) => item.scheduledStart && item.scheduledStart.getTime() < Date.now() - 6 * 60 * 60 * 1000)
    .reduce((latest, item) => Math.max(latest, item.number), 0);
  const scheduleGap = latestExpectedCompleteRound > throughRound;
  const statusMessage = scheduleGap ? `The provider is missing results for one or more scheduled rounds through round ${latestExpectedCompleteRound}.` : null;
  for (let round = 1; round <= throughRound; round += 1) {
    const rows = raceGroups.get(round);
    if (!rows?.length) throw new Error(`Round ${round} is missing before the latest result; standings were left unchanged.`);
    if (!schedule.some((item) => item.number === round)) throw new Error(`Provider returned an unknown round ${round}; standings were left unchanged.`);
    validateSession(rows, 'RACE');
    const scheduled = schedule.find((item) => item.number === round)!;
    if (scheduled.isSprint) {
      const sprintRows = sprintGroups.get(round);
      if (!sprintRows?.length) throw new Error(`Sprint results are missing for sprint weekend ${round}; standings were left unchanged.`);
      validateSession(sprintRows, 'SPRINT');
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const [roundNumber, rows] of raceGroups) await storeSession(tx, season, roundNumber, rows, 'RACE');
    for (const [roundNumber, rows] of sprintGroups) await storeSession(tx, season, roundNumber, rows, 'SPRINT');

    const drivers = await tx.driver.findMany({ where: { entries: { some: { seasonYear: season } } } });
    const teams = await tx.constructor.findMany({ where: { entries: { some: { seasonYear: season } } } });
    for (let round = 1; round <= throughRound; round += 1) {
      const results = await tx.result.findMany({ where: { round: { seasonYear: season, number: { lte: round } } } });
      const driverRows = standingsFor(new Map(drivers.map((driver) => [driver.id, { id: driver.id, name: driver.displayName }])), results.map((result) => ({ entityId: result.driverId, position: result.finishPosition, points: result.points, sessionType: result.sessionType })));
      const teamRows = standingsFor(new Map(teams.map((team) => [team.id, { id: team.id, name: team.name }])), results.map((result) => ({ entityId: result.constructorId, position: result.finishPosition, points: result.points, sessionType: result.sessionType })));
      if (new Set(driverRows.map((row) => row.rank)).size !== driverRows.length || new Set(teamRows.map((row) => row.rank)).size !== teamRows.length) {
        throw new Error(`Championship tie-break data is incomplete after round ${round}; qualifying results are needed before standings can be confirmed.`);
      }
      await tx.driverStanding.deleteMany({ where: { seasonYear: season, throughRound: round } });
      await tx.constructorStanding.deleteMany({ where: { seasonYear: season, throughRound: round } });
      for (const row of driverRows) await tx.driverStanding.create({ data: { seasonYear: season, throughRound: round, driverId: row.entity.id, position: row.rank, points: row.points, wins: row.wins, podiums: (row.counts.get(2) ?? 0) + (row.counts.get(3) ?? 0) + (row.counts.get(1) ?? 0) } });
      for (const row of teamRows) await tx.constructorStanding.create({ data: { seasonYear: season, throughRound: round, constructorId: row.entity.id, position: row.rank, points: row.points, wins: row.wins } });
    }
    await tx.scoringRuleSet.upsert({
      where: { seasonYear_version: { seasonYear: season, version: '2026-FIA-A-ISS02' } },
      create: { seasonYear: season, version: '2026-FIA-A-ISS02', effectiveFrom: new Date('2026-02-27T00:00:00.000Z'), sourceUrl: 'https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_a_general_provisions_-_iss_02_-_2026-02-27.pdf', sourceArticle: 'A2.2', racePoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprintPoints: [8, 7, 6, 5, 4, 3, 2, 1], fastestLapRule: { points: 0 }, reducedRaceRules: { supported: false, reason: 'Requires race-distance completion data not provided by this adapter.' }, sprintDistanceRule: { minimumCompletedPercent: 50, minimumConsecutiveLapsWithoutSafetyCar: 2 }, tieBreakRules: ['race-wins', 'race-second-places-onward', 'qualifying-results'] },
      update: {},
    });
    await tx.dataStatus.upsert({
      where: { seasonYear: season },
      create: { seasonYear: season, throughRound, provider: provider.name, stale: scheduleGap, updatedAt: new Date(), lastAttemptAt: new Date(), lastError: statusMessage },
      update: { throughRound, provider: provider.name, stale: scheduleGap, updatedAt: new Date(), lastAttemptAt: new Date(), lastError: statusMessage },
    });
  });
  console.log(`Imported and recalculated verified results through round ${throughRound} of ${season}.`);
}

async function storeSession(tx: Prisma.TransactionClient, year: number, roundNumber: number, rows: ImportedResult[], session: SessionType) {
  if (!rows.length) return;
  const round = await tx.round.findUnique({ where: { seasonYear_number: { seasonYear: year, number: roundNumber } } });
  if (!round) throw new Error(`Missing local schedule row ${roundNumber}.`);
  const points = scoreDeadHeats2026(rows.map((row) => row.position), session);
  for (const [index, row] of rows.entries()) {
    const driver = await tx.driver.upsert({ where: { sourceId: row.driver.sourceId }, create: { sourceId: row.driver.sourceId, givenName: row.driver.givenName, familyName: row.driver.familyName, displayName: `${row.driver.givenName} ${row.driver.familyName}`.trim(), nationality: row.driver.nationality }, update: { givenName: row.driver.givenName, familyName: row.driver.familyName, displayName: `${row.driver.givenName} ${row.driver.familyName}`.trim(), nationality: row.driver.nationality } });
    const team = await tx.constructor.upsert({ where: { sourceId: row.team.sourceId }, create: { sourceId: row.team.sourceId, name: row.team.name, nationality: row.team.nationality }, update: { name: row.team.name, nationality: row.team.nationality } });
    const existing = await tx.driverSeasonEntry.findFirst({ where: { seasonYear: year, driverId: driver.id, constructorId: team.id } });
    if (!existing) {
      const priorTeam = await tx.driverSeasonEntry.findFirst({ where: { seasonYear: year, driverId: driver.id, validToRound: null } });
      if (priorTeam && priorTeam.constructorId !== team.id) await tx.driverSeasonEntry.update({ where: { id: priorTeam.id }, data: { validToRound: roundNumber - 1 } });
      await tx.driverSeasonEntry.create({ data: { seasonYear: year, driverId: driver.id, constructorId: team.id, racingNumber: row.driver.number, validFromRound: roundNumber } });
    }
    await tx.result.upsert({
      where: { roundId_driverId_sessionType: { roundId: round.id, driverId: driver.id, sessionType: session } },
      create: { roundId: round.id, driverId: driver.id, constructorId: team.id, sessionType: session, gridPosition: row.grid, finishPosition: row.position, classified: true, status: row.status, timeMillis: row.timeMillis, laps: row.laps, points: points[index] ?? 0 },
      update: { constructorId: team.id, gridPosition: row.grid, finishPosition: row.position, classified: true, status: row.status, timeMillis: row.timeMillis, laps: row.laps, points: points[index] ?? 0 },
    });
  }
}

importResults().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Result import failed.';
  console.error(message);
  try { await prisma.dataStatus.upsert({ where: { seasonYear: season }, create: { seasonYear: season, provider: provider.name, stale: true, lastAttemptAt: new Date(), lastError: message }, update: { stale: true, lastAttemptAt: new Date(), lastError: message } }); } catch { /* Keep the last good data if the status store is unavailable. */ }
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
