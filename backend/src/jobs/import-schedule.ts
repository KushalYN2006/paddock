import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { JolpicaProvider } from '../providers/jolpica.js';

const prisma = new PrismaClient();
const args = process.argv.slice(2).filter((argument) => argument !== '--');
const season = z.coerce.number().int().min(1950).max(2100).parse(args[0]);
const provider = new JolpicaProvider(env.DATA_PROVIDER_URL);

async function importSchedule() {
  const races = await provider.getSchedule(season);
  if (!races.length) throw new Error(`No schedule data returned for ${season}; existing data was left unchanged.`);
  const rounds = new Set<number>();
  for (const race of races) {
    if (rounds.has(race.round)) throw new Error(`Duplicate round ${race.round}; existing data was left unchanged.`);
    rounds.add(race.round);
  }

  await prisma.$transaction(async (tx) => {
    await tx.season.upsert({ where: { year: season }, create: { year: season, isCurrent: season === new Date().getUTCFullYear(), sourceId: String(season) }, update: {} });
    for (const race of races) {
      let circuitId: string | undefined;
      if (race.circuit) {
        const circuit = await tx.circuit.upsert({
          where: { sourceId: race.circuit.sourceId },
          create: { sourceId: race.circuit.sourceId, name: race.circuit.name, locality: race.circuit.locality, country: race.circuit.country, latitude: race.circuit.latitude, longitude: race.circuit.longitude },
          update: { name: race.circuit.name, locality: race.circuit.locality, country: race.circuit.country, latitude: race.circuit.latitude, longitude: race.circuit.longitude },
        });
        circuitId = circuit.id;
      }
      const currentRound = await tx.round.findUnique({ where: { seasonYear_number: { seasonYear: season, number: race.round } } });
      const scheduleChanged = currentRound !== null && currentRound.scheduledStart?.getTime() !== race.scheduledStart?.getTime();
      await tx.round.upsert({
        where: { seasonYear_number: { seasonYear: season, number: race.round } },
        create: { seasonYear: season, number: race.round, name: race.name, scheduledStart: race.scheduledStart, sourceId: race.sourceId, isSprint: race.isSprint, circuitId },
        update: { name: race.name, scheduledStart: race.scheduledStart, sourceId: race.sourceId, isSprint: race.isSprint, circuitId, ...(scheduleChanged ? { scheduleUpdatedAt: new Date() } : {}) },
      });
    }
    await tx.dataStatus.upsert({
      where: { seasonYear: season },
      create: { seasonYear: season, provider: provider.name, stale: true, lastAttemptAt: new Date() },
      update: { provider: provider.name, lastAttemptAt: new Date() },
    });
  });
  console.log(`Imported ${races.length} scheduled rounds for ${season}. No race results were marked current.`);
}

importSchedule().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Schedule import failed.');
  try {
    await prisma.dataStatus.upsert({ where: { seasonYear: season }, create: { seasonYear: season, provider: provider.name, stale: true, lastAttemptAt: new Date(), lastError: 'Schedule import failed.' }, update: { stale: true, lastAttemptAt: new Date(), lastError: 'Schedule import failed.' } });
  } catch { /* The last good database state remains authoritative if status cannot be written. */ }
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
