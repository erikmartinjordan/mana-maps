#!/usr/bin/env node
// ── homogenize-gallery-v2.js ─
// Actualiza tags, descripciones y lang en Firestore sin enviar campos pesados.

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const DRY_RUN = process.argv.includes('--dry-run');

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

async function getAccessToken() {
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher) authentication.');
    return firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
  }
  console.error('ERROR: No credentials found.');
  process.exit(1);
}

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

// Send only changed fields + required auth fields
async function updateMapFieldsMinimal(token, slug, fields, allExistingFields) {
  // Build merged fields but only send the ones we're changing + auth-critical fields
  const authFields = ['createdBy', 'ownerUid', 'authorHandle'];
  const mergedFields = {};
  
  // Always include auth fields from existing document
  for (const f of authFields) {
    if (allExistingFields[f]) {
      mergedFields[f] = allExistingFields[f];
    }
  }
  
  // Add our changes
  for (const [k, v] of Object.entries(fields)) {
    mergedFields[k] = v;
  }
  
  const fieldPaths = Object.keys(mergedFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const urlPath = `/${COLLECTION}/${slug}?${fieldPaths}`;
  const body = { fields: mergedFields };
  const res = await firestoreRequest(token, 'PATCH', urlPath, body);
  if (res.status >= 400) {
    throw new Error(`UPDATE ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

// Also try with ALL fields (like translate script does)
async function updateMapFieldsFull(token, slug, fields, allExistingFields) {
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
  console.log(`\n=== homogenize-gallery-v2.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const token = await getAccessToken();
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

    // Try minimal update first (only changed fields + auth fields)
    try {
      await updateMapFieldsMinimal(token, slug, updateFields, doc.fields);
      console.log('  UPDATED (minimal) ✓');
      totalUpdated++;
      continue;
    } catch (e) {
      console.log(`  Minimal update failed: ${e.message.substring(0, 120)}`);
    }

    // Try full update (all fields, like translate script)
    try {
      await updateMapFieldsFull(token, slug, updateFields, doc.fields);
      console.log('  UPDATED (full) ✓');
      totalUpdated++;
      continue;
    } catch (e) {
      console.error(`  Full update also failed: ${e.message.substring(0, 120)}`);
      totalErrors++;
    }
  }

  console.log(`\n=== Done: ${totalUpdated} updated, ${totalErrors} errors ===\n`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
