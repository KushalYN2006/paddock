export interface RaceAnalysisResult {
  driverId: string;
  driver: string;
  teamId: string;
  team: string;
  gridPosition: number | null;
  finishPosition: number | null;
  status: string | null;
}
export interface RaceAnalysisQualifying { driverId: string; driver: string; position: number | null; }

export function buildRaceRecapFacts(results: Array<{ driver: string; position: number | null; gridPosition: number | null }>, reviewedEntries: Array<{ kind: 'FACT' | 'INTERPRETATION'; category: string; body: string; sourceUrl: string; sourceLabel: string | null }>) {
  const sourceUrl = 'https://github.com/jolpica/jolpica-f1';
  const classified = results.filter((row) => row.position !== null).sort((a, b) => a.position! - b.position!);
  const facts: Array<{ kind: 'FACT'; category: string; body: string; sourceUrl: string; sourceLabel: string }> = [];
  const winner = classified.find((row) => row.position === 1);
  if (winner) facts.push({ kind: 'FACT', category: 'WINNER', body: `${winner.driver} won the Grand Prix classification.`, sourceUrl, sourceLabel: 'Jolpica-F1 classification data' });
  const podium = classified.filter((row) => row.position! <= 3);
  if (podium.length === 3) facts.push({ kind: 'FACT', category: 'PODIUM', body: `The classified top three were ${podium.map((row, index) => `P${index + 1} ${row.driver}`).join(', ')}.`, sourceUrl, sourceLabel: 'Jolpica-F1 classification data' });
  const advances = classified.flatMap((row) => row.gridPosition !== null ? [{ driver: row.driver, change: row.gridPosition - row.position! }] : []).filter((row) => row.change > 0);
  const biggestGain = Math.max(0, ...advances.map((row) => row.change));
  if (biggestGain > 0) {
    const names = advances.filter((row) => row.change === biggestGain).map((row) => row.driver);
    const joinedNames = names.length < 2 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    facts.push({ kind: 'FACT', category: 'POSITIONS GAINED', body: `${joinedNames} gained the most places from grid to finish: ${biggestGain}.`, sourceUrl, sourceLabel: 'Jolpica-F1 classification data; grid-to-finish calculation' });
  }
  const entries = [...facts, ...reviewedEntries];
  return { available: entries.length > 0, narrativeAvailable: reviewedEntries.length > 0, unsupportedEntryCount: 0, entries };
}

export function deriveRaceAnalysis(results: RaceAnalysisResult[], qualifying: RaceAnalysisQualifying[], pitStopData: { recordCount: number; verified: boolean }) {
  const classified = results.filter((row) => row.finishPosition !== null);
  const positions = results.map((row) => {
    const change = row.gridPosition !== null && row.finishPosition !== null ? row.gridPosition - row.finishPosition : null;
    return { driverId: row.driverId, driver: row.driver, gridPosition: row.gridPosition, finishPosition: row.finishPosition, positionsChange: change, label: change === null ? 'Unavailable' : change > 0 ? `Gained ${change}` : change < 0 ? `Lost ${Math.abs(change)}` : 'No change' };
  });
  const resultByDriver = new Map(results.map((row) => [row.driverId, row]));
  const qualifyingVsRace = qualifying.flatMap((row) => {
    const result = resultByDriver.get(row.driverId);
    return row.position !== null && result?.finishPosition !== null && result ? [{ driverId: row.driverId, driver: row.driver, qualifyingPosition: row.position, finishPosition: result.finishPosition, positionsChange: row.position - result.finishPosition }] : [];
  });
  const byTeam = new Map<string, RaceAnalysisResult[]>();
  for (const row of classified) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), row]);
  const teammateBattles = [...byTeam.values()].filter((rows) => rows.length === 2).map(([first, second]) => ({
    team: first!.team,
    driverA: first!.driver,
    driverB: second!.driver,
    finishA: first!.finishPosition,
    finishB: second!.finishPosition,
    outcome: first!.finishPosition === second!.finishPosition ? 'TIED' : (first!.finishPosition ?? Infinity) < (second!.finishPosition ?? Infinity) ? 'DRIVER_A_AHEAD' : 'DRIVER_B_AHEAD',
  }));
  return {
    positions: { available: positions.length > 0, method: 'Starting grid position minus classified finishing position; a positive value means places gained.', rows: positions },
    qualifyingVsRace: { available: qualifyingVsRace.length > 0, reason: qualifyingVsRace.length ? null : 'Verified qualifying classifications are not stored for this event.', rows: qualifyingVsRace },
    teammateBattles: { available: teammateBattles.length > 0, method: 'Head-to-head is counted only when both teammates have a classified finishing position in this event; tied positions are shown as ties.', rows: teammateBattles },
    pitStops: { available: pitStopData.verified && pitStopData.recordCount > 0, reason: pitStopData.verified && pitStopData.recordCount > 0 ? null : 'Pit-stop records are not yet imported and validated for this event.', recordCount: pitStopData.recordCount },
    sourceCoverage: { raceClassificationRows: results.length, classifiedRows: classified.length, qualifyingRows: qualifying.length, pitStopRecords: pitStopData.recordCount },
  };
}
