import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { validateReport } from './validation.js';
import { createAdminRouter } from './admin-router.js';
import { validateCommunityBatch, validParticipantId } from './community-validation.js';

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

function matchesKey(candidate, expected) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({ apiKey, repository, admin = null, adminRepository = null,
  communityKey = null, communityRepository = null, communityAdminRepository = null,
  ready = null, now = Date.now,
  limiter = rateLimit({ windowMs: 60_000, limit: 60,
    standardHeaders: 'draft-8', legacyHeaders: false }) }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // A consented batch can contain up to 40 edited messages.
  app.use('/api/community', express.json({ limit: '512kb', strict: true }));
  app.use(express.json({ limit: '32kb', strict: true }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    if (!ready) return res.status(503).json({ status: 'unavailable' });
    try {
      await ready();
      return res.json({ status: 'ok' });
    } catch {
      return res.status(503).json({ status: 'unavailable' });
    }
  });

  if (admin && adminRepository) {
    app.use('/admin', createAdminRouter({ admin, repository: adminRepository,
      communityRepository: communityAdminRepository, now }));
  }

  const communityAvailable = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!communityKey || !communityRepository) {
      return res.status(503).json({ message: 'Community contributions are unavailable' });
    }
    next();
  };
  const communityAuth = (req, res, next) => {
    if (!matchesKey(req.get('X-API-Key'), communityKey)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    next();
  };

  app.get('/api/community/contributions/progress', limiter, communityAvailable,
    communityAuth, async (req, res) => {
      if (!validParticipantId(req.query.participantId)) {
        return res.status(400).json({ message: 'Invalid participant ID' });
      }
      try {
        return res.json(await communityRepository.progress(req.query.participantId));
      } catch (error) {
        console.error('Community progress failed', error?.code ?? error?.name ?? 'Error');
        return res.status(503).json({ message: 'Community storage unavailable' });
      }
    });

  app.post('/api/community/contributions', limiter, communityAvailable,
    communityAuth, async (req, res) => {
      const batch = validateCommunityBatch(req.body, now());
      if (!batch) return res.status(400).json({ message: 'Invalid contribution batch' });
      try {
        return res.json(await communityRepository.submit(batch));
      } catch (error) {
        if (error?.code === 'COMMUNITY_BATCH_CONFLICT') {
          return res.status(409).json({ message: 'Batch ID conflict' });
        }
        console.error('Community submission failed', error?.code ?? error?.name ?? 'Error');
        return res.status(503).json({ message: 'Community storage unavailable' });
      }
    });

  app.post('/api/reports/submit', limiter, async (req, res) => {
    if (!matchesKey(req.get('X-API-Key'), apiKey)) {
      return res.status(401).json({ success: false,
        message: 'Invalid credentials', reportId: null });
    }

    const timestamp = req.get('X-Timestamp');
    const requestTime = timestamp && /^\d{13}$/.test(timestamp)
      ? Number(timestamp) : NaN;
    if (!Number.isSafeInteger(requestTime) ||
        Math.abs(now() - requestTime) > TIMESTAMP_WINDOW_MS) {
      return res.status(401).json({ success: false,
        message: 'Invalid or stale timestamp', reportId: null });
    }

    const result = validateReport(req.body, now());
    if (result.error) {
      return res.status(400).json({ success: false,
        message: result.error, reportId: null });
    }

    try {
      const stored = await repository.save(result.value);
      return res.status(stored.created ? 201 : 200).json({
        success: true,
        message: stored.created ? 'Report received' : 'Report already received',
        reportId: stored.reportId
      });
    } catch (error) {
      if (error?.code === 'REPORT_ID_CONFLICT') {
        return res.status(409).json({ success: false,
          message: 'Report ID already used for different content', reportId: null });
      }
      // Do not log request bodies, credentials, or database connection details.
      console.error('Report storage failed', error?.code ?? error?.name ?? 'Error');
      return res.status(503).json({ success: false,
        message: 'Report storage unavailable', reportId: null });
    }
  });

  app.use((error, _req, res, _next) => {
    const tooLarge = error?.type === 'entity.too.large';
    const malformed = error instanceof SyntaxError && 'body' in error;
    if (tooLarge || malformed) {
      return res.status(tooLarge ? 413 : 400).json({ success: false,
        message: tooLarge ? 'Request body too large' : 'Malformed JSON',
        reportId: null });
    }
    console.error('Request handling failed', error?.name ?? 'Error');
    return res.status(500).json({ success: false,
      message: 'Internal server error', reportId: null });
  });

  return app;
}
