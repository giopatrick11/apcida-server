import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/001_create_reports.sql', import.meta.url);

export async function migrate(pool) {
  const sql = await readFile(migrationUrl, 'utf8');
  await pool.query(sql);
}
