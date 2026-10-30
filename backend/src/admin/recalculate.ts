import type { Prisma } from '@prisma/client';

export interface StandingAccumulator { entityId: string; name: string; points: number; wins: number; placeCounts: Map<number, number>; }

export function rankStandingRows(rows: StandingAccumulator[]) {
  const positions = Array.from({ length: 30 }, (_, index) => index + 2);
  const ordered = [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins || positions.reduce((difference, position) => difference || (b.placeCounts.get(position) ?? 0) - (a.placeCounts.get(position) ?? 0), 0));
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index]!; const prior = ordered[index - 1]!;
    const tied = current.points === prior.points && current.wins === prior.wins && positions.every((position) => (current.placeCounts.get(position) ?? 0) === (prior.placeCounts.get(position) ?? 0));
    if (tied) throw new Error(`The tie-break between ${prior.name} and ${current.name} needs verified qualifying data; no standings were changed.`);
  }
  return ordered.map((row, index) => ({ ...row, position: index + 1 }));
}

export async function recalculateSeasonStandings(tx: Prisma.TransactionClient, seasonYear: number, throughRound: number) {
  const [drivers, teams, results] = await Promise.all([
    tx.driver.findMany({ where: { entries: { some: { seasonYear } } } }),
    tx.constructor.findMany({ where: { entries: { some: { seasonYear } } } }),
    tx.result.findMany({ where: { round: { seasonYear, number: { lte: throughRound } } }, orderBy: [{ roundId: 'asc' }, { sessionType: 'asc' }, { finishPosition: 'asc' }], include: { round: true } }),
  ]);
  await tx.driverStanding.deleteMany({ where: { seasonYear, throughRound: { lte: throughRound } } });
  await tx.constructorStanding.deleteMany({ where: { seasonYear, throughRound: { lte: throughRound } } });
  for (let round = 1; round <= throughRound; round += 1) {
    const resultsThroughRound = results.filter((result) => result.roundId && result.round && result.round.seasonYear === seasonYear);
    const driverRows = rankStandingRows(drivers.map((driver) => {
      const rows = resultsThroughRound.filter((result) => result.driverId === driver.id && result.round.number <= round);
      const raceRows = rows.filter((result) => result.sessionType === 'RACE' && result.finishPosition !== null);
      return { entityId: driver.id, name: driver.displayName, points: rows.reduce((sum, result) => sum + result.points, 0), wins: raceRows.filter((result) => result.finishPosition === 1).length, placeCounts: countPlaces(raceRows) };
    }));
    const teamRows = rankStandingRows(teams.map((team) => {
      const rows = resultsThroughRound.filter((result) => result.constructorId === team.id && result.round.number <= round);
      const raceRows = rows.filter((result) => result.sessionType === 'RACE' && result.finishPosition !== null);
      return { entityId: team.id, name: team.name, points: rows.reduce((sum, result) => sum + result.points, 0), wins: raceRows.filter((result) => result.finishPosition === 1).length, placeCounts: countPlaces(raceRows) };
    }));
    for (const row of driverRows) await tx.driverStanding.create({ data: { seasonYear, throughRound: round, driverId: row.entityId, position: row.position, points: row.points, wins: row.wins, podiums: (row.placeCounts.get(1) ?? 0) + (row.placeCounts.get(2) ?? 0) + (row.placeCounts.get(3) ?? 0) } });
    for (const row of teamRows) await tx.constructorStanding.create({ data: { seasonYear, throughRound: round, constructorId: row.entityId, position: row.position, points: row.points, wins: row.wins } });
  }
}

function countPlaces(results: Array<{ finishPosition: number | null }>) {
  const counts = new Map<number, number>();
  for (const result of results) if (result.finishPosition !== null) counts.set(result.finishPosition, (counts.get(result.finishPosition) ?? 0) + 1);
  return counts;
}
