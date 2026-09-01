#!/usr/bin/env node
// ── homogeneize-gallery.js ─
// Lee todos los mapas publicados en Firestore, verifica tags, description, lang
// y actualiza los campos faltantes. También borra mapas de prueba.
//
// Uso:
//   node scripts/homogeneize-gallery.js [--dry-run]

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Config de mapas a actualizar ──────────────────────────────
// useReplaceTags: true → reemplaza tags por las indicadas (no merge)
const MAPS_TO_UPDATE = {
  'active-volcanoes-world': {
    tags: ['Naturaleza', 'Volcanes', 'Geología'],
  },
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912': {
    tags: ['Naturaleza', 'Oceanografía', 'Medio Ambiente'],
    description: 'Arrecifes de coral, fosas oceánicas y naufragios famosos del mundo, con datos de profundidad y ubicación.',
  },
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436': {
    tags: ['Historia', 'Arqueología', 'Geografía'],
    description: 'Ciudades perdidas y ruinas arqueológicas fascinantes de todo el mundo, desde Machu Picchu hasta Pompeya.',
  },
  'highest-peaks-per-continent': {
    tags: ['Naturaleza', 'Montañas', 'Geografía'],
  },
  'longest-rivers-world': {
    tags: ['Geografía', 'Hidrografía', 'Naturaleza'],
  },
  'major-deserts-world': {
    tags: ['Geografía', 'Naturaleza', 'Clima'],
  },
  'minimum-wage-by-country': {
    tags: ['Economía', 'Geografía'],
    useReplaceTags: true, // reemplazar tags exactas
  },
  'submarine-fiber-cables': {
    tags: ['Infraestructura', 'Tecnología', 'Geografía'],
    useReplaceTags: true,
  },
  'worst-wildfires-world': {
    tags: ['Naturaleza', 'Medio Ambiente'],
    useReplaceTags: true,
  },
};

// ─── Mapas que necesitan _manaLabelStyle en geojsonText ──────
// Solo parchea features que NO tengan _manaLabelStyle ya definido.
const LABELSTYLE_PATCH_MAPS = {
  'minimum-wage-by-country': {
    defaultStyle: {
      fontSize: 11,
      fontFamily: 'DM Sans, sans-serif',
      fontWeight: '600',
      color: '#1e293b',
      haloWidth: 3,
      haloColor: '#FFFFFF',
      placement: 'point'
    }
  },
  'submarine-fiber-cables': {
    defaultStyle: {
      fontSize: 10,
      fontFamily: 'DM Sans, sans-serif',
      fontWeight: '600',
      color: '#1e293b',
      haloWidth: 2,
      haloColor: '#FFFFFF',
      placement: 'line'
    }
  },
};

// Mapas de prueba a borrar
const TEST_MAPS_TO_DELETE = [
  'j9T7rtBWYFHcG5EYku0W',
  'npH7euhfmwQU1RehAtnD',
];

// ─── Auth helpers (reuse from translate-firestore-maps.js) ────
function loadServiceAccount() {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) return null;
  const absPath = path.resolve(credsPath);
  if (!fs.existsSync(absPath)) return null;
  const creds = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  if (creds.type === 'service_account' && creds.client_email && creds.private_key) return creds;
  return null;
}

