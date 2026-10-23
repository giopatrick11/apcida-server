import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/admin-auth.js';
import { loadConfig } from '../src/config.js';

const id = '26f654a8-2316-4f77-a88a-7fa6724a97b6';
const admin = { username: 'reviewer', passwordHash: hashPassword('a-long-test-password'),
  sessionSecret: 'session-secret-for-testing-is-long-enough' };
const snapshot = {
  report_id: id, client_report_id: null, report_type: 'Scam was not detected',
  remarks: '<script>alert(1)</script>', risk_score: 12, final_verdict: 'SAFE',
  rule_verdict: 'SAFE', ai_status: 'AVAILABLE', gemma_classification: 'LEGITIMATE',
  gemma_rationale: 'No warning', gemma_confidence: 'LOW', processing_state: 'COMPLETED',
  detected_keywords: ['verify'], app_version: '1.0', model_version: 'gemma',
  sms_text: 'private <b>SMS</b>', message_sharing_consent: true,
  received_at: new Date('2026-10-22T16:30:00Z'),
  reported_at: new Date('2026-10-22T16:30:00Z'), review_status: 'NEW'
};
const empty = { totals: { reports: 1, in_review: 0, resolved: 0, shared_sms: 1 },
  reason: [], verdict: [], ai: [], gemma: [], finding: [], day: [], keyword: [], version: [],
  findingByGemma: [], findingByKeyword: [], findingByVersion: [] };
let base;
let server;
let decision;
let listQuery;

before(async () => {
  const adminRepository = {
    async summary() { return empty; },
    async list(query) { listQuery = query; return { rows: [snapshot], total: 1, page: query.page, limit: 25 }; },
    async get() { return snapshot; },
    async history() { return [{ reviewed_at: new Date('2026-10-22T16:30:00Z'),
      review_status: 'IN_REVIEW', confirmed_label: null, finding: null, notes: null }]; },
    async review(_id, value, reviewer) { decision = { ...value, reviewer }; return true; }
  };
  server = createApp({ apiKey: 'a'.repeat(40), repository: { save() {} },
    admin, adminRepository, ready: async () => true,
    limiter: (_req, _res, next) => next(), now: () => Date.now() })
    .listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve) => server.close(resolve)));

async function login() {
  const response = await fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'reviewer', password: 'a-long-test-password' }) });
  assert.equal(response.status, 303);
  return response.headers.get('set-cookie').split(';')[0];
}

test('admin configuration requires separate complete credentials', () => {
  const env = { REPORT_API_KEY: 'x'.repeat(40), DATABASE_URL: 'postgresql://localhost/db',
    ADMIN_USERNAME: 'reviewer' };
  assert.throws(() => loadConfig(env), /ADMIN_PASSWORD_HASH/);
  assert.throws(() => loadConfig({ ...env, ADMIN_PASSWORD_HASH: admin.passwordHash }),
    /ADMIN_SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...env, ADMIN_USERNAME: ' admin ',
    ADMIN_PASSWORD_HASH: admin.passwordHash,
    ADMIN_SESSION_SECRET: admin.sessionSecret }), /ADMIN_USERNAME/);
  assert.equal(loadConfig({ REPORT_API_KEY: env.REPORT_API_KEY,
    DATABASE_URL: env.DATABASE_URL }).admin, null);
});

test('report API key alone cannot access admin pages', async () => {
  const response = await fetch(`${base}/admin`, { redirect: 'manual',
    headers: { 'X-API-Key': 'a'.repeat(40) } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/admin/login');
  const bad = await fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'reviewer', password: 'wrong-password' }) });
  assert.equal(bad.status, 401);
  const proxyOrigin = await fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null' },
    body: new URLSearchParams({ username: 'reviewer', password: 'wrong-password' }) });
  assert.equal(proxyOrigin.status, 401);
});

test('admin list excludes SMS and supports filters with bounded pagination', async () => {
  const cookie = await login();
  const response = await fetch(`${base}/admin?reason=Scam+was+not+detected&page=2&status=NEW`,
    { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('Scam was not detected'));
  assert.ok(!html.includes('private &lt;b&gt;SMS&lt;/b&gt;'));
  assert.ok(!html.includes('private <b>SMS</b>'));
  assert.ok(html.includes('Oct 23, 2026, 12:30 AM PHT'));
  assert.ok(html.includes('Received from (PHT)'));
  assert.ok(html.includes('Received by day (last 30 days, PHT)'));
  assert.equal(listQuery.page, 2);
  assert.equal(listQuery.status, 'NEW');
});

test('detail escapes user data and only shows consented SMS on detail', async () => {
  const cookie = await login();
  const response = await fetch(`${base}/admin/reports/${id}`, { headers: { Cookie: cookie } });
  const html = await response.text();
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('private &lt;b&gt;SMS&lt;/b&gt;'));
  assert.ok(html.includes('<details>'));
  assert.equal(html.split('Oct 23, 2026, 12:30 AM PHT').length - 1, 3);
});

test('review requires CSRF and validates confirmed findings', async () => {
  const cookie = await login();
  const detail = await (await fetch(`${base}/admin/reports/${id}`, { headers: { Cookie: cookie } })).text();
  const csrf = detail.match(/name="_csrf" value="([^"]+)"/)[1];
  const url = `${base}/admin/reports/${id}/review`;
  const send = (body, headers = {}) => fetch(url, { method: 'POST', redirect: 'manual',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body) });
  assert.equal((await send({ status: 'RESOLVED', label: 'SCAM' })).status, 403);
  assert.equal((await send({ _csrf: csrf, status: 'RESOLVED', label: 'LEGITIMATE',
    finding: 'MISSED_SCAM' })).status, 400);
  assert.equal((await send({ _csrf: csrf, status: 'RESOLVED', label: 'SCAM',
    finding: 'MISSED_SCAM', notes: 'Confirmed by reviewer' }, { Origin: 'null' })).status, 303);
  assert.deepEqual(decision, { status: 'RESOLVED', label: 'SCAM',
    finding: 'MISSED_SCAM', notes: 'Confirmed by reviewer', reviewer: 'reviewer' });
});

test('readiness reports database failure without revealing details', async () => {
  const response = await fetch(`${base}/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
