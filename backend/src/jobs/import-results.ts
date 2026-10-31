import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { JolpicaResultsProvider, type ImportedQualifyingResult, type ImportedResult } from '../providers/jolpica-results.js';
import { scoreDeadHeats2026, type SessionType } from '../scoring/season-2026.js';
import { rankStandings, type StandingCandidate } from '../scoring/standings.js';
import { planEntryTransition } from './driver-entry-timeline.js';
import { validateRaceCoverage } from './import-validation.js';

const prisma = new PrismaClient();
const season = z.coerce.number().int().min(1950).max(2100).parse(process.argv.slice(2).filter((arg) => arg !== '--')[0]);
const provider = new JolpicaResultsProvider(env.DATA_PROVIDER_URL);
type SessionRows = Map<number, ImportedResult[]>;

function groupByRound(rows: ImportedResult[]): SessionRows {
  const grouped: SessionRows = new Map();
  for (const row of rows) grouped.set(row.round, [...(grouped.get(row.round) ?? []), row]);
  return grouped;
}

function groupQualifyingByRound(rows: ImportedQualifyingResult[]) {
  const grouped = new Map<number, ImportedQualifyingResult[]>();
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
  qualifyingPlaces: Map<string, Map<number, number>>,
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
  const rows: StandingCandidate[] = [...entities.values()].map((entity) => ({
    entityId: entity.id,
    name: entity.name,
    points: totals.get(entity.id) ?? 0,
    wins: wins.get(entity.id) ?? 0,
    racePlaces: counts.get(entity.id) ?? new Map<number, number>(),
    qualifyingPlaces: qualifyingPlaces.get(entity.id) ?? new Map<number, number>(),
  }));
  return rankStandings(rows).map((row) => ({ ...row, entity: entities.get(row.entityId)! }));
}

