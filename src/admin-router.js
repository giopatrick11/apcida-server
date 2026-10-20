import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAdminAuth } from './admin-auth.js';
import { detailPage, loginPage, overviewPage } from './admin-pages.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = new Set(['IN_REVIEW', 'RESOLVED']);
const LABEL = new Set(['SCAM', 'LEGITIMATE', 'UNCERTAIN']);
const FINDING = new Set(['MISSED_SCAM', 'FALSE_ALERT', 'ANALYSIS_FAILURE', 'INCONCLUSIVE', 'OTHER']);

function parseFilters(input) {
  const query = {};
  for (const key of ['reason', 'verdict', 'ai', 'status']) {
    if (typeof input[key] === 'string' && input[key].length <= 100) query[key] = input[key];
  }
  if (query.status && !new Set(['NEW', ...STATUS]).has(query.status)) delete query.status;
  for (const key of ['from', 'to']) {
    if (typeof input[key] === 'string' && DATE.test(input[key]) &&
        Number.isFinite(Date.parse(input[key]))) query[key] = input[key];
  }
  const page = Number(input.page ?? 1);
  query.page = Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1;
  return query;
}

function parseDecision(body) {
  const status = body?.status;
  const label = body?.label || null;
  const finding = body?.finding || null;
  const notes = body?.notes?.trim() || null;
  if (!STATUS.has(status) || (label && !LABEL.has(label)) ||
      (finding && !FINDING.has(finding)) ||
      (status === 'RESOLVED' && (!label || !finding)) ||
      (status === 'IN_REVIEW' && (label || finding)) ||
      (finding === 'MISSED_SCAM' && label !== 'SCAM') ||
      (finding === 'FALSE_ALERT' && label !== 'LEGITIMATE') ||
      (finding === 'ANALYSIS_FAILURE' && status !== 'RESOLVED') ||
      (notes && notes.length > 4000)) return null;
  return { status, label, finding, notes };
}

export function createAdminRouter({ admin, repository, now = Date.now,
  loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10,
    standardHeaders: 'draft-8', legacyHeaders: false }) }) {
  const router = express.Router();
  const auth = createAdminAuth(admin, now);
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
    next();
  });
  router.use(express.urlencoded({ extended: false, limit: '8kb' }));
  router.get('/login', (req, res) => {
    if (auth.session(req)) return res.redirect('/admin');
    res.send(loginPage());
  });
  router.post('/login', loginLimiter, (req, res) => {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.sendStatus(403);
    if (!auth.login(req, res)) return res.status(401).send(loginPage('Invalid username or password.'));
    return res.redirect(303, '/admin');
  });
  router.use((req, res, next) => {
    const session = auth.session(req);
    if (!session) return res.redirect(303, '/admin/login');
    res.locals.adminSession = session;
    next();
  });
  router.use((req, res, next) => {
    if (req.method !== 'POST' || auth.csrf(req, res.locals.adminSession)) return next();
    return res.sendStatus(403);
  });
  router.post('/logout', (req, res) => {
    auth.logout(req, res);
    res.redirect(303, '/admin/login');
  });
  router.get('/', async (req, res) => {
    const query = parseFilters(req.query);
    const [summary, listed] = await Promise.all([
      repository.summary(), repository.list(query)
    ]);
    res.send(overviewPage(summary, listed, query, res.locals.adminSession));
  });
  router.get('/reports/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.sendStatus(404);
    const report = await repository.get(req.params.id);
    if (!report) return res.sendStatus(404);
    const history = await repository.history(req.params.id);
    res.send(detailPage(report, history, res.locals.adminSession));
  });
  router.post('/reports/:id/review', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.sendStatus(404);
    const decision = parseDecision(req.body);
    if (!decision) return res.status(400).send('Invalid review decision');
    const saved = await repository.review(req.params.id, decision, res.locals.adminSession.username);
    if (!saved) return res.sendStatus(404);
    res.redirect(303, `/admin/reports/${req.params.id}`);
  });
  return router;
}
