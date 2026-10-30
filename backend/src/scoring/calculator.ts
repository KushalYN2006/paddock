import { scoreDeadHeats2026, type SessionType } from './season-2026.js';

export interface CalculatorStanding { id: string; name: string; position: number; points: number; }
export interface CalculatorRound { round: number; name: string; isSprint: boolean; isFuture: boolean; }
export interface ScenarioFinish { driverId: string; position: number; }
export interface ScenarioRound { round: number; raceFinishes: ScenarioFinish[]; sprintFinishes?: ScenarioFinish[]; }

export function buildCalculatorSummary(standings: CalculatorStanding[], rounds: CalculatorRound[], throughRound: number) {
  const remaining = rounds.filter((round) => round.round > throughRound && round.isFuture);
  const pastUnconfirmedRounds = rounds.filter((round) => round.round > throughRound && !round.isFuture).length;
  const maxPerDriver = remaining.reduce((total, round) => total + 25 + (round.isSprint ? 8 : 0), 0);
  const leaderPoints = standings[0]?.points ?? 0;
  return {
    throughRound,
    racesRemaining: remaining.length,
    sprintRacesRemaining: remaining.filter((round) => round.isSprint).length,
    pastUnconfirmedRounds,
    maximumPointsAvailable: maxPerDriver,
    remainingRounds: remaining,
    scoring: { version: 'FIA-2026-A2.2-ISS02', racePoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprintPoints: [8, 7, 6, 5, 4, 3, 2, 1], fastestLapBonus: false, sourceUrl: 'https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_a_general_provisions_-_iss_02_-_2026-02-27.pdf' },
    contenders: standings.map((row) => {
      const pointsToLeader = Math.max(0, leaderPoints - row.points);
      const maximumFinalPoints = row.points + maxPerDriver;
      const mathematicallyEliminated = maximumFinalPoints < leaderPoints;
      return { ...row, pointsToLeader, maximumFinalPoints, mathematicallyEliminated, titleStatus: mathematicallyEliminated ? 'ELIMINATED' : 'ALIVE' };
    }),
  };
}

export function calculateScenario(input: {
  standings: CalculatorStanding[];
  rounds: CalculatorRound[];
  throughRound: number;
  entrantCount: number;
  assignments: ScenarioRound[];
}) {
  const roundByNumber = new Map(input.rounds.map((round) => [round.round, round]));
  const assignedRounds = new Set<number>();
  const knownDrivers = new Set(input.standings.map((standing) => standing.id));
  const assignedPoints = new Map<string, number>();
  for (const assignment of input.assignments) {
    if (assignedRounds.has(assignment.round)) throw new Error(`Round ${assignment.round} is listed more than once.`);
    assignedRounds.add(assignment.round);
    const round = roundByNumber.get(assignment.round);
    if (!round || assignment.round <= input.throughRound || !round.isFuture) throw new Error(`Round ${assignment.round} is not an upcoming event in this season.`);
    if (assignment.raceFinishes.length > input.entrantCount || (assignment.sprintFinishes?.length ?? 0) > input.entrantCount) throw new Error(`Round ${assignment.round} has more entries than the ${input.entrantCount} season entrants.`);
    const sessions: Array<[SessionType, ScenarioFinish[]]> = [['RACE', assignment.raceFinishes], ['SPRINT', assignment.sprintFinishes ?? []]];
    for (const [session, finishes] of sessions) {
      if (session === 'SPRINT' && finishes.length && !round.isSprint) throw new Error(`Round ${assignment.round} is not a Sprint weekend.`);
      const drivers = new Set<string>(); const positions = new Set<number>();
      for (const finish of finishes) {
        if (!knownDrivers.has(finish.driverId)) throw new Error(`Unknown driver in round ${assignment.round}.`);
        if (drivers.has(finish.driverId)) throw new Error(`A driver is listed twice in round ${assignment.round}.`);
        if (!Number.isInteger(finish.position) || finish.position < 1 || finish.position > input.entrantCount) throw new Error(`Positions must be between 1 and ${input.entrantCount}.`);
        if (positions.has(finish.position)) throw new Error(`Position ${finish.position} is assigned more than once in round ${assignment.round}.`);
        drivers.add(finish.driverId); positions.add(finish.position);
      }
      const scores = scoreDeadHeats2026(finishes.map((finish) => finish.position), session);
      finishes.forEach((finish, index) => assignedPoints.set(finish.driverId, (assignedPoints.get(finish.driverId) ?? 0) + (scores[index] ?? 0)));
    }
  }
  const projected = input.standings.map((row) => ({ ...row, scenarioPoints: assignedPoints.get(row.id) ?? 0, projectedPoints: row.points + (assignedPoints.get(row.id) ?? 0) }));
  projected.sort((a, b) => b.projectedPoints - a.projectedPoints || a.position - b.position);
  const leaderPoints = projected[0]?.projectedPoints ?? 0;
  return {
    ruleSet: 'FIA-2026-A2.2-ISS02',
    assumptions: ['Unassigned drivers and sessions receive no scenario points.', 'Only the listed upcoming race and Sprint finishes are added to current confirmed points.', 'A tie in projected championship points keeps the current order; official season tie-break rules may change the order.'],
    standings: projected.map((row, index) => ({ ...row, projectedPosition: index + 1, gapToProjectedLeader: leaderPoints - row.projectedPoints })),
  };
}
