export type SessionType = 'RACE' | 'SPRINT';

const racePoints = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const sprintPoints = [8, 7, 6, 5, 4, 3, 2, 1];

export function scoreDeadHeats2026(positions: number[], session: SessionType): number[] {
  const table = session === 'RACE' ? racePoints : sprintPoints;
  return positions.map((position) => {
    if (!Number.isInteger(position) || position < 1) return 0;
    const tiedAtPosition = positions.filter((candidate) => candidate === position).length;
    if (tiedAtPosition === 1) return table[position - 1] ?? 0;
    const points = Array.from({ length: tiedAtPosition }, (_, offset) => table[position + offset - 1] ?? 0);
    return points.reduce((total, value) => total + value, 0) / tiedAtPosition;
  });
}
