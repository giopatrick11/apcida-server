import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/admin-auth.js';
import { contentRejection, validateCommunityBatch } from '../src/community-validation.js';

const participantId = '75e388e0-6837-4efb-ae64-08c6b00e7211';
const batchId = '3bb14952-157b-4936-8e7b-8af9396f6722';
const clientId = 'a'.repeat(64);
const messageId = 'e84c3500-13be-4c5c-a1d6-8119e858fc0b';
const key = 'c'.repeat(40);
const admin = { username: 'researcher', passwordHash: hashPassword('a-long-test-password'),
  sessionSecret: 'session-secret-for-testing-is-long-enough' };
const batch = { batchId, participantId, submittedAt: Date.now(), items: [{
  clientId, text: 'Your account is ready [link]', predictedCategory: 'SAFE',
  reviewedCategory: 'SAFE', reviewedAt: Date.now()
}] };
const message = { message_id: messageId, message_text: '<script>private SMS</script>',
  predicted_category: 'SAFE', reviewed_category: 'SCAM',
  received_at: new Date(), reviewed_at: new Date(), verification_status: null,
  verified_label: null };
const summary = { totals: { accepted: 1, reviewed_scam: 1, reviewed_safe: 0,
  verified_scam: 0, verified_safe: 0, pending: 1, excluded: 0, participants: 1 },
  byDay: [], matrix: [], rejections: [] };
let server;
let base;
let submitted;
let reviewed;

before(async () => {
  server = createApp({ apiKey: 'r'.repeat(40), repository: { save() {} },
    communityKey: key,
    communityRepository: {
      async progress() { return { scamAccepted: 1, safeAccepted: 2 }; },
      async submit(value) { submitted = value; return {
        acceptedClientIds: [clientId], rejectedClientIds: [],
        progress: { scamAccepted: 1, safeAccepted: 3 }
      }; }
    },
    admin,
    adminRepository: { async summary() { return {}; },
      async list() { return { rows: [], total: 0, page: 1, limit: 25 }; } },
    communityAdminRepository: {
      async summary() { return summary; },
      async list() { return { rows: [message], total: 1, page: 1, limit: 25 }; },
      async get() { return message; },
      async history() { return []; },
      async review(_id, value, reviewer) { reviewed = { ...value, reviewer }; return true; },
      async exportRows() { return [message]; }
    },
    limiter: (_req, _res, next) => next() }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));

async function login() {
  const response = await fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'researcher', password: 'a-long-test-password' }) });
  assert.equal(response.status, 303);
  return response.headers.get('set-cookie').split(';')[0];
}

test('community validation rejects malformed batches and sensitive text', () => {
  assert.equal(validateCommunityBatch({ ...batch, items: [batch.items[0], batch.items[0]] }), null);
  assert.equal(validateCommunityBatch({ ...batch, extra: true }), null);
  assert.equal(contentRejection('Your OTP is 123456'), 'SENSITIVE_TEXT');
  assert.equal(contentRejection('Email me at person@example.com'), 'SENSITIVE_TEXT');
  assert.equal(contentRejection('Your account is ready [link]'), null);
});

test('community API uses its own key and returns the Android contract', async () => {
  const progressUrl = `${base}/api/community/contributions/progress?participantId=${participantId}`;
  assert.equal((await fetch(progressUrl)).status, 401);
  assert.deepEqual(await (await fetch(progressUrl, { headers: { 'X-API-Key': key } })).json(),
    { scamAccepted: 1, safeAccepted: 2 });
  const submit = (body, apiKey = key) => fetch(`${base}/api/community/contributions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(body)
  });
  assert.equal((await submit(batch, 'r'.repeat(40))).status, 401);
  assert.equal((await submit({ ...batch, items: [] })).status, 400);
  const response = await submit(batch);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { acceptedClientIds: [clientId],
    rejectedClientIds: [], progress: { scamAccepted: 1, safeAccepted: 3 } });
  assert.equal(submitted.participantId, participantId);
});

test('community analysis requires admin login and keeps text off list and CSV', async () => {
  const anonymous = await fetch(`${base}/admin/community`, { redirect: 'manual' });
  assert.equal(anonymous.status, 303);
  const cookie = await login();
  const overview = await (await fetch(`${base}/admin/community`,
    { headers: { Cookie: cookie } })).text();
  assert.ok(overview.includes('Verified Scam'));
  assert.ok(!overview.includes('private SMS'));
  const csv = await (await fetch(`${base}/admin/community/export.csv`,
    { headers: { Cookie: cookie } })).text();
  assert.ok(csv.includes('participant_reviewed_category'));
  assert.ok(!csv.includes('private SMS'));
  assert.ok(!csv.includes(participantId));
  const detail = await (await fetch(`${base}/admin/community/messages/${messageId}`,
    { headers: { Cookie: cookie } })).text();
  assert.ok(detail.includes('&lt;script&gt;private SMS&lt;/script&gt;'));
  assert.ok(!detail.includes('<script>private SMS</script>'));
});

test('community verification requires CSRF and an independent label', async () => {
  const cookie = await login();
  const detail = await (await fetch(`${base}/admin/community/messages/${messageId}`,
    { headers: { Cookie: cookie } })).text();
  const csrf = detail.match(/name="_csrf" value="([^"]+)"/)[1];
  const send = (body) => fetch(`${base}/admin/community/messages/${messageId}/review`, {
    method: 'POST', redirect: 'manual',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });
  assert.equal((await send({ status: 'VERIFIED', label: 'SCAM' })).status, 403);
  assert.equal((await send({ _csrf: csrf, status: 'VERIFIED' })).status, 400);
  assert.equal((await send({ _csrf: csrf, status: 'EXCLUDED', label: 'SAFE' })).status, 400);
  assert.equal((await send({ _csrf: csrf, status: 'VERIFIED', label: 'SCAM' })).status, 303);
  assert.deepEqual(reviewed, { status: 'VERIFIED', label: 'SCAM', notes: null,
    reviewer: 'researcher' });
});
