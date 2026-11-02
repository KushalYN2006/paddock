import 'dotenv/config';
import { z } from 'zod';

const optionalSecret = z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional());
const envSchema = z.object({
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_SECRET: optionalSecret,
  ADMIN_ACCESS_KEY: optionalSecret,
  DATA_PROVIDER_URL: z.url().default('https://api.jolpi.ca/ergast/f1'),
  CORS_ORIGIN: z.url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = envSchema.parse(process.env);
if (parsed.NODE_ENV === 'production' && !parsed.JWT_SECRET) throw new Error('JWT_SECRET must be configured with at least 32 characters in production.');
export const env = { ...parsed, JWT_SECRET: parsed.JWT_SECRET ?? 'local-development-only-change-before-deploy' };
