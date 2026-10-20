import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'apcida_admin';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Admin password must contain at least 12 characters');
  }
  return `scrypt:${salt}:${scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
}

function equal(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const [, salt, expected] = encoded.split(':');
  return equal(scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex'), expected);
}

export function createAdminAuth(admin, now = Date.now) {
  const sign = (data) => createHmac('sha256', admin.sessionSecret).update(data).digest('base64url');
  const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'strict',
    secure: req.secure || process.env.NODE_ENV === 'production', path: '/admin' });
  return {
    login(req, res) {
      if (req.body?.username !== admin.username ||
          !verifyPassword(req.body?.password, admin.passwordHash)) return false;
      const payload = Buffer.from(JSON.stringify({ username: admin.username,
        expires: now() + EIGHT_HOURS, csrf: randomBytes(24).toString('base64url') }))
        .toString('base64url');
      res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
        ...cookieOptions(req), maxAge: EIGHT_HOURS });
      return true;
    },
    session(req) {
      const raw = req.get('cookie')?.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!raw || raw.length > 2048) return null;
      const [payload, signature] = raw.split('.');
      if (!payload || !signature || !equal(sign(payload), signature)) return null;
      try {
        const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (value.username !== admin.username || !Number.isFinite(value.expires) ||
            value.expires <= now() || value.expires > now() + EIGHT_HOURS ||
            typeof value.csrf !== 'string') return null;
        return value;
      } catch { return null; }
    },
    csrf(req, session) {
      return equal(req.body?._csrf ?? '', session.csrf);
    },
    logout(req, res) { res.clearCookie(COOKIE, cookieOptions(req)); }
  };
}
