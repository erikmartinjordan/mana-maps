#!/usr/bin/env node
// ── add-legend-fields.js ─
// Añade legendKey/legendTitle/legendFormat a los documentos de Firestore
// para los mapas coropletas, de modo que la leyenda del mapa destacado use
// la clave numérica declarada en lugar de heurísticas frágiles.
//
// Mapas objetivo:
//   - minimum-wage-by-country  → legendKey = "Salario mínimo USD anual"
//   - patrimonio-unesco-por-pais → legendKey = "Sitios UNESCO"
//
// Autenticación (tres opciones, en orden de preferencia):
//   1) GOOGLE_APPLICATION_CREDENTIALS → service account JSON
//   2) PUBLISHER_CREDENTIALS → archivo JSON con { email, password, apiKey, projectId }
//      (usa Firebase Auth Identity Toolkit para obtener un ID token)
//   3) ADC (legacy credentials en ~/.config/gcloud/)
//
// Uso:  node scripts/add-legend-fields.js [--dry-run]

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Legend fields to add ────────────────────────────────────────
const LEGEND_UPDATES = {
  'minimum-wage-by-country': {
    legendKey: 'Salario mínimo USD anual',
    legendTitle: 'Salario mínimo (USD/año)',
    legendFormat: 'usd',
  },
  'patrimonio-unesco-por-pais': {
    legendKey: 'Sitios UNESCO',
    legendTitle: 'Sitios UNESCO por país',
    legendFormat: 'number',
  },
};

// ─── Auth ───────────────────────────────────────────────────────
function loadServiceAccount() {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) return null;
  try {
    const creds = JSON.parse(fs.readFileSync(path.resolve(credsPath), 'utf8'));
    if (creds.type === 'service_account' && creds.client_email && creds.private_key) return creds;
  } catch (_) {}
  return null;
}

function loadPublisherCredentials() {
  const credsPath = process.env.PUBLISHER_CREDENTIALS;
  if (!credsPath) return null;
  try { return JSON.parse(fs.readFileSync(path.resolve(credsPath), 'utf8')); }
  catch (_) { return null; }
}

function loadADC() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(require('os').homedir(), '.config/gcloud/application_default_credentials.json'),
  ].filter(Boolean);
  const legacyDir = path.join(require('os').homedir(), '.config/gcloud/legacy_credentials');
  try {
    if (fs.existsSync(legacyDir)) {
      for (const d of fs.readdirSync(legacyDir)) {
        if (!d.startsWith('.')) candidates.push(path.join(legacyDir, d, 'adc.json'));
      }
    }
  } catch (_) {}
  for (const p of candidates) {
    try {
      const creds = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
      if (creds.type === 'authorized_user' && creds.refresh_token) return creds;
    } catch (_) {}
  }
  return null;
}

async function firebaseAuthSignIn(email, password, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data.idToken;
}

function getAccessTokenFromADC(adc) {
  return new Promise((resolve, reject) => {
    const postData = `client_id=${encodeURIComponent(adc.client_id)}&client_secret=${encodeURIComponent(adc.client_secret)}&refresh_token=${encodeURIComponent(adc.refresh_token)}&grant_type=refresh_token`;
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('ADC token error: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getAccessTokenFromSA(sa) {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signInput = `${header}.${body}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signInput);
    const signature = sign.sign(sa.private_key, 'base64url');
    const jwt = `${signInput}.${signature}`;
    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('SA token error: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getAccessToken() {
  // 1. Service Account
  const sa = loadServiceAccount();
  if (sa) { console.log('Using service account.'); return getAccessTokenFromSA(sa); }
  // 2. Publisher credentials (Firebase Auth)
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher) authentication.');
    return firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
  }
  // 3. ADC (legacy credentials)
  const adc = loadADC();
  if (adc) { console.log('Using ADC (refresh_token).'); return getAccessTokenFromADC(adc); }
  console.error('ERROR: No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS, PUBLISHER_CREDENTIALS, or configure ADC.');
  process.exit(1);
}

// ─── Firestore REST helpers ──────────────────────────────────────
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function firestoreRequest(token, method, urlPath, body) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
  const postData = body ? JSON.stringify(body) : null;
  return httpsRequest(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
    }
  }, postData);
}

async function getMapDoc(token, slug) {
  const res = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`GET ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data;
}

async function updateMapFields(token, slug, fields, allExistingFields) {
  const mergedFields = { ...allExistingFields, ...fields };
  const fieldPaths = Object.keys(mergedFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const urlPath = `/${COLLECTION}/${slug}?${fieldPaths}`;
  const body = { fields: mergedFields };
  const res = await firestoreRequest(token, 'PATCH', urlPath, body);
  if (res.status >= 400) {
    throw new Error(`UPDATE ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

function fsStr(v) { return { stringValue: String(v) }; }

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== add-legend-fields.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);
  const token = await getAccessToken();
  console.log('Access token obtained.\n');

  let errors = 0;

  for (const [slug, legendFields] of Object.entries(LEGEND_UPDATES)) {
    console.log(`── ${slug} ──`);

    let doc;
    try {
      doc = await getMapDoc(token, slug);
    } catch (e) {
      console.error(`  ERROR reading: ${e.message}`);
      errors++;
      continue;
    }
    if (!doc) {
      console.log('  SKIP: document not found');
      continue;
    }

    // Build update: only add legendKey, legendTitle, legendFormat
    const updateFields = {};
    for (const [k, v] of Object.entries(legendFields)) {
      updateFields[k] = fsStr(v);
    }

    console.log(`  Fields to add: ${Object.keys(updateFields).join(', ')}`);

    if (DRY_RUN) {
      console.log('  DRY RUN — skipping write');
      continue;
    }

    try {
      await updateMapFields(token, slug, updateFields, doc.fields);
      console.log('  UPDATED ✓');
    } catch (e) {
      console.error(`  ERROR updating: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n=== Done: ${errors} errors ===\n`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
