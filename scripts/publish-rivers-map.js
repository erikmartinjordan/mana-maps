#!/usr/bin/env node
// ── publish-rivers-map.js ─
// Genera el GeoJSON de los 10 ríos más largos del mundo a partir de
// Natural Earth 50m y publica el mapa directamente en Firestore.
//
// Autenticación: ADC (gcloud auth application-default login) o
//   GOOGLE_APPLICATION_CREDENTIALS (service account).
//
// Uso:
//   node scripts/publish-rivers-map.js [--dry-run]

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────
const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SLUG = 'longest-rivers-world';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Auth helpers (same as translate-firestore-maps.js) ──────────
function loadADC() {
  const home = require('os').homedir();
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(home, '.config/gcloud/application_default_credentials.json'),
    ...(() => {
      try {
        const legacyDir = path.join(home, '.config/gcloud/legacy_credentials');
        if (fs.existsSync(legacyDir)) {
          return fs.readdirSync(legacyDir)
            .filter(d => !d.startsWith('.'))
            .map(d => path.join(legacyDir, d, 'adc.json'));
        }
      } catch (_) {}
      return [];
    })(),
  ].filter(Boolean);

  for (const p of candidates) {
    const absPath = path.resolve(p);
    if (!fs.existsSync(absPath)) continue;
    try {
      const creds = JSON.parse(fs.readFileSync(absPath, 'utf8'));
      if (creds.type === 'authorized_user' && creds.refresh_token) return creds;
      if (creds.type === 'service_account' && creds.client_email && creds.private_key) return creds;
    } catch (_) {}
  }
  return null;
}

