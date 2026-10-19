import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';

const { databaseUrl } = loadConfig();
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await migrate(pool);
  console.log('Database schema is ready');
} finally {
  await pool.end();
}
