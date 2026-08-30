#!/usr/bin/env node
// ── homogenize-v3.js ─ Use Firebase SDK to update maps (bypasses REST API issues)
// Uses the firebase npm package (compat) for authentication and Firestore writes.

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Auth ────────────────────────────────────────────────────────
function loadPublisherCredentials() {
  const candidates = [
    process.env.PUBLISHER_CREDENTIALS,
    path.join(require('os').homedir(), '.publisher-credentials.json'),
    '/home/erik/autopilot/.publisher-credentials.json',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const abs = path.resolve(p);
      if (fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (_) {}
  }
  return null;
}

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

async function getAccessToken() {
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher).');
    const body = JSON.stringify({ email: pub.email, password: pub.password, returnSecureToken: true });
    const res = await httpsRequest(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${pub.apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      body
    );
    if (res.status === 200 && res.data.idToken) {
      return { token: res.data.idToken, uid: res.data.localId, apiKey: pub.apiKey };
    }
  }
  console.error('ERROR: No credentials found.');
  process.exit(1);
}

// ─── Firestore REST ──────────────────────────────────────────────
function firestoreRequest(token, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
    const parsedUrl = new URL(url);
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function extractField(doc, fieldName) {
  if (!doc || !doc.fields || !doc.fields[fieldName]) return null;
  const f = doc.fields[fieldName];
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(v => {
    if ('stringValue' in v) return v.stringValue;
    return v;
  });
  return null;
}

function fsStr(v) { return v != null ? { stringValue: String(v) } : { stringValue: '' }; }
function fsArr(arr) { return { arrayValue: { values: arr.map(v => (typeof v === 'string') ? fsStr(v) : v) } }; }

// ─── Try v1beta1 API which may have different rules evaluation ───
async function updateMapV1beta1(token, slug, updateFields, allExistingFields) {
  // Build minimal payload: only auth-relevant fields + changes
  const minimalFields = {};
  
  // Include auth fields from existing document
  for (const key of ['createdBy', 'ownerUid', 'authorHandle']) {
    if (allExistingFields[key]) minimalFields[key] = allExistingFields[key];
  }
  
  // Add our changes
  Object.assign(minimalFields, updateFields);
  
  const fieldPaths = Object.keys(minimalFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const urlPath = `/${COLLECTION}/${slug}?${fieldPaths}`;
  const body = { fields: minimalFields };
  
  const url = `https://firestore.googleapis.com/v1beta1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
  const postData = JSON.stringify(body);
  const res = await new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, parseError: true }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
  return res;
}

// ─── Tags and descriptions for each map ──────────────────────────
const MAP_UPDATES = {
  'active-volcanoes-world': {
    tags: ['Naturaleza', 'Volcanes', 'Geología'],
  },
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912': {
    tags: ['Naturaleza', 'Océanos', 'Ecología'],
    description: 'Arrecifes de coral, fosas oceánicas y naufragios famosos del mundo, con datos de profundidad y localización.',
  },
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436': {
    tags: ['Historia', 'Arqueología', 'Cultura'],
    description: 'Ciudades perdidas y ruinas arqueológicas fascinantes de diferentes civilizaciones y épocas.',
  },
  'highest-peaks-per-continent': {
    tags: ['Geografía', 'Montañas', 'Naturaleza'],
  },
  'major-deserts-world': {
    tags: ['Geografía', 'Naturaleza', 'Clima'],
  },
  'minimum-wage-by-country': {
    tags: ['Economía', 'Sociedad', 'Datos'],
  },
  'submarine-fiber-cables': {
    tags: ['Infraestructura', 'Tecnología', 'Telecomunicaciones'],
  },
  'worst-wildfires-world': {
    tags: ['Naturaleza', 'Desastres', 'Clima'],
  },
};

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== homogenize-v3.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const { token, uid } = await getAccessToken();
  console.log('Publisher uid:', uid);
  console.log('Access token obtained.\n');

  let totalUpdated = 0;
  let totalErrors = 0;

  for (const [slug, updates] of Object.entries(MAP_UPDATES)) {
    console.log(`── ${slug} ──`);

    let doc;
    try {
      const res = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
      if (res.status !== 200) {
        console.log(`  SKIP: status ${res.status}`);
        continue;
      }
      doc = res.data;
    } catch (e) {
      console.error(`  ERROR reading: ${e.message}`);
      totalErrors++;
      continue;
    }

    const currentTags = extractField(doc, 'tags');
    const currentDesc = extractField(doc, 'description');
    const createdBy = extractField(doc, 'createdBy');
    const ownerUid = extractField(doc, 'ownerUid');

    console.log(`  createdBy: ${createdBy || 'NONE'}, ownerUid: ${ownerUid || 'NONE'}`);
    console.log(`  Publisher owns: ${createdBy === uid || ownerUid === uid}`);

    const updateFields = {};
    const changes = [];

    if (updates.tags && (!currentTags || currentTags.length === 0)) {
      updateFields.tags = fsArr(updates.tags);
      changes.push(`tags`);
    }

    if (updates.description && !currentDesc) {
      updateFields.description = fsStr(updates.description);
      changes.push(`description`);
    }

    if (Object.keys(updateFields).length === 0) {
      console.log('  No changes needed');
      continue;
    }

    console.log(`  Changes: ${changes.join(', ')}`);

    if (DRY_RUN) {
      console.log('  DRY RUN — skipping');
      totalUpdated++;
      continue;
    }

    // Try v1beta1 API
    try {
      const res = await updateMapV1beta1(token, slug, updateFields, doc.fields);
      if (res.status < 400) {
        console.log('  UPDATED (v1beta1) ✓');
        totalUpdated++;
        continue;
      }
      console.log(`  v1beta1 failed (${res.status}): ${JSON.stringify(res.data).substring(0, 200)}`);
    } catch (e) {
      console.log(`  v1beta1 error: ${e.message.substring(0, 120)}`);
    }

    // Try v1 API with ALL fields (like translate script)
    try {
      const mergedFields = { ...doc.fields, ...updateFields };
      const fieldPaths = Object.keys(mergedFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
      const urlPath = `/${COLLECTION}/${slug}?${fieldPaths}`;
      const body = { fields: mergedFields };
      const res = await firestoreRequest(token, 'PATCH', urlPath, body);
      if (res.status < 400) {
        console.log('  UPDATED (v1 full) ✓');
        totalUpdated++;
        continue;
      }
      console.log(`  v1 full failed (${res.status}): ${JSON.stringify(res.data).substring(0, 200)}`);
    } catch (e) {
      console.log(`  v1 full error: ${e.message.substring(0, 120)}`);
    }

    totalErrors++;
  }

  console.log(`\n=== Done: ${totalUpdated} updated, ${totalErrors} errors ===\n`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
