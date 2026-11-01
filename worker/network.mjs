import net from 'node:net';
import { WorkerError } from './config.mjs';

// A successful TCP connection proves only that the port accepts connections.
// It does not prove proxy authentication, Internet routing, SIM usage, or IP isolation.
export function probeProxy(proxy, timeoutMs = 3000, { signal, connect = net.createConnection } = {}) {
  if (!proxy) return Promise.resolve({ configured: false, proxyReachable: null, check: 'not_configured' });
  if (signal?.aborted) return Promise.reject(new WorkerError('STOPPED'));
  return new Promise((resolve, reject) => {
    let socket;
    let timer;
    let done = false;
    const finish = (reachable, stopped = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      socket?.destroy();
      if (stopped) reject(new WorkerError('STOPPED'));
      else resolve({ configured: true, proxyReachable: reachable, check: 'tcp_only' });
    };
    const stop = () => finish(false, true);
    signal?.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const port = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
      socket = connect({ host: proxy.hostname.replace(/^\[|\]$/g, ''), port });
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    } catch { finish(false); }
  });
}

export async function requestJson(config, path, { method = 'GET', body, signal, fetchImpl = fetch } = {}) {
  if (signal?.aborted) throw new WorkerError('STOPPED');
  const controller = new AbortController();
  let timer;
  let rejectTimeout;
  const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
  const stop = () => { controller.abort(); rejectTimeout(new WorkerError('STOPPED')); };
  signal?.addEventListener('abort', stop, { once: true });
  timer = setTimeout(() => {
    controller.abort();
    rejectTimeout(new WorkerError('CLOUD_TIMEOUT'));
  }, config.requestTimeoutMs);
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(new URL(path, config.cloudBaseUrl), {
        method, redirect: 'error', signal: controller.signal,
        headers: { 'x-worker-api-key': config.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new WorkerError('CLOUD_AUTH_REJECTED');
        throw new WorkerError('CLOUD_HTTP_FAILED');
      }
      const text = await response.text();
      if (text.length > 16384) throw new WorkerError('CLOUD_RESPONSE_TOO_LARGE');
      let value;
      try { value = JSON.parse(text); } catch { throw new WorkerError('CLOUD_INVALID_RESPONSE'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkerError('CLOUD_INVALID_RESPONSE');
      return value;
    })()]);
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    throw new WorkerError(signal?.aborted ? 'STOPPED' : 'CLOUD_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
