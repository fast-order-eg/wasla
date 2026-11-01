import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { readConfig, retryDelay, publicError, WorkerError } from '../worker/config.mjs';
import { probeProxy, requestJson } from '../worker/network.mjs';
import { heartbeat, runWorker } from '../worker/index.mjs';

const base = { CLOUD_BASE_URL: 'http://127.0.0.1:3080', ALLOW_LOCALHOST_HTTP: 'true', WORKER_API_KEY: 'test-only-worker-key-1234567890123456789' };
const policy = { networkMode: 'mobile_primary', rotateIp: false, ipHistoryBlocks: false, automaticPublishing: false, automaticPersonalMessages: false };
const response = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });

test('requires HTTPS except explicitly allowed loopback, rejects URL credentials and missing key', () => {
  assert.equal(readConfig(base).cloudBaseUrl, base.CLOUD_BASE_URL);
  assert.throws(() => readConfig({ ...base, ALLOW_LOCALHOST_HTTP: '' }), /HTTPS/);
  assert.throws(() => readConfig({ ...base, CLOUD_BASE_URL: 'http://example.com' }), /HTTPS/);
  assert.throws(() => readConfig({ ...base, CLOUD_BASE_URL: 'https://user:secret@example.com' }), /HTTPS/);
  assert.throws(() => readConfig({ ...base, WORKER_API_KEY: '' }), /WORKER_KEY/);
  assert.throws(() => readConfig({ ...base, WORKER_INTERVAL_MS: '-1' }), /INVALID_NUMERIC/);
  assert.throws(() => readConfig({ ...base, MOBILE_PROXY_URL: 'file:///secret' }), /INVALID_PROXY/);
});

test('backoff is bounded and error messages never echo unexpected upstream text', () => {
  assert.deepEqual([1, 2, 3, 20].map(n => retryDelay(n, 5000)), [1000, 2000, 4000, 5000]);
  assert.equal(publicError(new Error('secret-token https://secret@example.com')), 'WORKER_OPERATION_FAILED');
});

test('hanging cloud request has a real deadline', async () => {
  const config = { ...readConfig(base), requestTimeoutMs: 30 };
  await assert.rejects(requestJson(config, '/api/worker/config', { fetchImpl: () => new Promise(() => {}) }), /CLOUD_TIMEOUT/);
});

test('cloud request blocks redirects and sanitizes fetch failures', async () => {
  await assert.rejects(requestJson(readConfig(base), '/api/worker/config', {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      throw new Error('secret internal URL');
    },
  }), /CLOUD_UNAVAILABLE/);
});

test('TCP probe detects an actual listening port without claiming internet access', async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await probeProxy(new URL(`socks5://127.0.0.1:${server.address().port}`));
    assert.deepEqual(result, { configured: true, proxyReachable: true, check: 'tcp_only' });
    assert.deepEqual(await probeProxy(null), { configured: false, proxyReachable: null, check: 'not_configured' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('stalled TCP probe is bounded and closes its socket', async () => {
  const socket = new EventEmitter();
  let destroyed = false;
  socket.destroy = () => { destroyed = true; };
  const result = await probeProxy(new URL('socks5://127.0.0.1:1080'), 15, { connect: () => socket });
  assert.equal(result.proxyReachable, false);
  assert.equal(destroyed, true);
});

test('aborting an in-flight request stops without exposing transport details', async () => {
  const controller = new AbortController();
  const request = requestJson(readConfig(base), '/api/worker/config', {
    signal: controller.signal,
    fetchImpl: () => new Promise(() => {}),
  });
  controller.abort();
  await assert.rejects(request, /STOPPED/);
});

test('heartbeat reports missing proxy truthfully and sends no proxy credentials', async () => {
  const calls = [];
  const result = await heartbeat(readConfig(base), {
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, options });
      return response(url.pathname.endsWith('/config') ? policy : { ok: true });
    },
  });
  assert.equal(result.status, 'degraded');
  assert.equal(calls.length, 2);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.network.proxyReachable, null);
  assert.equal(payload.network.mode, 'mobile_primary');
  assert.ok(!calls[1].options.body.includes(base.WORKER_API_KEY));
});

test('server cannot enable rotation or automatic publishing through its policy', async () => {
  let probes = 0;
  await assert.rejects(heartbeat(readConfig(base), {
    fetchImpl: async () => response({ ...policy, rotateIp: true }),
    probe: async () => { probes += 1; },
  }), /UNSUPPORTED_SERVER_POLICY/);
  assert.equal(probes, 0);
});

test('worker stops after bounded retries and never logs sensitive transport error', async () => {
  const messages = [];
  const waits = [];
  const result = await runWorker({ ...readConfig(base), maxFailures: 3 }, {
    fetchImpl: async () => { throw new Error(base.WORKER_API_KEY); },
    log: message => messages.push(message), wait: async ms => waits.push(ms),
  });
  assert.deepEqual(result, { success: false, attempts: 3 });
  assert.deepEqual(waits, [1000, 2000]);
  assert.ok(!messages.join('\n').includes(base.WORKER_API_KEY));
  assert.match(messages.at(-1), /retry_limit_reached/);
});

test('authentication rejection stops immediately and shutdown performs no requests', async () => {
  const config = readConfig(base);
  const result = await runWorker(config, { log: () => {}, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(result.attempts, 1);
  const controller = new AbortController(); controller.abort();
  const stopped = await runWorker(config, { signal: controller.signal, fetchImpl: () => { throw new WorkerError('UNEXPECTED'); } });
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.attempts, 0);
});
