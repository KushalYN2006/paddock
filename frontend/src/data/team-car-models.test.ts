import { describe, expect, it } from 'vitest';
import { getTeamCarModel, getTeamCarModelUrl, teamCarModels } from './team-car-models.js';

describe('team car model configuration', () => {
  it('maps each supplied constructor to its intact local GLB asset', () => {
    const expectedModels = ['aston martin', 'audi', 'cadillac f1 team', 'ferrari', 'haas f1 team', 'mclaren', 'mercedes', 'red bull'];
    expect(Object.keys(teamCarModels).sort()).toEqual(expectedModels.sort());
    for (const [team, model] of Object.entries(teamCarModels)) {
      expect(getTeamCarModel(team)).toEqual(model);
      expect(model.file).toMatch(/^models\/teams\/.+\.glb$/);
      expect(getTeamCarModelUrl(model)).toContain(model.file);
    }
  });

  it('keeps constructors without supplied models on the no-model path', () => {
    expect(getTeamCarModel('Alpine')).toBeNull();
    expect(getTeamCarModel('Williams')).toBeNull();
    expect(getTeamCarModel('RB F1 Team')).toBeNull();
  });
});