function loadServiceAccount() {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) return null;
  const absPath = path.resolve(credsPath);
  if (!fs.existsSync(absPath)) return null;
  const creds = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  if (creds.type === 'service_account' && creds.client_email && creds.private_key) return creds;
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
    const payload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signInput = `${header}.${body}`;
    const crypto = require('crypto');
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
          else reject(new Error('Token error: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function loadPublisherCredentials() {
  const credsPath = process.env.PUBLISHER_CREDENTIALS;
  if (!credsPath) return null;
  const absPath = path.resolve(credsPath);
  if (!fs.existsSync(absPath)) return null;
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

async function firebaseAuthSignIn(email, password, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) {
    throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return { idToken: res.data.idToken, uid: res.data.localId };
}

async function getAccessToken() {
  const sa = loadServiceAccount();
  if (sa) { console.log('Using service account.'); return { token: await getAccessTokenFromSA(sa), uid: null }; }
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher).');
    const result = await firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
    return { token: result.idToken, uid: result.uid };
  }
  const adc = loadADC();
  if (adc) { console.log('Using ADC.'); return { token: await getAccessTokenFromADC(adc), uid: null }; }
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

function fsStr(v) { return v != null ? { stringValue: String(v) } : { stringValue: '' }; }
function fsInt(v) { return { integerValue: String(v) }; }
function fsBool(v) { return { booleanValue: !!v }; }
function fsNum(v) { return Number.isInteger(v) ? fsInt(v) : { doubleValue: v }; }
function fsArr(arr) { return { arrayValue: { values: arr.map(v => (typeof v === 'string') ? fsStr(v) : v) } }; }
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

// ─── GeoJSON generation from Natural Earth ───────────────────────
async function generateGeoJSON() {
  const shapefile = require('/tmp/opencode/node_modules/shapefile');
  
  const shpPath = '/tmp/opencode/rivers_data/ne_50m_rivers_lake_centerlines.shp';
  const dbfPath = '/tmp/opencode/rivers_data/ne_50m_rivers_lake_centerlines.dbf';
  
  const features = [];
  const source = await shapefile.open(shpPath, dbfPath);
  let result = await source.read();
  while (!result.done) {
    features.push(result.value);
    result = await source.read();
  }
  
  function decodeName(raw) {
    if (!raw) return '';
    try { return Buffer.from(raw, 'latin1').toString('utf8'); } catch (e) { return raw; }
  }
  
  const targetRivers = [
    { ne_names: ['Nile'], es_name: 'Nilo', length_km: 6650, source: 'Lago Victoria, África Oriental', mouth: 'Mar Mediterráneo, Egipto', countries: 'Uganda, Sudán, Sudán del Sur, Egipto', continent: 'África' },
    { ne_names: ['Amazonas'], es_name: 'Amazonas', length_km: 6400, source: 'Nevado Mismi, Perú', mouth: 'Océano Atlántico, Brasil', countries: 'Perú, Colombia, Brasil', continent: 'Sudamérica' },
    { ne_names: ['Chang Jiang'], es_name: 'Yangtsé', length_km: 6300, source: 'Tíbet, China', mouth: 'Mar de China Oriental', countries: 'China', continent: 'Asia' },
    { ne_names: ['Mississippi'], es_name: 'Misisipi-Misuri', length_km: 6275, source: 'Lago Itasca, Minnesota, EE.UU.', mouth: 'Golfo de México, Luisiana, EE.UU.', countries: 'Estados Unidos', continent: 'Norteamérica' },
    { ne_names: ['Yenisey'], es_name: 'Yenisei-Angará', length_km: 5539, source: 'Montes Sayanes, Rusia', mouth: 'Mar de Kara, Rusia', countries: 'Mongolia, Rusia', continent: 'Asia' },
    { ne_names: ['Huang'], es_name: 'Río Amarillo', length_km: 5464, source: 'Meseta de Tíbet, China', mouth: 'Mar de Bohai, China', countries: 'China', continent: 'Asia' },
    { ne_names: ['Ob'], es_name: 'Ob-Irtysh', length_km: 5410, source: 'Montes Altái, Rusia', mouth: 'Golfo de Ob, Rusia', countries: 'China, Kazajistán, Rusia', continent: 'Asia' },
    { ne_names: ['Paraná'], es_name: 'Paraná-Río de la Plata', length_km: 4880, source: 'Serra do Mar, Brasil', mouth: 'Río de la Plata, Argentina-Uruguay', countries: 'Brasil, Paraguay, Argentina, Uruguay', continent: 'Sudamérica' },
    { ne_names: ['Congo'], es_name: 'Congo', length_km: 4700, source: 'Meseta de Lualaba, R.D. del Congo', mouth: 'Océano Atlántico', countries: 'R.D. del Congo, República del Congo', continent: 'África' },
    { ne_names: ['Amur'], es_name: 'Amur', length_km: 4444, source: 'Confluencia de Argun y Shilka, Rusia', mouth: 'Estrecho de Tartaria, Rusia', countries: 'Rusia, China, Mongolia', continent: 'Asia' }
  ];
  
  // Color ramp: dark blue (longest) → light blue (shortest)
  const colorRamp = ['#0D47A1', '#1565C0', '#1976D2', '#1E88E5', '#2196F3', '#42A5F5', '#64B5F6', '#90CAF9', '#BBDEFB', '#E3F2FD'];
  
  const geojson = { type: 'FeatureCollection', features: [] };
  
  for (let ri = 0; ri < targetRivers.length; ri++) {
    const river = targetRivers[ri];
    const matches = features.filter(f => {
      const decoded = decodeName(f.properties.name);
      return river.ne_names.some(n => decoded === n);
    });
    
    if (matches.length === 0) {
      console.error(`WARNING: No features found for ${river.ne_names[0]}`);
      continue;
    }
    
    const allCoords = [];
    for (const m of matches) {
      if (m.geometry.type === 'LineString') {
        allCoords.push(...m.geometry.coordinates);
      } else if (m.geometry.type === 'MultiLineString') {
        for (const line of m.geometry.coordinates) {
          allCoords.push(...line);
        }
      }
    }
    
    // Simplify to max ~150 points per river
    const targetPoints = 150;
    const step = Math.max(1, Math.floor(allCoords.length / targetPoints));
    const simplified = [];
    for (let i = 0; i < allCoords.length; i += step) {
      simplified.push([
        Math.round(allCoords[i][0] * 10000) / 10000,
        Math.round(allCoords[i][1] * 10000) / 10000
      ]);
    }
    // Ensure last point
    const last = allCoords[allCoords.length - 1];
    const lastS = simplified[simplified.length - 1];
    if (lastS[0] !== last[0] || lastS[1] !== last[1]) {
      simplified.push([
        Math.round(last[0] * 10000) / 10000,
        Math.round(last[1] * 10000) / 10000
      ]);
    }
    
    geojson.features.push({
      type: 'Feature',
      properties: {
        _manaName: river.es_name,
        name: river.ne_names[0],
        _manaColor: colorRamp[ri],
        _manaFillOpacity: 0.85,
        _manaWeight: 3,
        _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Ríos',
        _manaGroupId: 'rios',
        _manaLabelStyle: {
          fontSize: 11,
          fontFamily: 'Arial, sans-serif',
          fontWeight: 'bold',
          color: '#0D47A1',
          haloWidth: 3,
          haloColor: '#FFFFFF',
          placement: 'line'
        },
        'Longitud (km)': river.length_km,
        'Nacimiento': river.source,
        'Desembocadura': river.mouth,
        'Países': river.countries,
        'Continente': river.continent,
        'Description': `${river.es_name} — ${river.length_km.toLocaleString('es-ES')} km — ${river.continent}`
      },
      geometry: {
        type: 'LineString',
        coordinates: simplified
      }
    });
  }
  
  return geojson;
}

// ─── Build mapPreview for SVG thumbnail ──────────────────────────
function buildMapPreview(geojson) {
  const PREVIEW_GRID_SIZE = 8;
  let bbox = [180, 90, -180, -90];
  
  for (const f of geojson.features) {
    const coords = f.geometry.coordinates;
    for (const c of coords) {
      if (c[0] < bbox[0]) bbox[0] = c[0];
      if (c[1] < bbox[1]) bbox[1] = c[1];
      if (c[0] > bbox[2]) bbox[2] = c[0];
      if (c[1] > bbox[3]) bbox[3] = c[1];
    }
  }
  
  const previewFeatures = geojson.features.map(f => {
    const coords = f.geometry.coordinates;
    // Simplify for preview: keep every Nth point
    const maxPreviewCoords = 40;
    const step = Math.max(1, Math.floor(coords.length / maxPreviewCoords));
    const simplified = [];
    for (let i = 0; i < coords.length; i += step) {
      simplified.push(coords[i]);
    }
    if (simplified.length < 2) simplified.push(coords[coords.length - 1]);
    
    return {
      geometry: { type: 'LineString', coordinatesText: JSON.stringify(simplified) },
      color: f.properties._manaColor,
      emoji: null
    };
  });
  
  return {
    bbox,
    kind: 'geometry',
    gridSize: PREVIEW_GRID_SIZE,
    cells: null,
    features: previewFeatures
  };
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('Generating GeoJSON from Natural Earth data...');
  const geojson = await generateGeoJSON();
  console.log(`Generated ${geojson.features.length} river features`);
  
  const geojsonText = JSON.stringify(geojson);
  console.log(`GeoJSON size: ${(geojsonText.length / 1024).toFixed(1)} KB`);
  
  if (geojsonText.length > 1048576) {
    console.error('ERROR: GeoJSON exceeds 1 MiB Firestore limit');
    process.exit(1);
  }
  
  const preview = buildMapPreview(geojson);
  
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  
  const docFields = {
    id: fsStr(SLUG),
    slug: fsStr(SLUG),
    title: fsStr('Los 10 ríos más largos del mundo'),
    name: fsStr('Los 10 ríos más largos del mundo'),
    description: fsStr('Los diez ríos más extensos del planeta, con sus cursos reales obtenidos de Natural Earth. Cada río muestra longitud, nacimiento, desembocadura y países que atraviesa.'),
    lang: fsStr('es'),
    featureCount: fsInt(geojson.features.length),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => fsNum(v)) } },
      kind: fsStr('geometry'),
      gridSize: fsInt(8),
      cells: fsNull(),
      features: { arrayValue: { values: preview.features.map(pf => fsMap({
        geometry: fsMap({
          type: fsStr('LineString'),
          coordinatesText: fsStr(pf.geometry.coordinatesText)
        }),
        color: fsStr(pf.color),
        emoji: fsNull()
      })) } }
    }),
    visibility: fsStr('public'),
    shareMode: fsStr('view'),
    allowPublicEdit: fsBool(false),
    isPublished: fsBool(true),
    shareUrl: fsStr(`https://mana.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText),
    geojsonChunked: fsNull(),
    dataSource: fsStr('Natural Earth 50m rivers_lake_centerlines (naturalearthdata.com)'),
    dataDate: fsStr('2024-12-01'),
    tags: fsArr(['Geografía', 'Hidrografía', 'Naturaleza']),
    authorHandle: fsStr('maña-maps'),
    createdBy: fsStr('maña-maps'),
    ownerUid: fsStr('maña-maps'),
    createdAtMs: fsInt(now),
    updatedAtMs: fsInt(now),
    createdAt: serverNow,
    updatedAt: serverNow,
    views: fsInt(0),
    likes: fsInt(0)
  };
  
  if (DRY_RUN) {
    console.log('\n=== DRY RUN — not publishing ===');
    console.log('Document fields:');
    const fieldNames = Object.keys(docFields);
    for (const fn of fieldNames) {
      const val = docFields[fn];
      if ('stringValue' in val) console.log(`  ${fn}: "${val.stringValue.substring(0, 80)}${val.stringValue.length > 80 ? '...' : ''}"`);
      else if ('integerValue' in val) console.log(`  ${fn}: ${val.integerValue}`);
      else if ('booleanValue' in val) console.log(`  ${fn}: ${val.booleanValue}`);
      else if ('nullValue' in val) console.log(`  ${fn}: null`);
      else if ('mapValue' in val) console.log(`  ${fn}: [map]`);
      else if ('arrayValue' in val) console.log(`  ${fn}: [array ${val.arrayValue.values.length} items]`);
    }
    
    // Also write the GeoJSON to a file for reference
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'longest-rivers-world.geojson'), geojsonText);
    console.log(`\nGeoJSON saved to data/longest-rivers-world.geojson`);
    return;
  }
  
  // Authenticate
  console.log('Authenticating...');
  const token = await getAccessToken();
  
  // Check if doc already exists
  console.log(`Checking if /maps/${SLUG} exists...`);
  const existing = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  
  if (existing.status === 200) {
    console.log('Document exists. Updating...');
    // Build update with all fields
    const fieldPaths = Object.keys(docFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const urlPath = `/${COLLECTION}/${SLUG}?${fieldPaths}`;
    const res = await firestoreRequest(token, 'PATCH', urlPath, { fields: docFields });
    if (res.status >= 400) {
      console.error('Update failed:', res.status, JSON.stringify(res.data).substring(0, 500));
      process.exit(1);
    }
    console.log('Updated successfully!');
  } else {
    console.log('Creating new document...');
    const res = await firestoreRequest(token, 'POST', `/${COLLECTION}`, { fields: docFields });
    if (res.status >= 400) {
      console.error('Create failed:', res.status, JSON.stringify(res.data).substring(0, 500));
      process.exit(1);
    }
    console.log('Created successfully!');
  }
  
  // Verify
  console.log('Verifying publication...');
  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status === 200) {
    const isPublished = verify.data.fields?.isPublished?.booleanValue;
    const fc = verify.data.fields?.featureCount?.integerValue;
    console.log(`✓ isPublished: ${isPublished}, featureCount: ${fc}`);
    console.log(`✓ Gallery URL: https://mana.com/gallery/?slug=${SLUG}`);
  } else {
    console.error('Verification failed:', verify.status);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
