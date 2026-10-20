import pg from 'pg';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './migrate.js';
import { createReportRepository } from './repository.js';
import { createAdminRepository } from './admin-repository.js';

const config = loadConfig();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000
});

pool.on('error', (error) => {
  console.error('Database pool error', error.code ?? error.name);
});

try {
  await migrate(pool);
  const app = createApp({
    apiKey: config.apiKey,
    repository: createReportRepository(pool),
    admin: config.admin,
    adminRepository: config.admin ? createAdminRepository(pool) : null,
    ready: () => pool.query('SELECT 1')
  });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`ApCiDa report server listening on port ${config.port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => pool.end().finally(() => process.exit(0)));
    });
  }
} catch (error) {
  console.error('Server startup failed', error.code ?? error.name);
  await pool.end();
  process.exitCode = 1;
}
