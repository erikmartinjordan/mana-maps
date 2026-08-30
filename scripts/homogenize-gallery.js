#!/usr/bin/env node
// ── homogenize-gallery.js ─
// Añade tags faltantes, descripciones y lang=es a los mapas de la galería.
// También borra mapas de prueba si existen.
//
// Autenticación: publisher credentials (PUBLISHER_CREDENTIALS o ~/.publisher-credentials.json)

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Auth helpers ────────────────────────────────────────────────
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

// ─── Firestore helpers ───────────────────────────────────────────
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

async function deleteMapDoc(token, slug) {
  const urlPath = `/${COLLECTION}/${slug}`;
  const res = await firestoreRequest(token, 'DELETE', urlPath);
  if (res.status >= 400) {
    throw new Error(`DELETE ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res;
}

// ─── Tags and descriptions for each map ──────────────────────────
const MAP_UPDATES = {
  'active-volcanoes-world': {
    tags: ['Naturaleza', 'Volcanes', 'Geología'],
    description: 'Volcanes activos con erupciones del Holoceno o históricas alrededor del planeta.',
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
    description: 'La montaña más alta de cada uno de los siete continentes — el reto de las Siete Cumbres.',
  },
  'longest-rivers-world': {
    tags: ['Geografía', 'Hidrografía', 'Naturaleza'],
    description: 'Los diez ríos más extensos del planeta, con sus cursos reales obtenidos de Natural Earth.',
  },
  'major-deserts-world': {
    tags: ['Geografía', 'Naturaleza', 'Clima'],
    description: 'Los 15 desiertos más grandes del planeta, desde el Sahara hasta la Antártida, con superficie y datos clave.',
  },
  'minimum-wage-by-country': {
    tags: ['Economía', 'Sociedad', 'Datos'],
    description: 'Comparación del salario mínimo anual en dólares de 162 países del mundo, con datos del Banco Mundial.',
  },
  'oceans-and-seas-world': {
    tags: ['Geografía', 'Naturaleza'],
    description: 'Los cinco océanos y trece mares y golfos principales del planeta, dibujados sobre cartografía real.',
  },
  'submarine-fiber-cables': {
    tags: ['Infraestructura', 'Tecnología', 'Telecomunicaciones'],
    description: 'Principales cables de fibra óptica submarina y sus puntos de aterrizaje publicados. Los colores indican el año de puesta en servicio.',
  },
  'worst-wildfires-world': {
    tags: ['Naturaleza', 'Desastres', 'Clima'],
    description: 'Los incendios forestales más devastadores de la historia registrada, por superficie quemada e impacto humano.',
  },
};

// Mapas de prueba a borrar (si existen)
const TEST_MAPS_TO_DELETE = [
  'j9T7rtBWYFHcG5EYku0W',
  'npH7euhfmwQU1RehAtnD',
];

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== homogenize-gallery.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);
  console.log(`Project: ${PROJECT_ID}\n`);

  const token = await getAccessToken();
  console.log('Access token obtained.\n');

  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalErrors = 0;

  // 1. Delete test maps
  console.log('── Borrando mapas de prueba ──');
  for (const slug of TEST_MAPS_TO_DELETE) {
    try {
      const doc = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
      if (doc.status === 404) {
        console.log(`  ${slug}: no existe (OK)`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  ${slug}: DRY RUN — skipping delete`);
        totalDeleted++;
        continue;
      }
      await deleteMapDoc(token, slug);
      console.log(`  ${slug}: BORRADO ✓`);
      totalDeleted++;
    } catch (e) {
      console.error(`  ${slug}: ERROR — ${e.message}`);
      totalErrors++;
    }
  }

  // 2. Update maps
  console.log('\n── Actualizando tags y descripciones ──');
  for (const [slug, updates] of Object.entries(MAP_UPDATES)) {
    console.log(`\n  ${slug}:`);

    // Get current document
    let doc;
    try {
      const res = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
      if (res.status === 404) {
        console.log('    SKIP: document not found');
        continue;
      }
      if (res.status !== 200) {
        console.error(`    ERROR reading (${res.status})`);
        totalErrors++;
        continue;
      }
      doc = res.data;
    } catch (e) {
      console.error(`    ERROR reading: ${e.message}`);
      totalErrors++;
      continue;
    }

    const currentTags = extractField(doc, 'tags');
    const currentDesc = extractField(doc, 'description');
    const currentLang = extractField(doc, 'lang');

    const updateFields = {};
    const changes = [];

    // Tags
    if (updates.tags && (!currentTags || currentTags.length === 0)) {
      updateFields.tags = fsArr(updates.tags);
      changes.push(`tags: [${updates.tags.join(', ')}]`);
    } else if (currentTags && currentTags.length > 0) {
      console.log(`    tags: ya tiene [${currentTags.join(', ')}] — SKIP`);
    }

    // Description
    if (updates.description && !currentDesc) {
      updateFields.description = fsStr(updates.description);
      changes.push(`description: "${updates.description.substring(0, 60)}..."`);
    } else if (currentDesc) {
      console.log(`    description: ya tiene — SKIP`);
    }

    // Lang
    if (currentLang !== 'es') {
      updateFields.lang = fsStr('es');
      changes.push(`lang: es`);
    } else {
      console.log(`    lang: es — OK`);
    }

    if (Object.keys(updateFields).length === 0) {
      console.log('    No changes needed');
      continue;
    }

    console.log(`    Changes: ${changes.join(', ')}`);

    if (DRY_RUN) {
      console.log('    DRY RUN — skipping write');
      totalUpdated++;
      continue;
    }

    try {
      await updateMapFields(token, slug, updateFields, doc.fields);
      console.log('    UPDATED ✓');
      totalUpdated++;
    } catch (e) {
      console.error(`    ERROR updating: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\n=== Done: ${totalUpdated} updated, ${totalDeleted} deleted, ${totalErrors} errors ===\n`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