function loadPublisherCredentials() {
  const credsPath = process.env.PUBLISHER_CREDENTIALS;
  if (credsPath) {
    const absPath = path.resolve(credsPath);
    if (fs.existsSync(absPath)) return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  }
  try {
    const home = require('os').homedir();
    for (const cand of [home + '/.publisher-credentials.json', '/home/erik/autopilot/.publisher-credentials.json', '/Users/Erik/autopilot/.publisher-credentials.json']) {
      if (fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand, 'utf8'));
    }
  } catch(_){}
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
  const sa = loadServiceAccount();
  if (sa) {
    console.log('Using service account authentication.');
    const crypto = require('crypto');
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
    return new Promise((resolve, reject) => {
      const req = https.request('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('Token error: ' + data));
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher) authentication.');
    return firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
  }

  console.error('ERROR: No credentials found.');
  process.exit(1);
}

// ─── Firestore REST helpers ──────────────────────────────────────
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

function fsStr(v) { return { stringValue: String(v) }; }
function fsArr(arr) { return { arrayValue: { values: arr.map(v => fsStr(v)) } }; }

async function listPublishedMaps(token) {
  // Query all published maps
  const urlPath = `/${COLLECTION}?orderByField=createdAt&pageSize=100`;
  // Actually, use structured query for isPublished == true
  const encodedFilter = encodeURIComponent('isPublished = true');
  const listUrl = `/${COLLECTION}?structuredQuery.where.fieldFilter.field.fieldPath=isPublished&structuredQuery.where.fieldFilter.op=EQUAL&structuredQuery.where.fieldFilter.value.booleanValue=true&structuredQuery.from.collectionId=${COLLECTION}&structuredQuery.orderBy.field.fieldPath=createdAt&structuredQuery.limit=100`;

  // Simpler: just list all docs and filter client-side
  const res = await firestoreRequest(token, 'GET', `/${COLLECTION}?pageSize=100`);
  if (res.status !== 200) throw new Error(`List maps failed (${res.status}): ${JSON.stringify(res.data)}`);

  const docs = res.data.documents || [];
  return docs.map(doc => {
    const id = doc.name.split('/').pop();
    return {
      id,
      name: extractField(doc, 'name') || extractField(doc, 'title') || '',
      title: extractField(doc, 'title') || extractField(doc, 'name') || '',
      description: extractField(doc, 'description') || '',
      lang: extractField(doc, 'lang') || '',
      tags: extractField(doc, 'tags') || [],
      isPublished: extractField(doc, 'isPublished'),
      shareMode: extractField(doc, 'shareMode') || '',
      rawDoc: doc,
    };
  });
}

async function updateMapFields(token, slug, fields, allExistingFields) {
  const mergedFields = { ...allExistingFields, ...fields };
  const fieldPaths = Object.keys(mergedFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const urlPath = `/${COLLECTION}/${slug}?${fieldPaths}`;
  const body = { fields: mergedFields };
  const res = await firestoreRequest(token, 'PATCH', urlPath, body);
  if (res.status >= 400) throw new Error(`UPDATE ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data;
}

async function deleteMap(token, slug) {
  const urlPath = `/${COLLECTION}/${slug}`;
  const res = await firestoreRequest(token, 'DELETE', urlPath);
  if (res.status >= 400) throw new Error(`DELETE ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  return true;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== homogeneize-gallery.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const token = await getAccessToken();
  console.log('Access token obtained.\n');

  // 1. List all maps
  const allMaps = await listPublishedMaps(token);
  console.log(`Found ${allMaps.length} documents in maps collection:\n`);

  // Print audit table
  console.log('SLUG | TITLE | TAGS | DESCRIPTION | LANG');
  console.log('-----|-------|------|-------------|-----');
  for (const m of allMaps) {
    const tagStr = m.tags.length > 0 ? `[${m.tags.join(', ')}]` : 'MISSING';
    const descStr = m.description ? m.description.substring(0, 50) + '...' : 'MISSING';
    const langStr = m.lang || 'MISSING';
    console.log(`${m.id} | ${m.title.substring(0, 30)} | ${tagStr} | ${descStr} | ${langStr}`);
  }
  console.log('');

  let updated = 0;
  let errors = 0;
  let deleted = 0;

  // 2. Update tags, descriptions, lang where needed
  for (const [slug, config] of Object.entries(MAPS_TO_UPDATE)) {
    const map = allMaps.find(m => m.id === slug);
    if (!map) {
      console.log(`SKIP ${slug}: not found in collection`);
      continue;
    }

    const updateFields = {};
    const currentFields = map.rawDoc.fields;

    // Tags
    if (config.tags) {
      if (config.useReplaceTags) {
        // Reemplazar tags por las indicadas (no merge)
        const currentTags = (map.tags || []).slice().sort().join(',');
        const targetTags = config.tags.slice().sort().join(',');
        if (currentTags !== targetTags) {
          updateFields.tags = fsArr(config.tags);
        }
      } else if (!map.tags || map.tags.length === 0) {
        updateFields.tags = fsArr(config.tags);
      } else if (config.tags.length > map.tags.length) {
        // Merge tags (avoid duplicates)
        const merged = [...new Set([...map.tags, ...config.tags])];
        if (merged.length > map.tags.length) {
          updateFields.tags = fsArr(merged);
        }
      }
    }

    // Description
    if (config.description && !map.description) {
      updateFields.description = fsStr(config.description);
    }

    // lang
    if (!map.lang || map.lang !== 'es') {
      updateFields.lang = fsStr('es');
    }

    if (Object.keys(updateFields).length === 0) {
      console.log(`OK ${slug}: already up to date`);
      continue;
    }

    console.log(`UPDATE ${slug}: ${Object.keys(updateFields).join(', ')}`);

    if (DRY_RUN) {
      updated++;
      continue;
    }

    try {
      await updateMapFields(token, slug, updateFields, currentFields);
      console.log(`  ✓ Updated`);
      updated++;
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`);
      errors++;
    }
  }

  // 3. Patch _manaLabelStyle in geojsonText where missing
  let patched = 0;
  for (const [slug, patchConfig] of Object.entries(LABELSTYLE_PATCH_MAPS)) {
    const map = allMaps.find(m => m.id === slug);
    if (!map) {
      console.log(`SKIP labelStyle ${slug}: not found in collection`);
      continue;
    }

    // Read the full document to get geojsonText
    const docRes = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
    if (docRes.status !== 200) {
      console.error(`  ✗ READ ${slug} failed (${docRes.status})`);
      errors++;
      continue;
    }
    const doc = docRes.data;
    const geoTextVal = extractField(doc, 'geojsonText');
    if (!geoTextVal || typeof geoTextVal !== 'string') {
      console.log(`SKIP labelStyle ${slug}: no geojsonText`);
      continue;
    }

    let geo;
    try {
      geo = JSON.parse(geoTextVal);
    } catch (e) {
      console.error(`  ✗ Parse geojsonText ${slug} failed: ${e.message}`);
      errors++;
      continue;
    }

    if (!geo.features || !Array.isArray(geo.features)) {
      console.log(`SKIP labelStyle ${slug}: no features array`);
      continue;
    }

    let missingCount = 0;
    for (const feature of geo.features) {
      if (!feature.properties) feature.properties = {};
      if (!feature.properties._manaLabelStyle) {
        feature.properties._manaLabelStyle = { ...patchConfig.defaultStyle };
        missingCount++;
      }
    }

    if (missingCount === 0) {
      console.log(`OK labelStyle ${slug}: all ${geo.features.length} features already have _manaLabelStyle`);
      continue;
    }

    console.log(`PATCH labelStyle ${slug}: adding _manaLabelStyle to ${missingCount}/${geo.features.length} features`);

    if (DRY_RUN) {
      patched++;
      continue;
    }

    try {
      const updatedGeoText = JSON.stringify(geo);
      // Check size limit (1 MiB)
      if (Buffer.byteLength(updatedGeoText, 'utf8') > 1024 * 1024) {
        console.error(`  ✗ ${slug}: updated geojsonText exceeds 1 MiB, skipping`);
        errors++;
        continue;
      }
      const currentFields = doc.fields;
      currentFields.geojsonText = fsStr(updatedGeoText);
      await updateMapFields(token, slug, { geojsonText: currentFields.geojsonText }, currentFields);
      console.log(`  ✓ Patched ${missingCount} features with _manaLabelStyle`);
      patched++;
    } catch (e) {
      console.error(`  ✗ Error patching ${slug}: ${e.message}`);
      errors++;
    }
  }

  // 4. Delete test maps
  for (const slug of TEST_MAPS_TO_DELETE) {
    const map = allMaps.find(m => m.id === slug);
    if (!map) {
      console.log(`SKIP delete ${slug}: not found`);
      continue;
    }

    console.log(`DELETE ${slug}`);

    if (DRY_RUN) {
      deleted++;
      continue;
    }

    try {
      await deleteMap(token, slug);
      console.log(`  ✓ Deleted`);
      deleted++;
    } catch (e) {
      console.error(`  ✗ Error deleting: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n=== Done: ${updated} updated, ${patched} labelStyle-patched, ${deleted} deleted, ${errors} errors ===\n`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
