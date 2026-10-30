import { describe, expect, it } from 'vitest';
import { backtestPredictionModel, buildPredictionEstimate, type CompletedPredictionSeason } from './predictions.js';

function completedSeason(season: number): CompletedPredictionSeason {
  return {
    season,
    rounds: Array.from({ length: 5 }, (_, index) => {
      const round = index + 1;
      return { round, drivers: [{ id: 'a', name: 'Driver A', points: 25 * round }, { id: 'b', name: 'Driver B', points: 10 * round }, { id: 'c', name: 'Driver C', points: 5 * round }] };
    }),
  };
}

describe('transparent season prediction v1', () => {
  it('requires a rolling back-test and rejects a model that does not beat its baseline', () => {
    const validation = backtestPredictionModel(Array.from({ length: 6 }, (_, index) => completedSeason(2010 + index)));
    expect(validation.cases).toBe(12);
    expect(validation.passed).toBe(true);
    expect(validation.blendMeanAbsoluteError).toBeLessThanOrEqual(validation.pointsMeanAbsoluteError!);
  });

  it('returns the documented unavailable state when there is not enough validated history', () => {
    const validation = backtestPredictionModel([]);
    const result = buildPredictionEstimate({ season: 2026, throughRound: 5, finalRound: 10, unconfirmedPastRounds: 0, history: completedSeason(2026).rounds.slice(-3), backtest: validation });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/Not enough validated history/);
    expect(result.estimates).toEqual([]);
  });

  it('uses the transparent season pace and recent-form blend after validation passes', () => {
    const backtest = backtestPredictionModel(Array.from({ length: 6 }, (_, index) => completedSeason(2010 + index)));
    const result = buildPredictionEstimate({ season: 2026, throughRound: 5, finalRound: 8, unconfirmedPastRounds: 0, history: completedSeason(2026).rounds.slice(-3), backtest });
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('Expected a validated estimate.');
    expect(result.estimates[0]).toMatchObject({ id: 'a', currentPoints: 125, projectedFinalPoints: 200, estimatedPosition: 1, gapToEstimateLeader: 0 });
    expect(result.label).toBe('Estimate, not a guarantee');
  });

  it('withholds estimates while past scheduled results are unconfirmed', () => {
    const backtest = backtestPredictionModel(Array.from({ length: 6 }, (_, index) => completedSeason(2010 + index)));
    const result = buildPredictionEstimate({ season: 2026, throughRound: 5, finalRound: 10, unconfirmedPastRounds: 2, history: completedSeason(2026).rounds.slice(-3), backtest });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/2 past scheduled rounds are missing confirmed results/);
  });
});
