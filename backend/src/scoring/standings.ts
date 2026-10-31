export interface StandingCandidate {
  entityId: string;
  name: string;
  points: number;
  wins: number;
  racePlaces: ReadonlyMap<number, number>;
  qualifyingPlaces: ReadonlyMap<number, number>;
}

function comparePlaces(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>) {
  for (let position = 1; position <= 30; position += 1) {
    const difference = (b.get(position) ?? 0) - (a.get(position) ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function sportingTie(a: StandingCandidate, b: StandingCandidate) {
  return a.points === b.points && a.wins === b.wins && comparePlaces(a.racePlaces, b.racePlaces) === 0;
}

function sameOfficialRecord(a: StandingCandidate, b: StandingCandidate) {
  return sportingTie(a, b) && comparePlaces(a.qualifyingPlaces, b.qualifyingPlaces) === 0;
}

export function unresolvedRaceCountbackTies(rows: StandingCandidate[]) {
  const ordered = [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins || comparePlaces(a.racePlaces, b.racePlaces));
  const tied = new Set<string>();
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (sportingTie(previous, current)) {
      tied.add(previous.entityId);
      tied.add(current.entityId);
    }
  }
  return tied;
}

export function rankStandings(rows: StandingCandidate[]) {
  const ordered = [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins || comparePlaces(a.racePlaces, b.racePlaces) || comparePlaces(a.qualifyingPlaces, b.qualifyingPlaces));
  let rank = 0;
  return ordered.map((row, index) => {
    if (index === 0 || !sameOfficialRecord(ordered[index - 1]!, row)) rank = index + 1;
    return { ...row, rank };
  });
}
