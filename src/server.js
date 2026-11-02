import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './db.js';
import { createServices } from './domain.js';
import { createApiRouter } from './routes.js';
import { createAuth, safeEqual } from './auth.js';
import { createAssistant } from './assistant.js';
import { createMeta } from './meta.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function readConfig(env = process.env) {
  const demoMode = env.DEMO_MODE !== 'false';
  const port = Number(env.PORT || 3080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT.');
  const host = env.HOST || '127.0.0.1';
  if (demoMode && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Demo mode must bind to loopback only.');
  const origin = env.APP_ORIGIN || `http://127.0.0.1:${port}`;
  const url = new URL(origin);
  if (url.origin !== origin) throw new Error('APP_ORIGIN must be an origin without a path or trailing slash.');
  const password = demoMode ? 'demo-only' : env.ADMIN_PASSWORD;
  if (!demoMode && (typeof password !== 'string' || password.length < 16 || password === 'demo-only')) throw new Error('Production requires ADMIN_PASSWORD with at least 16 characters.');
  if (!demoMode && url.protocol !== 'https:') throw new Error('Production requires HTTPS APP_ORIGIN.');
  const driver = env.DB_DRIVER || (demoMode ? 'sqlite' : 'mysql');
  if (!['sqlite', 'mysql'].includes(driver)) throw new Error('DB_DRIVER must be sqlite or mysql.');
  if (!demoMode && driver !== 'mysql' && env.ALLOW_SQLITE_PROD !== 'true') throw new Error('Production requires MySQL; SQLite is local/demo only.');
  if (driver === 'mysql' && !env.MYSQL_URL) throw new Error('MYSQL_URL is required.');
  if (env.WORKER_API_KEY && env.WORKER_API_KEY.length < 32) throw new Error('WORKER_API_KEY must have at least 32 characters.');
  return { demoMode, port, host, origin, password, driver, filename: path.resolve(root, env.SQLITE_PATH || './data/commerce.sqlite'), mysqlUrl: env.MYSQL_URL };
}

export async function createApplication({ env = process.env, store: suppliedStore, fetchImpl } = {}) {
  const config = readConfig(env);
  const store = suppliedStore || await createStore(config);
  const assistant = createAssistant({ env: { ...env, DEMO_MODE: String(config.demoMode) }, fetchImpl });
  const services = createServices(store, { assistant });
  if (config.demoMode) await services.seedDemo();
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY === 'true') app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'Cache-Control': 'no-store' });
    if (!config.demoMode) res.set('Strict-Transport-Security', 'max-age=31536000');
    const rawHost = req.get('x-forwarded-host') || req.headers.host || '';
    const incomingHost = rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
    const originHost = new URL(config.origin).hostname.toLowerCase();
    if (config.demoMode && incomingHost && incomingHost !== originHost && incomingHost !== 'wasla-backend' && !/^(127\.0\.0\.1|localhost|::1)$/i.test(incomingHost)) return res.status(403).json({ error: 'الوضع التجريبي متاح محليًا فقط.' });
    next();
  });
  const meta = createMeta({ env: { ...env, DEMO_MODE: String(config.demoMode) }, store, services });
  app.use('/webhooks/meta', meta.router);
  app.use(express.json({ limit: '128kb' }));
  const auth = createAuth({ ...config });
  const router = express.Router();
  auth.mount(router);
  router.get('/health', (req, res) => res.json({ status: 'ok', mode: config.demoMode ? 'demo' : 'production', integrations: { meta: meta.configured ? 'configured' : 'unconfigured', ai: assistant.provider }, externalSending: false, automaticPublishing: false, database: config.driver }));
  function workerAuth(req, res, next) {
    if (!env.WORKER_API_KEY || !safeEqual(req.get('x-worker-api-key'), env.WORKER_API_KEY)) return res.status(401).json({ error: 'Worker authentication required.' });
    next();
  }
  router.get('/worker/config', workerAuth, (req, res) => res.json({ networkMode: 'mobile_primary', rotateIp: false, ipHistoryBlocks: false, automaticPublishing: false, automaticPersonalMessages: false }));
  router.post('/worker/heartbeat', workerAuth, async (req, res) => {
    const body = req.body;
    if (!body || typeof body.workerId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.workerId) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) return res.status(400).json({ error: 'Invalid worker identity.' });
    const network = body.network || {};
    if (!['online', 'degraded', 'offline'].includes(body.status)) return res.status(422).json({ error: 'Invalid worker status.' });
    const status = body.status;
    await store.put('workers', { id: body.workerId, name: body.name.trim(), capabilities: Array.isArray(body.capabilities) ? body.capabilities.filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 60)) : [], network: { mode: 'mobile_primary', proxyReachable: typeof network.proxyReachable === 'boolean' ? network.proxyReachable : null, configured: network.configured === true, check: network.check === 'tcp_only' ? 'tcp_only' : 'not_verified', publicIp: typeof network.publicIp === 'string' ? network.publicIp.slice(0, 64) : null }, status, lastSeenAt: new Date().toISOString(), rotateIp: false });
    res.json({ ok: true, serverTime: new Date().toISOString() });
  });
  router.use(auth.sameOrigin, auth.requireSession, createApiRouter(services));
  app.use('/api', router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));
  app.use(express.static(path.join(root, 'public')));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
    const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    res.status(safeStatus).json({ error: safeStatus < 500 ? err.message : 'حصل خطأ داخلي. حاول تاني أو راجع مسؤول النظام.' });
  });
  return { app, config, store, services, meta, close: () => store.close() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await createApplication();
  const server = instance.app.listen(instance.config.port, instance.config.host, () => {
    console.log(`Social Commerce Desk: ${instance.config.origin}`);
    console.log(instance.config.demoMode ? 'Local demo — password: demo-only. External sending is disabled.' : 'Production — inbound integrations only; external sending is disabled.');
  });
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await instance.meta.processPending(); } catch { console.error('Webhook processing temporarily unavailable.'); }
    finally { running = false; }
  }, 2000);
  timer.unref();
  let shuttingDown = false;
  async function stop() {
    if (shuttingDown) return; shuttingDown = true; clearInterval(timer);
    server.close(async () => { while (running) await new Promise(resolve => setTimeout(resolve, 50)); await instance.close(); process.exit(0); });
  }
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
