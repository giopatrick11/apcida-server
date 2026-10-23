import { readFile } from 'node:fs/promises';

const migrationUrls = [
  new URL('../db/001_create_reports.sql', import.meta.url),
  new URL('../db/002_report_snapshots.sql', import.meta.url),
  new URL('../db/003_report_reviews.sql', import.meta.url),
  new URL('../db/004_community.sql', import.meta.url)
];

export async function migrate(pool) {
  for (const url of migrationUrls) {
    await pool.query(await readFile(url, 'utf8'));
  }
}
