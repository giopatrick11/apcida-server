import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { createReportRepository } from '../src/repository.js';
import { createAdminRepository } from '../src/admin-repository.js';

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
        reportType: 'Scam was not detected',
        remarks: 'Contact me at test@example.com',
        riskScore: 60,
        gemmaClassification: 'UNCERTAIN',
        gemmaRationale: null,
        detectedKeywords: ['urgent'],
        reportedAt: now,
        appVersion: '1.0',
        clientReportId: randomUUID(),
        finalVerdict: 'SUSPICIOUS',
        ruleVerdict: 'SCAM',
        processingState: 'COMPLETED',
        aiStatus: 'AVAILABLE',
        gemmaConfidence: 'LOW',
        modelVersion: 'gemma3-1b-it-int4.task',
        smsText: 'Verify at https://example.test/login',
        messageSharingConsent: true
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
        `SELECT report_type, remarks, detected_keywords, final_verdict,
                rule_verdict, sms_text, message_sharing_consent
         FROM reports WHERE report_id = $1`,
        [reportId]
      );
      assert.equal(stored.rows.length, 1);
      assert.equal(stored.rows[0].report_type, 'Scam was not detected');
      assert.equal(stored.rows[0].remarks, 'Contact me at [EMAIL]');
      assert.deepEqual(stored.rows[0].detected_keywords, ['urgent']);
      assert.equal(stored.rows[0].final_verdict, 'SUSPICIOUS');
      assert.equal(stored.rows[0].rule_verdict, 'SCAM');
      assert.equal(stored.rows[0].sms_text, 'Verify at https://example.test/login');
      assert.equal(stored.rows[0].message_sharing_consent, true);

      const adminRepository = createAdminRepository(pool);
      const listed = await adminRepository.list({ page: 1 });
      const row = listed.rows.find((item) => item.report_id === reportId);
      assert.equal(row.review_status, 'NEW');
      assert.equal(Object.hasOwn(row, 'sms_text'), false);
      assert.equal(await adminRepository.review(reportId, {
        status: 'RESOLVED', label: 'SCAM', finding: 'MISSED_SCAM',
        notes: 'Verified by reviewer'
      }, 'test-reviewer'), true);
      const detail = await adminRepository.get(reportId);
      assert.equal(detail.confirmed_label, 'SCAM');
      assert.equal(detail.finding, 'MISSED_SCAM');
      assert.equal(detail.sms_text, 'Verify at https://example.test/login');
      const history = await adminRepository.history(reportId);
      assert.equal(history.length, 1);
      const summary = await adminRepository.summary();
      assert.ok(summary.totals.reports >= 1);
      assert.ok(summary.finding.some((item) => item.label === 'MISSED_SCAM'));
    } finally {
      if (reportId) {
        await pool.query('DELETE FROM reports WHERE report_id = $1', [reportId]);
      }
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool.end();
    }
  });
