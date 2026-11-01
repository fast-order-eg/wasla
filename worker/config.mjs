const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class WorkerError extends Error {
  constructor(code) { super(code); this.name = 'WorkerError'; this.code = code; }
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new WorkerError('INVALID_NUMERIC_SETTING');
  return number;
}

export function readConfig(env = process.env) {
  let cloud;
  try { cloud = new URL(env.CLOUD_BASE_URL || 'http://127.0.0.1:3080'); } catch { throw new WorkerError('INVALID_CLOUD_URL'); }
  const localHttp = cloud.protocol === 'http:' && LOCAL_HOSTS.has(cloud.hostname) && env.ALLOW_LOCALHOST_HTTP === 'true';
  if ((cloud.protocol !== 'https:' && !localHttp) || cloud.username || cloud.password || cloud.search || cloud.hash || cloud.pathname !== '/') {
    throw new WorkerError('CLOUD_REQUIRES_HTTPS_OR_EXPLICIT_LOCALHOST');
  }
  const apiKey = env.WORKER_API_KEY || '';
  if (apiKey.length < 32 || /[\r\n]/.test(apiKey)) throw new WorkerError('WORKER_KEY_REQUIRED_MIN_32');
  const workerId = env.WORKER_ID || 'windows-worker-1';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workerId)) throw new WorkerError('INVALID_WORKER_ID');
  let proxy = null;
  if (env.MOBILE_PROXY_URL) {
    try { proxy = new URL(env.MOBILE_PROXY_URL); } catch { throw new WorkerError('INVALID_PROXY_URL'); }
    if (!['socks5:', 'socks4:', 'http:', 'https:'].includes(proxy.protocol) || proxy.search || proxy.hash || !['', '/'].includes(proxy.pathname)) {
      throw new WorkerError('INVALID_PROXY_URL');
    }
    if (!proxy.port && !['http:', 'https:'].includes(proxy.protocol)) throw new WorkerError('PROXY_PORT_REQUIRED');
  }
  return {
    cloudBaseUrl: cloud.origin, apiKey, workerId,
    name: String(env.WORKER_NAME || 'Windows local worker').slice(0, 100),
    proxy,
    intervalMs: integer(env.WORKER_INTERVAL_MS, 30000, 1000, 3600000),
    requestTimeoutMs: integer(env.WORKER_REQUEST_TIMEOUT_MS, 10000, 100, 60000),
    probeTimeoutMs: integer(env.WORKER_PROBE_TIMEOUT_MS, 3000, 100, 30000),
    maxFailures: integer(env.WORKER_MAX_FAILURES, 5, 1, 20),
    maxBackoffMs: integer(env.WORKER_MAX_BACKOFF_MS, 60000, 1000, 300000),
  };
}

export function retryDelay(failures, maxBackoffMs = 60000) {
  return Math.min(maxBackoffMs, 1000 * 2 ** Math.max(0, Math.min(20, failures - 1)));
}

export function publicError(error) {
  return error instanceof WorkerError ? error.code : 'WORKER_OPERATION_FAILED';
}
