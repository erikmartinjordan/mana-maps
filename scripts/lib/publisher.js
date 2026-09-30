'use strict';
// ── scripts/lib/publisher.js ─
// Helpers compartidos de autenticación y escritura en Firestore (REST).
// Credenciales fuera del repo (PUBLISHER_CREDENTIALS, ~/.publisher-credentials.json
// o /Users/Erik/autopilot/.publisher-credentials.json).
const https = require('https'), fs = require('fs'), path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: options.method || 'GET', headers: options.headers || {} }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, data: d, parseError: true }); } });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

function loadADC() {
  const home = require('os').homedir();
  const candidates = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(home, '.config/gcloud/application_default_credentials.json')].filter(Boolean);
  for (const p of candidates) {
    const abs = path.resolve(p); if (!fs.existsSync(abs)) continue;
    try { const c = JSON.parse(fs.readFileSync(abs, 'utf8')); if (c.type === 'authorized_user' && c.refresh_token) return c; if (c.type === 'service_account' && c.client_email && c.private_key) return c; } catch (_) { }
  }
  return null;
}

function loadPublisherCredentials() {
  const p = process.env.PUBLISHER_CREDENTIALS;
  if (p) { const abs = path.resolve(p); if (fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs, 'utf8')); }
  try {
    const home = require('os').homedir();
    for (const cand of [home + '/.publisher-credentials.json', '/home/erik/autopilot/.publisher-credentials.json', '/Users/Erik/autopilot/.publisher-credentials.json', '/Users/erik/autopilot/.publisher-credentials.json']) {
      if (fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand, 'utf8'));
    }
  } catch (_) { }
  return null;
}

async function firebaseAuthSignIn(email, password, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const res = await httpsRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  if (res.status !== 200) throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  return { idToken: res.data.idToken, uid: res.data.localId };
}

async function getAccessToken() {
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher).');
    try { const r = await firebaseAuthSignIn(pub.email, pub.password, pub.apiKey); return { token: r.idToken, uid: r.uid }; } catch (e) { console.log('Publisher auth failed:', e.message); }
  }
  const adc = loadADC();
  if (adc && adc.refresh_token) {
    console.log('Using ADC.');
    const postData = `client_id=${encodeURIComponent(adc.client_id)}&client_secret=${encodeURIComponent(adc.client_secret)}&refresh_token=${encodeURIComponent(adc.refresh_token)}&grant_type=refresh_token`;
    const res = await httpsRequest('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, postData);
    if (res.data && res.data.access_token) return { token: res.data.access_token, uid: null };
  }
  // Anon fallback
  let apiKey = pub && pub.apiKey;
  if (!apiKey) { try { const fb = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'firebase.js'), 'utf8'); const m = fb.match(/apiKey:\s*["']([^"']+)["']/); if (m) apiKey = m[1]; } catch (_) { } }
  if (!apiKey) { console.error('ERROR: no credentials/API key'); process.exit(1); }
  const body = JSON.stringify({ returnSecureToken: true });
  const res = await httpsRequest('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  if (!res.data || !res.data.idToken) { console.error('anon auth failed:', JSON.stringify(res.data).slice(0, 300)); process.exit(1); }
  console.log('Anonymous OK uid=' + res.data.localId);
  return { token: res.data.idToken, uid: res.data.localId };
}

function firestoreRequest(token, method, urlPath, body) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
  const postData = body ? JSON.stringify(body) : null;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (postData) headers['Content-Length'] = Buffer.byteLength(postData);
  return httpsRequest(url, { method, headers }, postData);
}

// Firestore value helpers
function fsStr(v) { return v != null ? { stringValue: String(v) } : { stringValue: '' }; }
function fsInt(v) { return { integerValue: String(v) }; }
function fsBool(v) { return { booleanValue: !!v }; }
function fsArr(arr) { return { arrayValue: { values: (arr || []).map(v => { if (typeof v === 'string') return fsStr(v); if (typeof v === 'number') return fsNum(v); if (typeof v === 'boolean') return fsBool(v); return v; }) } }; }
function fsNum(v) { return Number.isInteger(v) ? fsInt(v) : { doubleValue: v }; }
function fsNull() { return { nullValue: null }; }
function fsMap(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = fsNull();
    else if (typeof v === 'string') fields[k] = fsStr(v);
    else if (typeof v === 'number') fields[k] = fsNum(v);
    else if (typeof v === 'boolean') fields[k] = fsBool(v);
    else if (Array.isArray(v)) fields[k] = fsArr(v);
    else if (typeof v === 'object') fields[k] = fsMap(v);
    else fields[k] = fsStr(String(v));
  }
  return { mapValue: { fields } };
}

module.exports = { PROJECT_ID, DATABASE, COLLECTION, getAccessToken, firestoreRequest, httpsRequest, fsStr, fsInt, fsBool, fsArr, fsNum, fsNull, fsMap };
