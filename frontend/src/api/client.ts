export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');

export interface ApiMeta {
  season: number;
  throughRound: number;
  throughRoundName?: string | null;
  updatedAt: string | null;
  stale: boolean;
  source?: string;
}

export interface Envelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface DataStatus {
  season: number;
  throughRound: number;
  throughRoundName?: string | null;
  updatedAt: string | null;
  stale: boolean;
  provider: string;
  lastError?: string | null;
}

export interface Standing {
  position: number;
  name: string;
  team?: string;
  points: number;
  wins?: number;
  podiums?: number;
}

export interface Progression {
  series: Array<{ id: string; name: string }>;
  rounds: Array<{ round: number; values: Array<{ id: string; points: number }> }>;
}

export interface ChampionshipMover {
  id: string;
  name: string;
  position: number;
  change: number;
}

export interface RaceSummary {
  round: number;
  name: string;
  scheduledStart: string | null;
  scheduleUpdatedAt?: string | null;
  status: 'COMPLETED' | 'UPCOMING' | 'UNKNOWN';
  circuit?: string | null;
  winner?: string | null;
}

export interface DirectoryPerson {
  id: string;
  name: string;
  nationality?: string | null;
  team?: string | null;
  number?: number | null;
}
export interface DriverProfile extends DirectoryPerson {
  biography?: string | null;
  imageUrl?: string | null;
  currentStats: { available: boolean; throughRound: number; throughRoundName: string | null; position: number | null; points: number | null; wins: number | null; podiums: number | null; poles: number | null };
  career: { available: boolean; reason: string | null };
}

export type DriverCareer =
  | { available: true; championships: number; starts: number; wins: number; podiums: number; poles: number; fastestLaps: number; sourceUrl: string; reason: null }
  | { available: false; reason: string };

export interface DirectoryTeam {
  id: string;
  name: string;
  nationality?: string | null;
  drivers?: string[];
  currentStats: { available: boolean; throughRound: number; throughRoundName: string | null; position: number | null; points: number | null; wins: number | null };
}

export interface RaceDetail {
  round: number;
  name: string;
  circuit: string | null;
  scheduledStart: string | null;
  results: Array<{ position: number | null; driver: string; constructor: string; points: number; status: string | null }>;
  sprintResults: Array<{ position: number | null; driver: string; constructor: string; points: number; status: string | null }>;
  recap: { available: boolean; narrativeAvailable: boolean; unsupportedEntryCount: number; entries: Array<{ kind: 'FACT' | 'INTERPRETATION'; category: string; body: string; sourceUrl: string; sourceLabel: string | null }> };
}
export interface RaceAnalysis {
  round: number; name: string;
  positions: { available: boolean; method: string; rows: Array<{ driverId: string; driver: string; gridPosition: number | null; finishPosition: number | null; positionsChange: number | null; label: string }> };
  qualifyingVsRace: { available: boolean; reason: string | null; rows: Array<{ driverId: string; driver: string; qualifyingPosition: number; finishPosition: number; positionsChange: number }> };
  teammateBattles: { available: boolean; method: string; rows: Array<{ team: string; driverA: string; driverB: string; finishA: number | null; finishB: number | null; outcome: 'TIED' | 'DRIVER_A_AHEAD' | 'DRIVER_B_AHEAD' }> };
  pitStops: { available: boolean; reason: string | null; recordCount: number };
  sourceCoverage: { raceClassificationRows: number; classifiedRows: number; qualifyingRows: number; pitStopRecords: number };
}

export interface LearningTerm { id: string; label: string; definition: string; }
export interface LearningSection { id: string; title: string; body: string; sourceUrl?: string; }
export interface LearningQuestion { id: string; topic: string; question: string; options: string[]; }
export interface QuizFeedback { correct: boolean; correctIndex: number; explanation: string; }
export interface CalculatorSummary {
  throughRound: number; racesRemaining: number; sprintRacesRemaining: number; pastUnconfirmedRounds: number; maximumPointsAvailable: number; entrantCount: number;
  remainingRounds: Array<{ round: number; name: string; isSprint: boolean; isFuture: boolean }>;
  scoring: { version: string; racePoints: number[]; sprintPoints: number[]; fastestLapBonus: boolean; sourceUrl: string };
  contenders: Array<{ id: string; name: string; position: number; points: number; pointsToLeader: number; maximumFinalPoints: number; mathematicallyEliminated: boolean; titleStatus: 'ALIVE' | 'ELIMINATED' }>;
}
export interface ScenarioRoundInput { round: number; raceFinishes: Array<{ driverId: string; position: number }>; sprintFinishes?: Array<{ driverId: string; position: number }>; }
export interface ScenarioProjection { assumptions: string[]; standings: Array<{ id: string; name: string; position: number; points: number; scenarioPoints: number; projectedPoints: number; projectedPosition: number; gapToProjectedLeader: number }>; }
export interface PredictionEstimate {
  available: boolean; season: number; throughRound: number; finalRound: number; unconfirmedPastRounds: number; modelVersion: string; label: string; method: string; reason: string | null;
  validation: { cases: number; blendChampionAccuracy: number | null; pointsChampionAccuracy: number | null; blendMeanAbsoluteError: number | null; pointsMeanAbsoluteError: number | null; passed: boolean };
  estimates: Array<{ id: string; name: string; currentPoints: number; projectedFinalPoints: number; estimatedPosition: number; gapToEstimateLeader: number }>;
}

export async function getApi<T>(path: string, signal?: AbortSignal): Promise<Envelope<T>> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<Envelope<T>>;
}

export async function postApi<T>(path: string, body: unknown): Promise<Envelope<T>> {
  const response = await fetch(`${apiBaseUrl}${path}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `API request failed (${response.status})`);
  }
  return response.json() as Promise<Envelope<T>>;
}

function readCsrfCookie() {
  const cookieName = 'paddock_admin_csrf=';
  const value = document.cookie.split('; ').find((cookie) => cookie.startsWith(cookieName))?.slice(cookieName.length);
  return value ? decodeURIComponent(value) : undefined;
}

export async function getAdmin<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { headers: { Accept: 'application/json' }, credentials: 'include', signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Admin request failed (${response.status})`);
  }
  const payload = await response.json() as { data: T };
  return payload.data;
}

export async function sendAdmin<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const csrf = path === '/admin/session' && method === 'POST' ? undefined : readCsrfCookie();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `Admin request failed (${response.status})`);
  return payload?.data as T;
}
