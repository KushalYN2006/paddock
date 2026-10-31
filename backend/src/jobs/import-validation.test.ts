import { describe, expect, it } from 'vitest';
import { validateRaceCoverage } from './import-validation.js';

describe('partial-season import coverage', () => {
  it('accepts a contiguous completed prefix while leaving future scheduled rounds alone', () => {
    const completed = new Map(Array.from({ length: 18 }, (_, index) => [index + 1, [{}]]));
    const scheduled = new Set(Array.from({ length: 23 }, (_, index) => index + 1));
    expect(validateRaceCoverage(completed, scheduled)).toBe(18);
  });

  it('rejects a missing round before newer results', () => {
    const results = new Map([[1, [{}]], [2, [{}]], [4, [{}]]]);
    expect(() => validateRaceCoverage(results, new Set([1, 2, 3, 4]))).toThrow(/Round 3 is missing/);
  });

  it('rejects a provider result outside the verified schedule', () => {
    expect(() => validateRaceCoverage(new Map([[1, [{}]], [3, [{}]]]), new Set([1, 2]))).toThrow(/unknown round 3/);
  });
});
