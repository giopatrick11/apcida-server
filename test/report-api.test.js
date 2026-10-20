import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

const apiKey = 'a'.repeat(40);
const now = 1_800_000_000_000;
const validReport = {
  reportType: 'Phishing Link (Fake Login Page)',
  remarks: null,
  riskScore: 65,
  gemmaClassification: 'SCAM',
  gemmaRationale: 'The message asks the recipient to act urgently.',
  detectedKeywords: ['verify account', 'bit.ly'],
  reportedAt: now - 86_400_000,
  appVersion: '1.0'
};

let server;
let baseUrl;
let saved;
let failStorage = false;
let failConflict = false;
let created = true;

before(async () => {
  const repository = {
    async save(report) {
      if (failStorage) throw new Error('database unavailable');
      if (failConflict) {
        const error = new Error('report ID conflict');
        error.code = 'REPORT_ID_CONFLICT';
        throw error;
      }
      saved = report;
      return { reportId: '26f654a8-2316-4f77-a88a-7fa6724a97b6', created };
    }
  };
  const app = createApp({ apiKey, repository, now: () => now,
    limiter: (_req, _res, next) => next() });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function submit(body = validReport, headers = {}) {
  return fetch(`${baseUrl}/api/reports/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Timestamp': String(now),
      ...headers
    },
    body: JSON.stringify(body)
  });
}

test('health endpoint responds without a database call', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('accepts the Android payload and returns the expected response', async () => {
  const response = await submit();
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    success: true, message: 'Report received',
    reportId: '26f654a8-2316-4f77-a88a-7fa6724a97b6'
  });
  assert.deepEqual(saved, validReport);
});

test('rejects missing or incorrect authentication and stale timestamps', async () => {
  assert.equal((await submit(validReport, { 'X-API-Key': '' })).status, 401);
  assert.equal((await submit(validReport, { 'X-API-Key': 'wrong' })).status, 401);
  assert.equal((await submit(validReport,
    { 'X-Timestamp': String(now - 300_001) })).status, 401);
  assert.equal((await submit(validReport,
    { 'X-Timestamp': 'not-a-time' })).status, 401);
});

test('rejects unexpected SMS and sender fields and malformed metadata', async () => {
  assert.equal((await submit({ ...validReport, fullSms: 'private text' })).status, 400);
  assert.equal((await submit({ ...validReport, riskScore: 500 })).status, 400);
  assert.equal((await submit({ ...validReport, detectedKeywords: 'verify' })).status, 400);
});

test('accepts a scan snapshot and exact SMS text with consent', async () => {
  const snapshot = {
    ...validReport,
    clientReportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    finalVerdict: 'SAFE',
    ruleVerdict: 'SAFE',
    processingState: 'COMPLETED',
    aiStatus: 'AVAILABLE',
    gemmaConfidence: 'LOW',
    modelVersion: 'gemma3-1b-it-int4.task',
    smsText: 'Visit https://example.test/login with code 123456',
    messageSharingConsent: true
  };
  assert.equal((await submit(snapshot)).status, 201);
  assert.equal(saved.smsText, snapshot.smsText);
  assert.equal(saved.finalVerdict, 'SAFE');
  assert.equal((await submit({ ...snapshot, messageSharingConsent: false })).status, 400);
  assert.equal((await submit({ ...snapshot, messageSharingConsent: null })).status, 400);
  assert.equal((await submit({ ...snapshot, senderAddress: '+639171234567' })).status, 400);
  assert.equal((await submit({ ...snapshot, finalVerdict: 'UNKNOWN' })).status, 400);
  assert.equal((await submit({ ...snapshot, aiStatus: null })).status, 400);
});

test('accepts a new report without SMS text when sharing was declined', async () => {
  const withoutSms = {
    ...validReport,
    clientReportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    finalVerdict: 'SUSPICIOUS',
    ruleVerdict: 'SCAM',
    processingState: 'AI_FAILED',
    aiStatus: 'UNAVAILABLE',
    messageSharingConsent: false
  };
  assert.equal((await submit(withoutSms)).status, 201);
  assert.equal(saved.smsText, null);
  assert.equal(saved.messageSharingConsent, false);
});

test('redacts common identifiers from free text before storage', async () => {
  await submit({ ...validReport,
    remarks: 'Call +639171234567 or email me@example.com',
    gemmaRationale: 'Visit https://example.test/secret with code 123456'
  });
  assert.equal(saved.remarks, 'Call [PHONE] or email [EMAIL]');
  assert.equal(saved.gemmaRationale, 'Visit [URL] with code [NUMBER]');
});

test('returns the existing report ID for a duplicate payload', async () => {
  created = false;
  const response = await submit();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reportId,
    '26f654a8-2316-4f77-a88a-7fa6724a97b6');
  created = true;
});

test('returns a retryable failure when storage is unavailable', async () => {
  failStorage = true;
  const response = await submit();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
  failStorage = false;
});

test('returns a permanent conflict for a reused report ID', async () => {
  failConflict = true;
  const response = await submit();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).success, false);
  failConflict = false;
});
