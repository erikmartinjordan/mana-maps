const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  withRetries,
  isRetryable,
  isQuotaExhausted,
  retryDelay,
  statusOf,
  DEFAULT_ATTEMPTS,
} = require('../../scripts/lib/firestore-retry');

const repoRoot = path.resolve(__dirname, '..', '..');

function httpError(status, body) {
  const error = new Error(`HTTP ${status}: ${body || ''}`);
  error.status = status;
  return error;
}

function recorder() {
  const delays = [];
  return {
    delays,
    sleep: async (ms) => { delays.push(ms); },
  };
}

// Los trabajos programados leen Firestore por REST: si el servicio responde 429
// o 5xx, el contenido publicado sigue siendo válido y hay que reintentar en vez
// de dejar el workflow en rojo.
test('firestore rest calls retry 429 and 5xx before giving up', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await withRetries(async () => {
    calls += 1;
    if (calls === 1) throw httpError(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}');
    if (calls === 2) throw httpError(503, 'Service Unavailable');
    return { ok: true };
  }, { sleep });

  expect(result).toEqual({ ok: true });
  expect(calls).toBe(3);
  expect(delays).toEqual([1000, 2000]);
});

test('firestore rest calls retry transient network errors', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await withRetries(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';
      throw error;
    }
    return 'ok';
  }, { sleep });

  expect(result).toBe('ok');
  expect(calls).toBe(2);
  expect(delays).toHaveLength(1);
});

test('firestore rest calls do not retry client errors', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await expect(withRetries(async () => {
    calls += 1;
    throw httpError(403, 'Missing or insufficient permissions');
  }, { sleep })).rejects.toThrow(/HTTP 403/);

  expect(calls).toBe(1);
  expect(delays).toEqual([]);
});

test('withRetries stops at the configured attempt limit and rethrows the last error', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await expect(withRetries(async () => {
    calls += 1;
    throw httpError(500, 'Internal error ' + calls);
  }, { sleep, attempts: 2 })).rejects.toThrow(/Internal error 2/);

  expect(calls).toBe(2);
  expect(delays).toEqual([1000]);
  expect(DEFAULT_ATTEMPTS).toBe(3);
});

test('quota exhaustion is detected from the 429 RESOURCE_EXHAUSTED body', () => {
  expect(isQuotaExhausted(httpError(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
  expect(isQuotaExhausted(httpError(429, '{"error":{"message":"Quota exceeded."}}'))).toBe(true);
  expect(isQuotaExhausted(httpError(429, '{"error":{"status":"OTHER"}}'))).toBe(false);
  expect(isQuotaExhausted(httpError(500, 'RESOURCE_EXHAUSTED'))).toBe(false);

  expect(statusOf(httpError(429))).toBe(429);
  expect(statusOf(new Error('HTTP 503: nope'))).toBe(503);
  expect(statusOf(new Error('boom'))).toBe(0);
  expect(isRetryable(httpError(429))).toBe(true);
  expect(isRetryable(httpError(404))).toBe(false);
});

test('retryDelay uses exponential backoff capped by maxDelayMs', () => {
  expect(retryDelay(1)).toBe(1000);
  expect(retryDelay(2)).toBe(2000);
  expect(retryDelay(3)).toBe(4000);
  expect(retryDelay(5, { maxDelayMs: 3000 })).toBe(3000);
});

// Regresión del fallo real de CI (11-11): el job «Generate Map Pages» moría en
// «Generate static landings + OG cards» cuando Firestore devolvía 429 y dejaba
// el workflow en rojo. El generador debe reintentar y, si la cuota sigue
// agotada, omitir la regeneración sin exit code 1.
test('static landings generator retries Firestore and skips cleanly on quota exhaustion', () => {
  const generator = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'tools', 'generate-map-landings.js'),
    'utf8'
  );

  expect(generator).toMatch(/require\('\.\.\/lib\/firestore-retry'\)/);
  expect(generator).toMatch(/function restGet\(url\) \{\s*return withRetries\(/);
  expect(generator).toMatch(/isQuotaExhausted\(e\)/);
  expect(generator).toMatch(/::warning::.*cuota agotada/i);
  // El único fallo que debe seguir abortando es el que no es de cuota.
  expect(generator).toMatch(/throw e;/);
});
