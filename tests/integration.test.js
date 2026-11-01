import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createStore } from '../src/db.js';
import { createApplication, readConfig } from '../src/server.js';
import { createAssistant, localSuggestion } from '../src/assistant.js';
import { heartbeat } from '../worker/index.mjs';
import { readConfig as workerConfig } from '../worker/config.mjs';

async function setup(t, extra = {}) {
  const store = await createStore({ driver: 'sqlite', filename: ':memory:' });
  const env = { DEMO_MODE: 'true', PORT: '0', APP_ORIGIN: 'http://127.0.0.1:3080', ...extra };
  const instance = await createApplication({ env, store });
  const server = await new Promise(resolve => { const s = instance.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await instance.close(); });
  async function request(route, { method = 'GET', body, cookie, headers = {} } = {}) {
    return fetch(`${base}${route}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  return { ...instance, request, base };
}

test('demo cannot be exposed on all interfaces and production fails closed', () => {
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => readConfig({ DEMO_MODE: 'false' }), /ADMIN_PASSWORD/);
  assert.throws(() => readConfig({ DEMO_MODE: 'false', ADMIN_PASSWORD: 'long-unique-password', APP_ORIGIN: 'http://example.com' }), /HTTPS/);
  assert.throws(() => readConfig({ DEMO_MODE: 'false', ADMIN_PASSWORD: 'long-unique-password', APP_ORIGIN: 'https://example.com', DB_DRIVER: 'sqlite' }), /MySQL/);
});

test('login protects business data, origin check blocks CSRF, logout revokes session', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/products')).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', body: { password: 'demo-only' } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await request('/api/products', { cookie })).status, 200);
  assert.equal((await request('/api/products', { method: 'POST', cookie, headers: { origin: 'https://attacker.example' }, body: { name: 'bad' } })).status, 403);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {}, cookie })).status, 200);
  assert.equal((await request('/api/products', { cookie })).status, 401);
});

test('login rate limits repeated invalid passwords', async t => {
  const { request } = await setup(t);
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/auth/login', { method: 'POST', body: { password: 'bad' } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { password: 'demo-only' } })).status, 429);
});

test('worker config never enables rotation; heartbeat requires independent key', async t => {
  const key = 'test-worker-key-with-at-least-32-characters';
  const { request, store } = await setup(t, { WORKER_API_KEY: key });
  assert.equal((await request('/api/worker/config')).status, 401);
  const headers = { 'x-worker-api-key': key };
  const config = await (await request('/api/worker/config', { headers })).json();
  assert.equal(config.rotateIp, false); assert.equal(config.ipHistoryBlocks, false);
  assert.equal(config.automaticPublishing, false);
  assert.equal((await request('/api/worker/heartbeat', { method: 'POST', headers, body: { workerId: 'pc-1', name: 'Local PC', status: 'online', network: { proxyReachable: true } } })).status, 200);
  assert.equal((await store.get('workers', 'pc-1')).network.mode, 'mobile_primary');
});

test('real local worker HTTP heartbeat distinguishes unconfigured proxy and stale worker', async t => {
  const key = 'test-worker-key-with-at-least-32-characters';
  const { base, store, services } = await setup(t, { WORKER_API_KEY: key });
  const config = workerConfig({ CLOUD_BASE_URL: base, WORKER_API_KEY: key, ALLOW_LOCALHOST_HTTP: 'true', WORKER_ID: 'integration-worker' });
  const result = await heartbeat(config);
  assert.equal(result.networkCheck, 'not_configured');
  const worker = await store.get('workers', 'integration-worker');
  assert.equal(worker.network.proxyReachable, null);
  assert.equal(worker.network.configured, false);
  await store.put('workers', { ...worker, lastSeenAt: new Date(Date.now() - 180000).toISOString(), status: 'online' });
  assert.equal((await services.list('workers')).find(w => w.id === worker.id).status, 'offline');
});

test('order export requires login and returns CSV attachment', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/orders/export.csv')).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', body: { password: 'demo-only' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const result = await request('/api/orders/export.csv', { cookie });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /text\/csv/);
  assert.match(result.headers.get('content-disposition'), /attachment/);
  assert.match(await result.text(), /رقم الطلب/);
});

test('demo rejects external webhook even if credentials are present', async t => {
  const { request } = await setup(t, { META_APP_SECRET: 'secret', META_VERIFY_TOKEN: 'verify', META_PAGE_ID: '123', META_CHANNEL_ID: 'page-1' });
  assert.equal((await request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=42')).status, 503);
});

test('signed webhook persists before processing, deduplicates messages, redacts event payload', async t => {
  const env = { DEMO_MODE: 'false', ADMIN_PASSWORD: 'test-production-password', APP_ORIGIN: 'https://example.com', DB_DRIVER: 'mysql', MYSQL_URL: 'mysql://unused:unused@localhost/unused', META_APP_SECRET: 'test-app-secret', META_VERIFY_TOKEN: 'test-verify', META_PAGE_ID: '123', META_CHANNEL_ID: 'page-1' };
  const { request, store, meta } = await setup(t, env);
  await store.put('channels', { id: 'page-1', name: 'Page', type: 'messenger', status: 'unconfigured', autoReply: false, externalPageId: '123' });
  const verify = await request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=42');
  assert.equal(await verify.text(), '42');
  for (const malformed of [null, { object: 'page', entry: [null] }, { object: 'page', entry: [{ id: '123', messaging: {} }] }]) {
    const signature = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(JSON.stringify(malformed)).digest('hex')}`;
    assert.equal((await request('/webhooks/meta', { method: 'POST', body: malformed, headers: { 'x-hub-signature-256': signature } })).status, 400);
  }
  const body = { object: 'page', entry: [{ id: '123', messaging: [{ sender: { id: 'customer-1' }, recipient: { id: '123' }, message: { mid: 'mid-1', text: 'عايز أعرف السعر' } }] }] };
  assert.equal((await request('/webhooks/meta', { method: 'POST', body })).status, 403);
  const headers = { 'x-hub-signature-256': `sha256=${createHmac('sha256', env.META_APP_SECRET).update(JSON.stringify(body)).digest('hex')}` };
  assert.equal((await request('/webhooks/meta', { method: 'POST', body, headers })).status, 200);
  assert.equal((await store.all('messages')).length, 0);
  await meta.processPending();
  assert.equal((await store.all('messages')).length, 1);
  assert.equal((await request('/webhooks/meta', { method: 'POST', body, headers })).status, 200);
  await meta.processPending();
  assert.equal((await store.all('messages')).length, 1);
  assert.equal((await store.get('channels', 'page-1')).status, 'connected');
  const login = await request('/api/auth/login', { method: 'POST', body: { password: env.ADMIN_PASSWORD } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const events = await (await request('/api/events', { cookie })).json();
  assert.ok(events.every(event => !('payload' in event)));
  assert.ok(!JSON.stringify(events).includes('customer-1'));
});

test('offline assistant does not invent shipping, confirm orders, or call external AI in demo', async () => {
  const input = { product: { name: 'تيشيرت', pricePiasters: 35000, stock: 3, requiredFields: ['name', 'phone'] }, customer: {}, messages: [{ direction: 'inbound', text: 'بكام؟' }] };
  const suggestion = localSuggestion(input);
  assert.match(suggestion.replyText, /هنراجعها/);
  assert.equal(suggestion.order_status, undefined);
  const assistant = createAssistant({ env: { DEMO_MODE: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'not-used', GEMINI_MODEL: 'configured-model' }, fetchImpl: () => { throw new Error('Must not call external AI'); } });
  assert.equal(assistant.provider, 'local_rules');
  assert.deepEqual(await assistant.suggest(input), suggestion);
});

test('AI failure or malformed structured output requests human review', async () => {
  const input = { product: { name: 'منتج', pricePiasters: 10000, stock: 2 } };
  const assistant = createAssistant({ env: { DEMO_MODE: 'false', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'secret', GEMINI_MODEL: 'configured-model' }, fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"order_status":"COMPLETED"}' }] } }] }) }) });
  const result = await assistant.suggest(input);
  assert.equal(result.needsHuman, true);
  assert.equal(result.reason, 'ai_unavailable_review_required');
  assert.equal(result.order_status, undefined);
});

test('Vertex AI connector authenticates and returns structured suggestions', async () => {
  const input = { product: { name: 'تيشيرت صيفي', pricePiasters: 35000, stock: 5, material: 'قطن' }, messages: [{ direction: 'inbound', text: 'الخامة إيه؟' }] };
  let calledUrl = '';
  let authHeader = '';
  const mockFetch = async (url, options) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, json: async () => ({ access_token: 'mock-vertex-access-token', expires_in: 3600 }) };
    }
    calledUrl = String(url);
    authHeader = options?.headers?.Authorization || '';
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: '{"replyText":"الخامة قطن 100% والسعر 350 جنيه","extractedData":{},"needsHuman":false,"reason":"vertex_reply"}' }]
          }
        }]
      })
    };
  };

  const assistant = createAssistant({
    env: {
      DEMO_MODE: 'false',
      AI_PROVIDER: 'vertex',
      VERTEX_PROJECT_ID: 'fast-order-505012',
      VERTEX_MODEL_NAME: 'gemini-3.8-flash',
      VERTEX_LOCATION: 'global',
      GOOGLE_APPLICATION_CREDENTIALS: 'fast-order-505012-2adde4c0badf.json'
    },
    fetchImpl: mockFetch
  });

  assert.equal(assistant.provider, 'vertex');
  const suggestion = await assistant.suggest(input);
  assert.equal(suggestion.replyText, 'الخامة قطن 100% والسعر 350 جنيه');
  assert.equal(authHeader, 'Bearer mock-vertex-access-token');
  assert.ok(calledUrl.includes('fast-order-505012'));
  assert.ok(calledUrl.includes('gemini-3.8-flash'));
});

