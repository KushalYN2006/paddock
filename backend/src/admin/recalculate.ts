import type { Prisma } from '@prisma/client';
import { rankStandings } from '../scoring/standings.js';

export interface StandingAccumulator { entityId: string; name: string; points: number; wins: number; placeCounts: Map<number, number>; qualifyingPlaces?: Map<number, number>; }

export function rankStandingRows(rows: StandingAccumulator[]) {
  return rankStandings(rows.map((row) => ({ entityId: row.entityId, name: row.name, points: row.points, wins: row.wins, racePlaces: row.placeCounts, qualifyingPlaces: row.qualifyingPlaces ?? new Map() })))
    .map((row) => ({ ...rows.find((item) => item.entityId === row.entityId)!, position: row.rank }));
}

export async function recalculateSeasonStandings(tx: Prisma.TransactionClient, seasonYear: number, throughRound: number) {
  const [drivers, teams, results, qualifying] = await Promise.all([
    tx.driver.findMany({ where: { entries: { some: { seasonYear } } } }),
    tx.constructor.findMany({ where: { entries: { some: { seasonYear } } } }),
    tx.result.findMany({ where: { round: { seasonYear, number: { lte: throughRound } } }, orderBy: [{ roundId: 'asc' }, { sessionType: 'asc' }, { finishPosition: 'asc' }], include: { round: true } }),
    tx.qualifyingResult.findMany({ where: { round: { seasonYear, number: { lte: throughRound } } }, include: { round: true, driver: { include: { entries: { where: { seasonYear } } } } } }),
  ]);
  await tx.driverStanding.deleteMany({ where: { seasonYear, throughRound: { lte: throughRound } } });
  await tx.constructorStanding.deleteMany({ where: { seasonYear, throughRound: { lte: throughRound } } });
  for (let round = 1; round <= throughRound; round += 1) {
    const resultsThroughRound = results.filter((result) => result.roundId && result.round && result.round.seasonYear === seasonYear);
    const driverQualifying = new Map<string, Map<number, number>>();
    const teamQualifying = new Map<string, Map<number, number>>();
    for (const item of qualifying.filter((row) => row.round.number <= round && row.position !== null)) {
      const driverPlaces = driverQualifying.get(item.driverId) ?? new Map<number, number>();
      driverPlaces.set(item.position!, (driverPlaces.get(item.position!) ?? 0) + 1);
      driverQualifying.set(item.driverId, driverPlaces);
      const entry = item.driver.entries.find((candidate) => (candidate.validFromRound ?? 1) <= item.round.number && (candidate.validToRound === null || candidate.validToRound >= item.round.number));
      if (entry) {
        const teamPlaces = teamQualifying.get(entry.constructorId) ?? new Map<number, number>();
        teamPlaces.set(item.position!, (teamPlaces.get(item.position!) ?? 0) + 1);
        teamQualifying.set(entry.constructorId, teamPlaces);
      }
    }
    const driverInputs = drivers.map((driver) => {
      const rows = resultsThroughRound.filter((result) => result.driverId === driver.id && result.round.number <= round);
      const raceRows = rows.filter((result) => result.sessionType === 'RACE' && result.finishPosition !== null);
      return { entityId: driver.id, name: driver.displayName, points: rows.reduce((sum, result) => sum + result.points, 0), wins: raceRows.filter((result) => result.finishPosition === 1).length, placeCounts: countPlaces(raceRows), qualifyingPlaces: driverQualifying.get(driver.id) };
    });
    const teamInputs = teams.map((team) => {
      const rows = resultsThroughRound.filter((result) => result.constructorId === team.id && result.round.number <= round);
      const raceRows = rows.filter((result) => result.sessionType === 'RACE' && result.finishPosition !== null);
      return { entityId: team.id, name: team.name, points: rows.reduce((sum, result) => sum + result.points, 0), wins: raceRows.filter((result) => result.finishPosition === 1).length, placeCounts: countPlaces(raceRows), qualifyingPlaces: teamQualifying.get(team.id) };
    });
    const driverRows = rankStandingRows(driverInputs);
    const teamRows = rankStandingRows(teamInputs);
    for (const row of driverRows) await tx.driverStanding.create({ data: { seasonYear, throughRound: round, driverId: row.entityId, position: row.position, points: row.points, wins: row.wins, podiums: (row.placeCounts.get(1) ?? 0) + (row.placeCounts.get(2) ?? 0) + (row.placeCounts.get(3) ?? 0) } });
    for (const row of teamRows) await tx.constructorStanding.create({ data: { seasonYear, throughRound: round, constructorId: row.entityId, position: row.position, points: row.points, wins: row.wins } });
  }
}

function countPlaces(results: Array<{ finishPosition: number | null }>) {
  const counts = new Map<number, number>();
  for (const result of results) if (result.finishPosition !== null) counts.set(result.finishPosition, (counts.get(result.finishPosition) ?? 0) + 1);
  return counts;
}
