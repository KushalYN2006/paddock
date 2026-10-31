import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public companion shell', () => {
  it('shows the anonymous home page and unofficial-project disclosure', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('API unavailable')));
    render(<MemoryRouter><App /></MemoryRouter>);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toContain('Every race has');
    expect(title.textContent).toContain('bigger picture.');
    expect(screen.getByText(/independent fan project\. not affiliated with formula 1/i)).toBeTruthy();
    expect(screen.queryByLabelText(/log in|sign in|profile/i)).toBeNull();
  });

  it('builds and calculates an in-memory championship scenario', async () => {
    const summary = {
      throughRound: 5, racesRemaining: 1, sprintRacesRemaining: 1, pastUnconfirmedRounds: 0, maximumPointsAvailable: 33, entrantCount: 2,
      remainingRounds: [{ round: 6, name: 'Monaco Grand Prix', isSprint: true, isFuture: true }],
      scoring: { version: 'FIA-2026-A-ISS03', racePoints: [25, 18], sprintPoints: [8, 7], fastestLapBonus: false, sourceUrl: 'https://www.fia.com/' },
      contenders: [{ id: 'd1', name: 'Driver One', position: 1, points: 50, pointsToLeader: 0, maximumFinalPoints: 83, mathematicallyEliminated: false, titleStatus: 'ALIVE' }, { id: 'd2', name: 'Driver Two', position: 2, points: 40, pointsToLeader: 10, maximumFinalPoints: 73, mathematicallyEliminated: false, titleStatus: 'ALIVE' }],
    };
    const prediction = { available: false, season: 2026, throughRound: 5, finalRound: 7, modelVersion: 'form-points-blend-v1', label: 'Estimate, not a guarantee', method: '60% season pace and 40% recent form.', reason: 'Not enough validated history for a reliable estimate.', validation: { cases: 0, blendChampionAccuracy: null, pointsChampionAccuracy: null, blendMeanAbsoluteError: null, pointsMeanAbsoluteError: null, passed: false }, estimates: [] };
    const projection = { assumptions: ['Unassigned entries receive no points.'], standings: [{ id: 'd1', name: 'Driver One', position: 1, points: 50, scenarioPoints: 25, projectedPoints: 75, projectedPosition: 1, gapToProjectedLeader: 0 }, { id: 'd2', name: 'Driver Two', position: 2, points: 40, scenarioPoints: 18, projectedPoints: 58, projectedPosition: 2, gapToProjectedLeader: 17 }] };
    let submittedBody = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/calculator/scenario')) submittedBody = String(init?.body ?? '');
      const data = url.includes('/calculator/summary') ? summary : url.includes('/calculator/scenario') ? projection : url.includes('/predictions') ? prediction : url.includes('/seasons') ? [] : { season: 2026, throughRound: 5, updatedAt: null, stale: false, provider: 'test' };
      return { ok: true, json: async () => ({ data, meta: {} }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/calculator']}><App /></MemoryRouter>);
    await screen.findByText('Driver One');
    expect(await screen.findByText('Not enough validated history for a reliable estimate.')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Interactive/ }));
    await user.click(screen.getByRole('button', { name: /Add result/ }));
    await user.selectOptions(screen.getByLabelText('Driver'), 'd2');
    await user.click(screen.getByRole('button', { name: /Add result/ }));
    expect(screen.getByText(/Position 1 is already assigned/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Finishing position'), '2');
    await user.click(screen.getByRole('button', { name: /Add result/ }));
    await user.click(screen.getByRole('button', { name: /Calculate scenario/ }));
    expect(await screen.findByRole('heading', { name: 'Projected standings' })).toBeTruthy();
    await waitFor(() => expect(submittedBody).toContain('"driverId":"d2"'));
    expect(screen.getAllByText('Driver Two').length).toBeGreaterThan(0);
  });

  it('separates source-backed recap facts from race analysis and missing metrics', async () => {
    const race = { round: 5, name: 'Sample Grand Prix', circuit: 'Sample Circuit', scheduledStart: null, results: [{ position: 1, driver: 'Driver One', constructor: 'Team One', points: 25, status: 'Finished' }], sprintResults: [], recap: { available: true, narrativeAvailable: false, unsupportedEntryCount: 0, entries: [{ kind: 'FACT', category: 'WINNER', body: 'Driver One won the Grand Prix classification.', sourceUrl: 'https://github.com/jolpica/jolpica-f1', sourceLabel: 'Jolpica-F1 classification data' }] } };
    const analysis = { round: 5, name: 'Sample Grand Prix', positions: { available: true, method: 'Grid minus finish.', rows: [{ driverId: 'one', driver: 'Driver One', gridPosition: 3, finishPosition: 1, positionsChange: 2, label: 'Gained 2' }] }, qualifyingVsRace: { available: false, reason: 'Verified qualifying classifications are not stored for this event.', rows: [] }, teammateBattles: { available: false, method: 'Both teammates need results.', rows: [] }, pitStops: { available: false, reason: 'Pit-stop records are not yet imported and validated for this event.', recordCount: 0 }, sourceCoverage: { raceClassificationRows: 1, classifiedRows: 1, qualifyingRows: 0, pitStopRecords: 0 } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.includes('/races/5/analysis') ? analysis : url.includes('/races/5') ? race : url.includes('/seasons') ? [] : { season: 2026, throughRound: 5, updatedAt: null, stale: false, provider: 'test' };
      return { ok: true, json: async () => ({ data, meta: {} }) } as Response;
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/races/5']}><App /></MemoryRouter>);
    await user.click(await screen.findByRole('tab', { name: 'Recap' }));
    expect(await screen.findByText('Classification facts only.')).toBeTruthy();
    expect(screen.getByText('Driver One won the Grand Prix classification.')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Analysis' }));
    expect(await screen.findByText('Gained 2')).toBeTruthy();
    expect(screen.getByText('Verified qualifying classifications are not stored for this event.')).toBeTruthy();
    expect(screen.getByText('Pit-stop records are not yet imported and validated for this event.')).toBeTruthy();
  });

  it('shows confirmed season statistics separately from sourced career achievements', async () => {
    const driver = { id: 'd1', name: 'Driver One', team: 'Team One', nationality: 'Example', number: 7, biography: null, imageUrl: null, currentStats: { available: true, throughRound: 5, throughRoundName: 'Example Grand Prix', position: 2, points: 88, wins: 1, podiums: 2, poles: null }, career: { available: false, reason: 'Career achievement data is not available from the configured source.' } };
    const career = { available: true, championships: 7, starts: 398, wins: 106, podiums: 208, poles: 104, fastestLaps: 69, sourceUrl: 'https://racinghub.net/drivers/driver-one', reason: null };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.endsWith('/drivers/d1/career') ? career : url.includes('/drivers/d1?') ? driver : url.includes('/seasons') ? [] : { season: 2026, throughRound: 5, updatedAt: null, stale: false, provider: 'test' };
      return { ok: true, json: async () => ({ data, meta: {} }) } as Response;
    }));
    render(<MemoryRouter initialEntries={['/drivers/d1']}><App /></MemoryRouter>);
    expect(await screen.findByText('88')).toBeTruthy();
    expect(screen.getByText('P2')).toBeTruthy();
    expect(await screen.findByText('WORLD CHAMPIONSHIPS')).toBeTruthy();
    expect(screen.getByText('106')).toBeTruthy();
    expect(screen.getByText('Not available')).toBeTruthy();
  });

  it('shows confirmed constructor-season standings on the team profile', async () => {
    const team = { id: 't1', name: 'Team One', drivers: ['Driver One', 'Driver Two'], currentStats: { available: true, throughRound: 18, throughRoundName: 'Final Example Grand Prix', position: 1, points: 607, wins: 12 } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.includes('/teams/t1') ? team : { season: 2026, throughRound: 18, updatedAt: null, stale: false, provider: 'test' };
      return { ok: true, json: async () => ({ data, meta: {} }) } as Response;
    }));
    render(<MemoryRouter initialEntries={['/teams/t1']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Team One' })).toBeTruthy();
    expect(await screen.findByText('607')).toBeTruthy();
    expect(screen.getByText('P1')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.queryByText('Season statistics unavailable')).toBeNull();
  });
});
