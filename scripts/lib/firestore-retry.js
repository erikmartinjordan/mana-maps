'use strict';
// ── scripts/lib/firestore-retry.js ─
// Reintentos con backoff para las lecturas REST de Firestore que hacen los
// trabajos programados (landings estáticas + OG cards).
//
// Firestore devuelve 429 RESOURCE_EXHAUSTED cuando se agota/satura la cuota del
// proyecto y 5xx cuando el servicio está degradado. Ninguno de esos dos casos
// indica que el contenido publicado sea inválido: lo correcto es reintentar un
// par de veces y, si la cuota sigue agotada, omitir la regeneración de esa
// ejecución en lugar de dejar el workflow en rojo todos los días.
//
// La lógica es pura (sin red) para poder testearla.

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 8000;

function statusOf(error) {
  if (!error) return 0;
  if (typeof error.status === 'number') return error.status;
  if (typeof error.statusCode === 'number') return error.statusCode;
  const match = String(error.message || '').match(/HTTP\s+(\d{3})/i);
  return match ? Number(match[1]) : 0;
}

// Un error sin status HTTP pero con `code` es de red (ECONNRESET, ENOTFOUND,
// ETIMEDOUT…): también merece un reintento.
function isRetryable(error) {
  const status = statusOf(error);
  if (!status) return Boolean(error && error.code);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// 429 con cuerpo RESOURCE_EXHAUSTED = cuota agotada, no un pico momentáneo.
// Reintentar puede servir si el límite es por minuto; si no, el trabajo se
// omite sin romper el CI (ver generate-map-landings.js).
function isQuotaExhausted(error) {
  if (statusOf(error) !== 429) return false;
  return /RESOURCE_EXHAUSTED|quota exceeded/i.test(String((error && error.message) || ''));
}

function retryDelay(attempt, options) {
  const opts = Object.assign(
    { baseDelayMs: DEFAULT_BASE_DELAY_MS, maxDelayMs: DEFAULT_MAX_DELAY_MS },
    options || {}
  );
  const exponent = Math.max(0, Number(attempt) - 1);
  return Math.min(opts.maxDelayMs, opts.baseDelayMs * Math.pow(2, exponent));
}

async function withRetries(fn, options) {
  const opts = Object.assign({ attempts: DEFAULT_ATTEMPTS }, options || {});
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = Math.max(1, Number(opts.attempts) || DEFAULT_ATTEMPTS);

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) throw error;
      await sleep(retryDelay(attempt, opts));
    }
  }
  throw lastError;
}

module.exports = {
  DEFAULT_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  statusOf,
  isRetryable,
  isQuotaExhausted,
  retryDelay,
  withRetries,
};
