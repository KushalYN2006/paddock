export interface TeamCarModel {
  file: string;
  displayName: string;
  archive: string;
}

/** Keep car assets associated with a constructor here; unmatched teams use the no-model fallback. */
export const teamCarModels: Readonly<Record<string, TeamCarModel>> = {
  'aston martin': { file: 'models/teams/aston-martin/source/f1_2026_amr26.glb', displayName: 'Aston Martin AMR26', archive: '2026-aston-martin-amr26.zip' },
  audi: { file: 'models/teams/audi/source/f1_2026_r26.glb', displayName: 'Audi R26', archive: '2026-audi-r26.zip' },
  'cadillac f1 team': { file: 'models/teams/cadillac/source/f1_2026_mac26.glb', displayName: 'Cadillac MAC-26', archive: '2026-cadillac-mac-26.zip' },
  ferrari: { file: 'models/teams/ferrari/source/f1_2026_sf26.glb', displayName: 'Ferrari SF-26', archive: '2026-ferrari-sf-26.zip' },
  'haas f1 team': { file: 'models/teams/haas/source/fia_f1_2026_car.glb', displayName: 'Haas VF-26', archive: '2026-haas-vf-26.zip' },
  mclaren: { file: 'models/teams/mclaren/source/f1_2026_mcl40.glb', displayName: 'McLaren MCL40', archive: '2026-mclaren-mcl40.zip' },
  mercedes: { file: 'models/teams/mercedes/source/f1_2026_w17.glb', displayName: 'Mercedes W17', archive: '2026-mercedes-w17.zip' },
  'red bull': { file: 'models/teams/red-bull/source/untitled.glb', displayName: 'Red Bull RB22', archive: '2026-redbull-rb22.zip' },
};

function normalizeTeamName(name: string) {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function getTeamCarModel(teamName: string): TeamCarModel | null {
  return teamCarModels[normalizeTeamName(teamName)] ?? null;
}

export function getTeamCarModelUrl(model: TeamCarModel): string {
  return `${import.meta.env.BASE_URL}${model.file}`;
}