async function importResults() {
  if (season !== 2026) throw new Error('Only the 2026 ruleset has been encoded. Historical result imports are disabled until their rules are verified.');
  const schedule = await prisma.round.findMany({ where: { seasonYear: season }, orderBy: { number: 'asc' } });
  if (!schedule.length) throw new Error(`Import the ${season} schedule before importing results.`);
  const qualifying = await provider.getQualifyingResults(season);
  if (!qualifying.length) throw new Error('No qualifying classifications were returned; roster and standings were left unchanged.');
  const scheduledRoundIds = new Set(schedule.map((round) => round.number));
  const qualifyingByRound = groupQualifyingByRound(qualifying);
  for (const [round, rows] of qualifyingByRound) {
    if (!scheduledRoundIds.has(round)) throw new Error(`Provider returned qualifying for unknown round ${round}.`);
    if (new Set(rows.map((row) => row.driver.sourceId)).size !== rows.length || new Set(rows.map((row) => row.position)).size !== rows.length) throw new Error(`Invalid qualifying classification for round ${round}.`);
  }
  if (qualifying.length) await prisma.$transaction(async (tx) => {
    for (const row of qualifying) await storeQualifying(tx, season, row);
  });

  const races = await provider.getResults(season, 'RACE');
  const sprints = await provider.getResults(season, 'SPRINT');
  const raceGroups = groupByRound(races);
  const sprintGroups = groupByRound(sprints);
  const throughRound = validateRaceCoverage(raceGroups, new Set(schedule.map((round) => round.number)));
  const latestExpectedCompleteRound = schedule
    .filter((item) => item.scheduledStart && item.scheduledStart.getTime() < Date.now() - 6 * 60 * 60 * 1000)
    .reduce((latest, item) => Math.max(latest, item.number), 0);
  const scheduleGap = latestExpectedCompleteRound > throughRound;
  const statusMessage = scheduleGap ? `The provider is missing results for one or more scheduled rounds through round ${latestExpectedCompleteRound}.` : null;
  for (let round = 1; round <= throughRound; round += 1) {
    const rows = raceGroups.get(round)!;
    validateSession(rows, 'RACE');
    const qualifyingRows = qualifyingByRound.get(round) ?? [];
    if (!qualifyingRows.length) throw new Error(`Qualifying results are missing for round ${round}; standings were left unchanged.`);
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
      const [results, qualifyingRows] = await Promise.all([
        tx.result.findMany({ where: { round: { seasonYear: season, number: { lte: round } } }, include: { round: true } }),
        tx.qualifyingResult.findMany({ where: { round: { seasonYear: season, number: { lte: round } } }, include: { round: true, driver: { include: { entries: { where: { seasonYear: season } } } } } }),
      ]);
      const driverQualifying = new Map<string, Map<number, number>>();
      const teamQualifying = new Map<string, Map<number, number>>();
      for (const item of qualifyingRows) {
        if (item.position === null) continue;
        const driverPlaces = driverQualifying.get(item.driverId) ?? new Map<number, number>();
        driverPlaces.set(item.position, (driverPlaces.get(item.position) ?? 0) + 1);
        driverQualifying.set(item.driverId, driverPlaces);
        const entry = item.driver.entries.find((candidate) => (candidate.validFromRound ?? 1) <= item.round.number && (candidate.validToRound === null || candidate.validToRound >= item.round.number));
        if (entry) {
          const teamPlaces = teamQualifying.get(entry.constructorId) ?? new Map<number, number>();
          teamPlaces.set(item.position, (teamPlaces.get(item.position) ?? 0) + 1);
          teamQualifying.set(entry.constructorId, teamPlaces);
        }
      }
      const driverEntities = new Map(drivers.map((driver) => [driver.id, { id: driver.id, name: driver.displayName }]));
      const teamEntities = new Map(teams.map((team) => [team.id, { id: team.id, name: team.name }]));
      const driverRows = standingsFor(driverEntities, results.map((result) => ({ entityId: result.driverId, position: result.finishPosition, points: result.points, sessionType: result.sessionType })), driverQualifying);
      const teamRows = standingsFor(teamEntities, results.map((result) => ({ entityId: result.constructorId, position: result.finishPosition, points: result.points, sessionType: result.sessionType })), teamQualifying);
      await tx.driverStanding.deleteMany({ where: { seasonYear: season, throughRound: round } });
      await tx.constructorStanding.deleteMany({ where: { seasonYear: season, throughRound: round } });
      for (const row of driverRows) await tx.driverStanding.create({ data: { seasonYear: season, throughRound: round, driverId: row.entity.id, position: row.rank, points: row.points, wins: row.wins, podiums: (row.racePlaces.get(1) ?? 0) + (row.racePlaces.get(2) ?? 0) + (row.racePlaces.get(3) ?? 0) } });
      for (const row of teamRows) await tx.constructorStanding.create({ data: { seasonYear: season, throughRound: round, constructorId: row.entity.id, position: row.rank, points: row.points, wins: row.wins } });
    }
    await tx.scoringRuleSet.upsert({
      where: { seasonYear_version: { seasonYear: season, version: '2026-FIA-A-ISS03' } },
      create: { seasonYear: season, version: '2026-FIA-A-ISS03', effectiveFrom: new Date('2026-06-25T00:00:00.000Z'), sourceUrl: 'https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_a_general_provisions_-_iss_03_-_2026-06-25.pdf', sourceArticle: 'A2.1.4(c), A2.2', racePoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprintPoints: [8, 7, 6, 5, 4, 3, 2, 1], fastestLapRule: { points: 0 }, reducedRaceRules: { supported: false, reason: 'Shortened-race point tables are not yet imported or validated; races using those tables are rejected by provider-points validation.' }, sprintDistanceRule: { minimumCompletedPercent: 50, minimumConsecutiveLapsWithoutSafetyCar: 2 }, tieBreakRules: ['race-wins', 'race-second-places-onward', 'qualifying-results-countback'] },
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
    const { driver, team } = await upsertEntry(tx, year, roundNumber, row.driver, row.team);
    await tx.result.upsert({
      where: { roundId_driverId_sessionType: { roundId: round.id, driverId: driver.id, sessionType: session } },
      create: { roundId: round.id, driverId: driver.id, constructorId: team.id, sessionType: session, gridPosition: row.grid, finishPosition: row.position, classified: row.position !== null, status: row.status, timeMillis: row.timeMillis, laps: row.laps, points: points[index] ?? 0 },
      update: { constructorId: team.id, gridPosition: row.grid, finishPosition: row.position, classified: row.position !== null, status: row.status, timeMillis: row.timeMillis, laps: row.laps, points: points[index] ?? 0 },
    });
  }
}

async function upsertEntry(tx: Prisma.TransactionClient, year: number, roundNumber: number, driverRow: ImportedResult['driver'], teamRow: ImportedResult['team']) {
  const driver = await tx.driver.upsert({ where: { sourceId: driverRow.sourceId }, create: { sourceId: driverRow.sourceId, givenName: driverRow.givenName, familyName: driverRow.familyName, displayName: `${driverRow.givenName} ${driverRow.familyName}`.trim(), nationality: driverRow.nationality }, update: { givenName: driverRow.givenName, familyName: driverRow.familyName, displayName: `${driverRow.givenName} ${driverRow.familyName}`.trim(), nationality: driverRow.nationality } });
  const team = await tx.constructor.upsert({ where: { sourceId: teamRow.sourceId }, create: { sourceId: teamRow.sourceId, name: teamRow.name, nationality: teamRow.nationality }, update: { name: teamRow.name, nationality: teamRow.nationality } });
  const entries = await tx.driverSeasonEntry.findMany({ where: { seasonYear: year, driverId: driver.id } });
  const transition = planEntryTransition(entries, roundNumber, team.id);
  if (transition.action === 'deduplicate') await tx.driverSeasonEntry.deleteMany({ where: { id: { in: transition.removeIds } } });
  if (transition.action === 'keep' || transition.action === 'deduplicate') {
    await tx.driverSeasonEntry.update({ where: { id: transition.entry.id }, data: { racingNumber: driverRow.number } });
    return { driver, team };
  }
  if (transition.closeEntryId) await tx.driverSeasonEntry.update({ where: { id: transition.closeEntryId }, data: { validToRound: roundNumber - 1 } });
  if (transition.action === 'extend') {
    await tx.driverSeasonEntry.update({ where: { id: transition.entry.id }, data: { validFromRound: roundNumber, racingNumber: driverRow.number } });
    return { driver, team };
  }
  await tx.driverSeasonEntry.create({ data: { seasonYear: year, driverId: driver.id, constructorId: team.id, racingNumber: driverRow.number, validFromRound: roundNumber, validToRound: transition.validToRound } });
  return { driver, team };
}

async function storeQualifying(tx: Prisma.TransactionClient, year: number, row: ImportedQualifyingResult) {
  const round = await tx.round.findUnique({ where: { seasonYear_number: { seasonYear: year, number: row.round } } });
  if (!round) throw new Error(`Qualifying refers to missing schedule round ${row.round}.`);
  const { driver } = await upsertEntry(tx, year, row.round, row.driver, row.team);
  await tx.qualifyingResult.upsert({
    where: { roundId_driverId: { roundId: round.id, driverId: driver.id } },
    create: { roundId: round.id, driverId: driver.id, position: row.position },
    update: { position: row.position },
  });
}

importResults().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Result import failed.';
  console.error(message);
  try { await prisma.dataStatus.upsert({ where: { seasonYear: season }, create: { seasonYear: season, provider: provider.name, stale: true, lastAttemptAt: new Date(), lastError: message }, update: { stale: true, lastAttemptAt: new Date(), lastError: message } }); } catch { /* Keep the last good data if the status store is unavailable. */ }
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
