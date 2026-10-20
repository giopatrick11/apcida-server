import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReportRepository } from '../src/repository.js';

const report = {
  reportType: 'Other', remarks: null, riskScore: 40,
  gemmaClassification: null, gemmaRationale: null,
  detectedKeywords: ['urgent'], reportedAt: 1_800_000_000_000,
  appVersion: '1.0'
};

test('deduplicates a retry using a stable payload digest', async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return calls.length === 1
        ? { rows: [{ report_id: 'same-id' }] }
        : calls.length === 2
          ? { rows: [] }
          : { rows: [{ report_id: 'same-id', payload_digest: calls[0].parameters[1] }] };
    }
  };
  const repository = createReportRepository(pool);
  assert.deepEqual(await repository.save(report),
    { reportId: 'same-id', created: true });
  assert.deepEqual(await repository.save(report),
    { reportId: 'same-id', created: false });
  assert.equal(calls[0].parameters[1], calls[1].parameters[1]);
  assert.equal(calls[0].parameters[1], calls[2].parameters[0]);
});

test('rejects reuse of a client report ID with different content', async () => {
  let originalDigest;
  const pool = {
    async query(_sql, parameters) {
      if (parameters.length > 2) {
        if (!originalDigest) {
          originalDigest = parameters[1];
          return { rows: [{ report_id: 'same-id' }] };
        }
        return { rows: [] };
      }
      return { rows: [{ report_id: 'same-id', payload_digest: originalDigest }] };
    }
  };
  const repository = createReportRepository(pool);
  const first = { ...report, clientReportId: 'ea1427aa-f483-43ad-9fa3-55358167dc80' };
  await repository.save(first);
  await assert.rejects(repository.save({ ...first, remarks: 'Changed after submission' }),
    { code: 'REPORT_ID_CONFLICT' });
});
