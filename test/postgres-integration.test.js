import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { createReportRepository } from '../src/repository.js';

test('stores one PostgreSQL row when the Android request is retried',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const apiKey = 'i'.repeat(40);
    const now = Date.now();
    let server;
    let reportId;
    try {
      await migrate(pool);
      const app = createApp({ apiKey,
        repository: createReportRepository(pool),
        limiter: (_req, _res, next) => next() });
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });

      const url = `http://127.0.0.1:${server.address().port}/api/reports/submit`;
      const body = JSON.stringify({
        reportType: 'Other',
        remarks: 'Contact me at test@example.com',
        riskScore: 60,
        gemmaClassification: 'UNCERTAIN',
        gemmaRationale: null,
        detectedKeywords: ['urgent'],
        reportedAt: now,
        appVersion: '1.0'
      });
      const send = () => fetch(url, { method: 'POST', body,
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey,
          'X-Timestamp': String(Date.now()) } });
      const first = await send();
      assert.equal(first.status, 201);
      reportId = (await first.json()).reportId;

      const second = await send();
      assert.equal(second.status, 200);
      assert.equal((await second.json()).reportId, reportId);

      const stored = await pool.query(
        'SELECT report_type, remarks, detected_keywords FROM reports WHERE report_id = $1',
        [reportId]
      );
      assert.equal(stored.rows.length, 1);
      assert.equal(stored.rows[0].report_type, 'Other');
      assert.equal(stored.rows[0].remarks, 'Contact me at [EMAIL]');
      assert.deepEqual(stored.rows[0].detected_keywords, ['urgent']);
    } finally {
      if (reportId) {
        await pool.query('DELETE FROM reports WHERE report_id = $1', [reportId]);
      }
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool.end();
    }
  });
