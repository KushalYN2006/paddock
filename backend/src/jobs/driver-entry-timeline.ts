export interface DriverEntryRange {
  id: string;
  constructorId: string;
  validFromRound: number | null;
  validToRound: number | null;
}

export type EntryTransition =
  | { action: 'keep'; entry: DriverEntryRange }
  | { action: 'deduplicate'; entry: DriverEntryRange; removeIds: string[] }
  | { action: 'extend'; entry: DriverEntryRange; closeEntryId: string | null }
  | { action: 'create'; closeEntryId: string | null; validToRound: number | null };

export function planEntryTransition(entries: DriverEntryRange[], round: number, constructorId: string): EntryTransition {
  const ordered = [...entries].sort((a, b) => (a.validFromRound ?? 1) - (b.validFromRound ?? 1));
  const active = ordered.filter((entry) => (entry.validFromRound ?? 1) <= round && (entry.validToRound === null || entry.validToRound >= round));
  const activeTeams = new Set(active.map((entry) => entry.constructorId));
  if (activeTeams.size > 1) throw new Error(`Conflicting team associations in round ${round}.`);
  if (active.length > 1) {
    const entry = active[0]!;
    if (entry.constructorId !== constructorId) throw new Error(`Conflicting team association in round ${round}.`);
    return { action: 'deduplicate', entry, removeIds: active.slice(1).map((item) => item.id) };
  }
  const current = active[0] ?? null;
  if (current?.constructorId === constructorId) return { action: 'keep', entry: current };
  if (current && (current.validFromRound ?? 1) === round) throw new Error(`Conflicting team association in round ${round}.`);
  const future = ordered.find((entry) => (entry.validFromRound ?? 1) > round);
  if (future?.constructorId === constructorId) return { action: 'extend', entry: future, closeEntryId: current?.id ?? null };
  return {
    action: 'create',
    closeEntryId: current?.id ?? null,
    validToRound: future ? (future.validFromRound ?? 1) - 1 : null,
  };
}
