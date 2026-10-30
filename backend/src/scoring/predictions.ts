export interface PredictionDriverSnapshot { id: string; name: string; points: number; }
export interface PredictionSnapshot { round: number; drivers: PredictionDriverSnapshot[]; }
export interface CompletedPredictionSeason { season: number; rounds: PredictionSnapshot[]; }

export const predictionModelVersion = 'form-points-blend-v1';
export const predictionMinimumBacktestCases = 12;

function estimateAt(snapshots: PredictionSnapshot[], throughRound: number, finalRound: number) {
  const byRound = new Map(snapshots.map((snapshot) => [snapshot.round, snapshot]));
  const current = byRound.get(throughRound);
  if (!current) return [];
  return current.drivers.map((driver) => {
    const prior = byRound.get(throughRound - 1)?.drivers.find((row) => row.id === driver.id)?.points ?? 0;
    const currentRoundPoints = driver.points - prior;
    const recentDeltas = [currentRoundPoints];
    for (let offset = 2; offset <= 3; offset += 1) {
      const snapshot = byRound.get(throughRound - offset);
      const nextSnapshot = byRound.get(throughRound - offset + 1);
      if (!snapshot || !nextSnapshot) continue;
      const earlier = snapshot.drivers.find((row) => row.id === driver.id)?.points ?? 0;
      const later = nextSnapshot.drivers.find((row) => row.id === driver.id)?.points ?? 0;
      recentDeltas.push(later - earlier);
    }
    const seasonPace = driver.points / throughRound;
    const recentForm = recentDeltas.reduce((sum, points) => sum + points, 0) / recentDeltas.length;
    const blendedPace = seasonPace * 0.6 + recentForm * 0.4;
    const remaining = Math.max(0, finalRound - throughRound);
    return { ...driver, currentPoints: driver.points, projectedFinalPoints: Math.round((driver.points + blendedPace * remaining) * 10) / 10 };
  });
}

function leaders(rows: Array<{ id: string; projectedFinalPoints: number }>) {
  const max = Math.max(...rows.map((row) => row.projectedFinalPoints));
  return new Set(rows.filter((row) => row.projectedFinalPoints === max).map((row) => row.id));
}

export function backtestPredictionModel(seasons: CompletedPredictionSeason[]) {
  let cases = 0;
  let blendCorrect = 0;
  let pointsCorrect = 0;
  let blendAbsoluteError = 0;
  let pointsAbsoluteError = 0;
  let pointComparisons = 0;
  for (const season of seasons) {
    const rounds = [...season.rounds].sort((a, b) => a.round - b.round);
    const finalRound = rounds.at(-1)?.round ?? 0;
    const final = rounds.find((snapshot) => snapshot.round === finalRound);
    if (!final || finalRound < 5) continue;
    const finalLeaders = new Set(final.drivers.filter((driver) => driver.points === Math.max(...final.drivers.map((row) => row.points))).map((driver) => driver.id));
    for (let throughRound = 3; throughRound < finalRound; throughRound += 1) {
      const blended = estimateAt(rounds, throughRound, finalRound);
      const current = rounds.find((snapshot) => snapshot.round === throughRound);
      if (!current || !blended.length) continue;
      const expectedLeaders = leaders(blended);
      const pointOnly = current.drivers.map((driver) => ({ id: driver.id, projectedFinalPoints: driver.points + (driver.points / throughRound) * (finalRound - throughRound) }));
      const pointLeaders = leaders(pointOnly);
      if ([...expectedLeaders].some((id) => finalLeaders.has(id))) blendCorrect += 1;
      if ([...pointLeaders].some((id) => finalLeaders.has(id))) pointsCorrect += 1;
      for (const estimate of blended) {
        const actual = final.drivers.find((row) => row.id === estimate.id)?.points;
        if (actual !== undefined) {
          blendAbsoluteError += Math.abs(estimate.projectedFinalPoints - actual);
          const baseline = pointOnly.find((row) => row.id === estimate.id)!;
          pointsAbsoluteError += Math.abs(baseline.projectedFinalPoints - actual);
          pointComparisons += 1;
        }
      }
      cases += 1;
    }
  }
  const blendChampionAccuracy = cases ? blendCorrect / cases : null;
  const pointsChampionAccuracy = cases ? pointsCorrect / cases : null;
  const blendMae = pointComparisons ? blendAbsoluteError / pointComparisons : null;
  const pointsMae = pointComparisons ? pointsAbsoluteError / pointComparisons : null;
  return {
    modelVersion: predictionModelVersion,
    cases,
    blendChampionAccuracy,
    pointsChampionAccuracy,
    blendMeanAbsoluteError: blendMae,
    pointsMeanAbsoluteError: pointsMae,
    passed: cases >= predictionMinimumBacktestCases && blendChampionAccuracy !== null && pointsChampionAccuracy !== null && blendMae !== null && pointsMae !== null && blendChampionAccuracy >= pointsChampionAccuracy && blendMae <= pointsMae,
  };
}

export function buildPredictionEstimate(input: { season: number; throughRound: number; finalRound: number; unconfirmedPastRounds: number; history: PredictionSnapshot[]; backtest: ReturnType<typeof backtestPredictionModel> }) {
  const historyRounds = new Set(input.history.map((snapshot) => snapshot.round));
  const enoughCurrentForm = input.throughRound >= 3 && [input.throughRound, input.throughRound - 1, input.throughRound - 2].every((round) => historyRounds.has(round));
  const noPastGaps = input.unconfirmedPastRounds === 0;
  const available = enoughCurrentForm && noPastGaps && input.finalRound > input.throughRound && input.backtest.passed;
  const reason = !enoughCurrentForm
    ? 'At least three confirmed rounds are needed to calculate recent form.'
    : !noPastGaps
      ? `${input.unconfirmedPastRounds} past scheduled round${input.unconfirmedPastRounds === 1 ? ' is' : 's are'} missing confirmed results; resolve the data gap before estimating the remaining season.`
    : input.finalRound <= input.throughRound
      ? 'The season has no remaining scheduled rounds to estimate.'
      : !input.backtest.passed
        ? `Not enough validated history for a reliable estimate. The model needs ${predictionMinimumBacktestCases} rolling back-test checkpoints and must perform at least as well as the points-only baseline.`
        : null;
  if (!available) return { available: false, season: input.season, throughRound: input.throughRound, finalRound: input.finalRound, unconfirmedPastRounds: input.unconfirmedPastRounds, modelVersion: predictionModelVersion, label: 'Estimate, not a guarantee', method: '60% season points pace plus 40% average points scored per round over the latest three confirmed rounds.', reason, validation: input.backtest, estimates: [] };
  const projected = estimateAt(input.history, input.throughRound, input.finalRound).sort((a, b) => b.projectedFinalPoints - a.projectedFinalPoints || a.name.localeCompare(b.name));
  const leaderPoints = projected[0]?.projectedFinalPoints ?? 0;
  const estimates = projected.map((row, index) => ({ ...row, estimatedPosition: index + 1, gapToEstimateLeader: Math.round(leaderPoints - row.projectedFinalPoints) }));
  return { available: true, season: input.season, throughRound: input.throughRound, finalRound: input.finalRound, unconfirmedPastRounds: input.unconfirmedPastRounds, modelVersion: predictionModelVersion, label: 'Estimate, not a guarantee', method: '60% season points pace plus 40% average points scored per round over the latest three confirmed rounds. The same approach was back-tested against completed seasons and passed the published comparison gate.', reason: null, validation: input.backtest, estimates };
}
