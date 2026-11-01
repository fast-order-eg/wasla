import { pathToFileURL } from 'node:url';
import { readConfig, publicError, retryDelay, WorkerError } from './config.mjs';
import { probeProxy, requestJson } from './network.mjs';

export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function heartbeat(config, { signal, fetchImpl = fetch, probe = probeProxy } = {}) {
  const policy = await requestJson(config, '/api/worker/config', { signal, fetchImpl });
  if (policy.networkMode !== 'mobile_primary' || policy.rotateIp !== false || policy.ipHistoryBlocks !== false ||
      policy.automaticPublishing !== false || policy.automaticPersonalMessages !== false) {
    throw new WorkerError('UNSUPPORTED_SERVER_POLICY');
  }
  const health = await probe(config.proxy, config.probeTimeoutMs, { signal });
  const body = {
    workerId: config.workerId, name: config.name,
    capabilities: ['heartbeat', 'proxy_tcp_health'],
    network: { mode: 'mobile_primary', proxyReachable: health.proxyReachable, check: health.check, configured: health.configured },
    status: health.proxyReachable === true ? 'online' : 'degraded',
  };
  const acknowledgement = await requestJson(config, '/api/worker/heartbeat', { method: 'POST', body, signal, fetchImpl });
  if (acknowledgement.ok !== true) throw new WorkerError('CLOUD_INVALID_ACKNOWLEDGEMENT');
  return { status: body.status, networkCheck: health.check, proxyReachable: health.proxyReachable };
}

export async function runWorker(config, { once = false, signal, log = console.log, wait = sleep, ...dependencies } = {}) {
  let failures = 0;
  let attempts = 0;
  while (!signal?.aborted) {
    attempts += 1;
    try {
      const result = await heartbeat(config, { ...dependencies, signal });
      failures = 0;
      log(JSON.stringify({ event: 'heartbeat', ...result }));
      if (once) return { success: true, attempts };
      await wait(config.intervalMs, signal);
    } catch (error) {
      if (signal?.aborted || publicError(error) === 'STOPPED') return { success: true, stopped: true, attempts };
      failures += 1;
      log(JSON.stringify({ event: 'worker_error', code: publicError(error), consecutiveFailures: failures }));
      const permanent = ['CLOUD_AUTH_REJECTED', 'UNSUPPORTED_SERVER_POLICY'].includes(publicError(error));
      if (once || permanent || failures >= config.maxFailures) {
        log(JSON.stringify({ event: 'worker_stopped', reason: permanent ? 'configuration_required' : 'retry_limit_reached' }));
        return { success: false, attempts };
      }
      await wait(retryDelay(failures, config.maxBackoffMs), signal);
    }
  }
  return { success: true, stopped: true, attempts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const config = readConfig();
    const result = await runWorker(config, { once: process.argv.includes('--once'), signal: controller.signal });
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ event: 'configuration_error', code: publicError(error) }));
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
