import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = await buildApp();
try {
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (error) {
  console.error('API server failed to start:', error);
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
