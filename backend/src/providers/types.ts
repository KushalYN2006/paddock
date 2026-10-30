export interface CircuitRecord {
  sourceId: string;
  name: string;
  locality: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ScheduleRecord {
  season: number;
  round: number;
  sourceId: string;
  name: string;
  scheduledStart: Date | null;
  circuit: CircuitRecord | null;
  isSprint: boolean;
}

export interface F1DataProvider {
  readonly name: string;
  getSchedule(season: number): Promise<ScheduleRecord[]>;
}