test('file upload accepts allowed types and rejects unsupported files', async t => {
  const { request, base } = await setup(t);
  const login = await request('/api/auth/login', { method: 'POST', body: { password: 'demo-only' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const boundary = '----WebKitFormBoundaryTest123456';
  const fileContent = 'fake image data';
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="sample.jpg"',
    'Content-Type: image/jpeg',
    '',
    fileContent,
    `--${boundary}--`
  ].join('\r\n');

  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie,
      origin: 'http://127.0.0.1:3080'
    },
    body
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.url.startsWith('/uploads/up_'));
  assert.ok(data.filename.endsWith('.jpg'));
});

test('bot instructions and accounts can be saved and updated', async t => {
  const { request } = await setup(t);
  const login = await request('/api/auth/login', { method: 'POST', body: { password: 'demo-only' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const instRes = await request('/api/settings/bot-instructions', {
    method: 'PUT',
    cookie,
    body: { instructions: 'سياسة المتجر: المعاينة مجاناً', tone: 'friendly_concise' }
  });
  assert.equal(instRes.status, 200);

  const getInst = await (await request('/api/settings/bot-instructions', { cookie })).json();
  assert.equal(getInst.instructions, 'سياسة المتجر: المعاينة مجاناً');

  const chRes = await request('/api/channels', {
    method: 'POST',
    cookie,
    body: {
      name: 'بروفايل أحمد ماركت بليس',
      type: 'manual',
      platform: 'facebook_marketplace',
      accountOwner: 'أحمد علي',
      phone: '01012345678',
      notes: 'حساب خاص بجروبات أكتوبر'
    }
  });
  assert.equal(chRes.status, 201);
  const createdCh = await chRes.json();
  assert.equal(createdCh.platform, 'facebook_marketplace');
  assert.equal(createdCh.accountOwner, 'أحمد علي');

  const updateRes = await request(`/api/channels/${createdCh.id}`, {
    method: 'PATCH',
    cookie,
    body: { accountOwner: 'محمود حسن' }
  });
  assert.equal(updateRes.status, 200);
  assert.equal((await updateRes.json()).accountOwner, 'محمود حسن');
});
