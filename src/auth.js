import { randomBytes, timingSafeEqual } from 'node:crypto';

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAuth({ password, demoMode, origin, now = Date.now }) {
  const sessions = new Map();
  const attempts = new Map();
  const ttl = 8 * 60 * 60 * 1000;
  const cookieName = 'commerce_session';
  const secure = new URL(origin).protocol === 'https:';
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: ttl };

  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim())
      .find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const value = token && sessions.get(token);
    if (!value || value.expires <= now()) { if (token) sessions.delete(token); return null; }
    return { token, ...value };
  }

  function sameOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'طلب من موقع مختلف غير مسموح.' });
    const reqOrigin = req.headers.origin;
    if (reqOrigin) {
      const allowed = new Set([origin]);
      try {
        const originUrl = new URL(origin);
        allowed.add(`https://${originUrl.hostname}`);
        allowed.add(`http://${originUrl.hostname}`);
        allowed.add(`https://www.${originUrl.hostname.replace(/^www\./, '')}`);
        allowed.add(`http://www.${originUrl.hostname.replace(/^www\./, '')}`);
        if (originUrl.port) {
          allowed.add(`http://${originUrl.hostname}:${originUrl.port}`);
          allowed.add(`https://${originUrl.hostname}:${originUrl.port}`);
        }
      } catch {}
      try {
        const reqHost = (req.get('x-forwarded-host') || req.headers.host || '').split(',')[0].trim().split(':')[0];
        const reqOriginHost = new URL(reqOrigin).hostname;
        if (reqHost && reqOriginHost.toLowerCase() === reqHost.toLowerCase()) {
          allowed.add(reqOrigin);
        }
      } catch {}
      if (!allowed.has(reqOrigin)) return res.status(403).json({ error: 'مصدر الطلب غير مسموح.' });
    }
    if (!req.is('application/json') && !req.is('multipart/form-data')) return res.status(415).json({ error: 'مطلوب طلب JSON أو رفع ملف.' });
    next();
  }

  function requireSession(req, res, next) {
    if (!session(req)) return res.status(401).json({ error: 'سجّل الدخول الأول.' });
    next();
  }

  function mount(router) {
    router.get('/auth/session', (req, res) => res.json({ authenticated: !!session(req), demoMode }));
    router.post('/auth/login', sameOrigin, (req, res) => {
      const key = req.ip || 'unknown';
      const time = now();
      for (const [id, attempt] of attempts) if (attempt.until <= time) attempts.delete(id);
      const attempt = attempts.get(key) || { count: 0, until: time + 15 * 60 * 1000 };
      if (attempt.count >= 10) return res.status(429).json({ error: 'محاولات كتير. جرّب بعد 15 دقيقة.' });
      if (!safeEqual(req.body?.password, password)) {
        attempt.count += 1; attempts.set(key, attempt);
        return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
      }
      attempts.delete(key);
      for (const [id, value] of sessions) if (value.expires <= time) sessions.delete(id);
      const old = session(req); if (old) sessions.delete(old.token);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { expires: time + ttl });
      res.cookie(cookieName, token, cookieOptions).json({ authenticated: true, demoMode });
    });
    router.post('/auth/logout', sameOrigin, (req, res) => {
      const current = session(req); if (current) sessions.delete(current.token);
      res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined }).json({ authenticated: false, demoMode });
    });
  }
  return { mount, requireSession, sameOrigin, session };
}
