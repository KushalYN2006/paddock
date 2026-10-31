export function validateRaceCoverage(raceGroups: Map<number, unknown[]>, scheduledRounds: ReadonlySet<number>) {
  if (!raceGroups.size) throw new Error('No confirmed race results were returned.');
  const throughRound = Math.max(...raceGroups.keys());
  for (const round of raceGroups.keys()) {
    if (!scheduledRounds.has(round)) throw new Error(`Provider returned an unknown round ${round}; standings were left unchanged.`);
  }
  for (let round = 1; round <= throughRound; round += 1) {
    if (!raceGroups.get(round)?.length) throw new Error(`Round ${round} is missing before the latest result; standings were left unchanged.`);
  }
  return throughRound;
}
