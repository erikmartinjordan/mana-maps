#!/usr/bin/env node
// ── publish-idh-world.js ─
// Mapa coroplético: Índice de Desarrollo Humano (IDH) por País
// Fuente: UNDP Human Development Report 2025 — HDR25 (datos 2023)
// Rampa secuencial monocromática verde claro→oscuro por valor IDH
// Geometrías Natural Earth 110m + 50m simplificadas
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SLUG = 'indice-desarrollo-humano-por-pais';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Auth helpers ──────────────────────────────────────────────
function loadADC() {
  const home = require('os').homedir();
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(home, '.config/gcloud/application_default_credentials.json'),
    ...(() => { try { const d = path.join(home, '.config/gcloud/legacy_credentials'); if (fs.existsSync(d)) return fs.readdirSync(d).filter(x => !x.startsWith('.')).map(x => path.join(d, x, 'adc.json')); } catch (_) { } return []; })(),
  ].filter(Boolean);
  for (const p of candidates) { const abs = path.resolve(p); if (!fs.existsSync(abs)) continue; try { const c = JSON.parse(fs.readFileSync(abs, 'utf8')); if (c.type === 'authorized_user' && c.refresh_token) return c; if (c.type === 'service_account' && c.client_email && c.private_key) return c; } catch (_) { } }
  return null;
}
function loadServiceAccount() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS; if (!p) return null;
  const abs = path.resolve(p); if (!fs.existsSync(abs)) return null;
  const c = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (c.type === 'service_account' && c.client_email && c.private_key) return c; return null;
}
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: options.method || 'GET', headers: options.headers || {} }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, data: d, parseError: true }); } });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
function getAccessTokenFromADC(adc) {
  return new Promise((resolve, reject) => {
    const postData = `client_id=${encodeURIComponent(adc.client_id)}&client_secret=${encodeURIComponent(adc.client_secret)}&refresh_token=${encodeURIComponent(adc.refresh_token)}&grant_type=refresh_token`;
    const req = https.request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const p = JSON.parse(d); if (p.access_token) resolve(p.access_token); else reject(new Error('ADC token error: ' + d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(postData); req.end();
  });
}
function getAccessTokenFromSA(sa) {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signInput = `${header}.${body}`;
    const crypto = require('crypto'); const sign = crypto.createSign('RSA-SHA256'); sign.update(signInput);
    const signature = sign.sign(sa.private_key, 'base64url');
    const jwt = `${signInput}.${signature}`;
    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;
    const req = https.request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const p = JSON.parse(d); if (p.access_token) resolve(p.access_token); else reject(new Error('Token error: ' + d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(postData); req.end();
  });
}
function loadPublisherCredentials() {
  const p = process.env.PUBLISHER_CREDENTIALS;
  if (p) { const abs = path.resolve(p); if (fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs, 'utf8')); }
  try {
    const home = require('os').homedir();
    const fallback = home + '/.publisher-credentials.json';
    const alt = '/home/erik/autopilot/.publisher-credentials.json';
    for (const cand of [fallback, alt, '/Users/Erik/autopilot/.publisher-credentials.json', '/Users/erik/autopilot/.publisher-credentials.json']) {
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
  const sa = loadServiceAccount(); if (sa) { console.log('Using service account.'); return { token: await getAccessTokenFromSA(sa), uid: null }; }
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher).');
    try { const r = await firebaseAuthSignIn(pub.email, pub.password, pub.apiKey); return { token: r.idToken, uid: r.uid }; } catch (e) { console.log('Publisher auth failed:', e.message, '-> trying ADC'); }
  }
  const adc = loadADC();
  if (adc) { try { console.log('Using ADC.'); return { token: await getAccessTokenFromADC(adc), uid: null }; } catch (e) { console.log('ADC failed:', e.message); } }
  console.log('Trying anonymous auth...');
  let apiKey = null;
  try { const pub2 = loadPublisherCredentials(); if (pub2 && pub2.apiKey) apiKey = pub2.apiKey; } catch (_) { }
  if (!apiKey) { try { const fb = fs.readFileSync('js/firebase.js', 'utf8'); const m = fb.match(/apiKey:\s*["']([^"']+)["']/); if (m) apiKey = m[1]; } catch (_) { } }
  if (!apiKey) { try { const home = require('os').homedir(); const pub3 = JSON.parse(fs.readFileSync(home + '/autopilot/.publisher-credentials.json', 'utf8')); apiKey = pub3.apiKey; } catch (_) { } }
  if (!apiKey) { console.error('ERROR: No API_KEY'); process.exit(1); }
  const anon = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ returnSecureToken: true });
    const req = https.request('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); if (j.idToken) resolve(j); else reject(new Error('anon failed:' + d.slice(0, 400))); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
  console.log('Anonymous OK uid=' + anon.localId);
  return { token: anon.idToken, uid: anon.localId };
}
function firestoreRequest(token, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
    const u = new URL(url);
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, data: d, parseError: true }); } });
    });
    req.on('error', reject); if (postData) req.write(postData); req.end();
  });
}
function fsStr(v) { return v != null ? { stringValue: String(v) } : { stringValue: '' }; }
function fsInt(v) { return { integerValue: String(v) }; }
function fsBool(v) { return { booleanValue: !!v }; }
function fsNum(v) { return Number.isInteger(v) ? fsInt(v) : { doubleValue: v }; }
function fsArr(arr) { return { arrayValue: { values: arr.map(v => (typeof v === 'string') ? fsStr(v) : v) } }; }
function fsNull() { return { nullValue: null }; }
function fsMap(obj) { const fields = {}; for (const [k, v] of Object.entries(obj)) { if (v === null || v === undefined) fields[k] = fsNull(); else if (typeof v === 'string') fields[k] = fsStr(v); else if (typeof v === 'number') fields[k] = fsNum(v); else if (typeof v === 'boolean') fields[k] = fsBool(v); else if (Array.isArray(v)) fields[k] = fsArr(v); else if (typeof v === 'object') fields[k] = fsMap(v); else fields[k] = fsStr(String(v)); } return { mapValue: { fields } }; }

// ── HDI country name → Natural Earth ADMIN name mapping ──
const HDI_TO_NE = {
  'Türkiye': 'Turkey',
  'Viet Nam': 'Vietnam',
  'Lao PDR': 'Laos',
  "Lao People's Democratic Republic": 'Laos',
  'Syrian Arab Republic': 'Syria',
  'Czechia': 'Czech Republic',
  'Türkiye': 'Turkey',
  'Russian Federation': 'Russia',
  'Iran (Islamic Republic of)': 'Iran',
  'Republic of Korea': 'South Korea',
  "Democratic People's Republic of Korea": 'North Korea',
  'Egypt': 'Egypt',
  'Egypt, Arab Rep.': 'Egypt',
  'Bolivia (Plurinational State of)': 'Bolivia',
  'Venezuela (Bolivarian Republic of)': 'Venezuela',
  'Tanzania, United Republic of': 'Tanzania',
  'Moldova, Republic of': 'Moldova',
  'Micronesia (Fed. States of)': 'Micronesia',
  'Brunei Darussalam': 'Brunei',
  'Timor-Leste': 'East Timor',
  'Cabo Verde': 'Cape Verde',
  'North Macedonia': 'Macedonia',
  'Eswatini': 'eSwatini',
  'Congo, Dem. Rep.': 'Democratic Republic of the Congo',
  'Congo, Rep.': 'Republic of the Congo',
  'Dominican Republic': 'Dominican Republic',
  'Trinidad and Tobago': 'Trinidad and Tobago',
  'Equatorial Guinea': 'Equatorial Guinea',
  'Central African Republic': 'Central African Republic',
  'United States of America': 'United States of America',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'United States': 'United States of America',
  'Korea, Rep.': 'South Korea',
  'Korea, Dem. People\'s Rep.': 'North Korea',
  'Hong Kong, China (SAR)': 'Hong Kong',
  'China': 'China',
  'Côte d\'Ivoire': "Côte d'Ivoire",
  'Ivory Coast': "Côte d'Ivoire",
  'Gambia': 'Gambia',
  'The Gambia': 'Gambia',
  'São Tomé and Príncipe': 'São Tomé and Príncipe',
  'West Bank and Gaza': 'West Bank',
  'State of Palestine': 'West Bank',
  'Yemen, Rep.': 'Yemen',
  'Yemen': 'Yemen',
  'Kyrgyz Republic': 'Kyrgyzstan',
  'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  "Dem. People's Rep. Korea": 'North Korea',
  'Lao PDR': 'Laos',
  'Brunei Darussalam': 'Brunei',
  'North Macedonia': 'Macedonia',
  'Czech Republic': 'Czech Republic',
  'Slovak Republic': 'Slovakia',
  'Puerto Rico': 'Puerto Rico',
  'Turks and Caicos Islands': 'Turks and Caicos Islands',
  'Virgin Islands (U.S.)': 'United States Virgin Islands',
  'Cayman Islands': 'Cayman Islands',
  'Channel Islands': 'Guernsey',
  'Isle of Man': 'Isle of Man',
  'Monaco': 'Monaco',
  'San Marino': 'San Marino',
  'Andorra': 'Andorra',
  'Liechtenstein': 'Liechtenstein',
  'Guam': 'Guam',
  'New Caledonia': 'New Caledonia',
  'Kosovo': 'Kosovo',
};

const CONTINENT_ES = { Africa: 'África', Asia: 'Asia', Europe: 'Europa', 'North America': 'América del Norte', 'South America': 'América del Sur', Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano' };

// Rampa secuencial monocromática verde claro→oscuro por IDH
const RAMP = [
  { max: 0.400, color: '#f7fcf5' },
  { max: 0.500, color: '#d5efcf' },
  { max: 0.550, color: '#a1d99b' },
  { max: 0.600, color: '#74c476' },
  { max: 0.650, color: '#41ab5d' },
  { max: 0.700, color: '#238b45' },
  { max: 0.800, color: '#006d2c' },
  { max: 1.001, color: '#00441b' },
];
function colorForHDI(hdi) {
  if (hdi == null || isNaN(hdi)) return '#d9d9d9';
  for (const s of RAMP) if (hdi <= s.max) return s.color;
  return RAMP[RAMP.length - 1].color;
}

function hdiCategory(hdi) {
  if (hdi >= 0.800) return 'Muy alto desarrollo humano';
  if (hdi >= 0.700) return 'Alto desarrollo humano';
  if (hdi >= 0.550) return 'Desarrollo humano medio';
  return 'Bajo desarrollo humano';
}

function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && maxRedirects > 0) {
        return fetchUrl(res.headers.location, maxRedirects - 1).then(resolve, reject);
      }
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── Parse xlsx using XLSX npm package ──────────────────────
function parseHDIExcel(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const result = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rank = parseInt(row[0]);
    if (isNaN(rank) || rank < 1) continue;
    const country = String(row[1] || '').trim();
    const hdi = parseFloat(row[2]);
    const lifeExpect = parseFloat(row[4]);
    const expectedSchooling = parseFloat(row[6]);
    const meanSchooling = parseFloat(row[8]);
    const gni = parseFloat(row[10]);

    if (!country || isNaN(hdi)) continue;

    result.push({
      rank,
      country,
      hdi: isNaN(hdi) ? null : hdi,
      lifeExpect: isNaN(lifeExpect) ? null : lifeExpect,
      expectedSchooling: isNaN(expectedSchooling) ? null : expectedSchooling,
      meanSchooling: isNaN(meanSchooling) ? null : meanSchooling,
      gni: isNaN(gni) ? null : Math.round(gni),
    });
  }
  return result;
}

// ── Build GeoJSON ────────────────────────────────────────────
async function buildGeoJSON() {
  // Download HDI Excel
  const xlsxUrl = 'https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Statistical_Annex_HDI_Table.xlsx';
  console.log('Downloading UNDP HDI data (HDR2025)...');
  const xlsxBuf = await new Promise((resolve, reject) => {
    https.get(xlsxUrl, res => {
      if (res.statusCode !== 200) { reject(new Error('Download failed: ' + res.statusCode)); return; }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
  console.log(`Downloaded ${(xlsxBuf.length / 1024).toFixed(1)} KB`);
  const hdiData = parseHDIExcel(xlsxBuf);
  console.log(`Parsed ${hdiData.length} countries from HDI table`);

  // Build lookup
  const hdiByCountry = {};
  for (const r of hdiData) {
    hdiByCountry[r.country] = r;
  }

  // Download Natural Earth geometries
  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
  const ne50 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');

  const baseFeatures = ne110.features.filter(f => f.properties.ADMIN !== 'Antarctica');
  const adminSet = new Set(baseFeatures.map(f => f.properties.ADMIN));

  // Microstates from 50m
  const extra = [];
  for (const f of ne50.features) {
    const admin = f.properties.ADMIN;
    if (admin === 'Antarctica') continue;
    if (!adminSet.has(admin) && f.properties.TYPE === 'Sovereign country') {
      const g = JSON.parse(JSON.stringify(f.geometry));
      function rnd(c) {
        if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
        return c.map(rnd);
      }
      g.coordinates = rnd(g.coordinates);
      extra.push({ type: 'Feature', properties: f.properties, geometry: g });
    }
  }
  console.log(`Base 110m: ${baseFeatures.length}, extra microestados 50m: ${extra.length}`);
  const all = [...baseFeatures, ...extra];

  // Deduplicate
  const seen = new Set();
  const dedup = [];
  for (const f of all) {
    const a = f.properties.ADMIN;
    if (seen.has(a)) continue;
    seen.add(a); dedup.push(f);
  }

  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();
  let matched = 0, unmatched = 0;

  for (const raw of dedup) {
    const propsRaw = raw.properties;
    const admin = propsRaw.ADMIN;
    if (admin === 'Antarctica') continue;

    // Find HDI data for this NE admin
    let hdiRecord = null;

    // Exact match
    if (hdiByCountry[admin]) {
      hdiRecord = hdiByCountry[admin];
    } else {
      // Try reverse mapping
      for (const [hdiName, neName] of Object.entries(HDI_TO_NE)) {
        if (neName === admin && hdiByCountry[hdiName]) {
          hdiRecord = hdiByCountry[hdiName];
          break;
        }
      }
    }

    // If no match, try partial/fuzzy
    if (!hdiRecord) {
      for (const [hdiName, record] of Object.entries(hdiByCountry)) {
        const mapped = HDI_TO_NE[hdiName];
        if (mapped && mapped === admin) {
          hdiRecord = record;
          break;
        }
      }
    }

    // Further fallback: check if admin name contains or is contained in hdi name
    if (!hdiRecord) {
      for (const [hdiName, record] of Object.entries(hdiByCountry)) {
        if (admin.includes(hdiName) || hdiName.includes(admin)) {
          hdiRecord = record;
          break;
        }
      }
    }

    const hdiVal = hdiRecord ? hdiRecord.hdi : null;
    if (hdiRecord) matched++; else unmatched++;

    // Spanish name
    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = propsRaw.NAME || admin;

    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    // Ensure unique _manaName
    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) {
      dup++; uniqueEs = `${esName} (${dup})`;
    }
    seenNames.add(uniqueEs);

    const color = colorForHDI(hdiVal);
    const opacity = hdiVal == null ? 0.45 : 0.82;
    const category = hdiVal != null ? hdiCategory(hdiVal) : 'Sin datos';

    const lifeStr = hdiRecord && hdiRecord.lifeExpect ? hdiRecord.lifeExpect.toFixed(1) : 'N/D';
    const schoolStr = hdiRecord && hdiRecord.meanSchooling ? hdiRecord.meanSchooling.toFixed(1) : 'N/D';
    const expectedStr = hdiRecord && hdiRecord.expectedSchooling ? hdiRecord.expectedSchooling.toFixed(1) : 'N/D';
    const gniStr = hdiRecord && hdiRecord.gni ? hdiRecord.gni.toLocaleString('es') : 'N/D';
    const hdiStr = hdiVal != null ? hdiVal.toFixed(3) : 'Sin datos';
    const rankStr = hdiRecord ? `#${hdiRecord.rank}` : 'N/D';

    const description = hdiRecord
      ? `${uniqueEs} — IDH ${hdiStr} (${category}) — ${continente}`
      : `${uniqueEs} — sin datos de IDH — ${continente}`;

    // Simplify geometry
    const geom = raw.geometry;
    function roundCoords(c) {
      if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
      return c.map(roundCoords);
    }
    const simplifiedGeom = { type: geom.type, coordinates: roundCoords(geom.coordinates) };

    const feature = {
      type: 'Feature',
      properties: {
        _manaName: uniqueEs,
        name: admin,
        _manaColor: color,
        _manaFillOpacity: opacity,
        _manaWeight: 0.7,
        _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'IDH',
        _manaGroupId: 'idh',
        _manaLabelStyle: { fontSize: 11, fontFamily: 'DM Sans, sans-serif', fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF', placement: 'point' },
        'País': uniqueEs,
        'País (EN)': admin,
        'Continente': continente,
        'IDH (índice)': hdiVal != null ? hdiVal : null,
        'IDH': hdiStr,
        'Categoría': category,
        'Ranking IDH': rankStr,
        'Esperanza de vida': lifeStr + ' años',
        'Años medios de escolaridad': schoolStr + ' años',
        'Años esperados de escolaridad': expectedStr + ' años',
        'RNB per cápita (USD 2021 PPP)': gniStr + ' USD',
        'Fuente': 'UNDP Human Development Report 2025 — datos 2023',
        'Description': description,
        'Superficie': continente,
        'Dato': hdiStr,
      },
      geometry: simplifiedGeom,
    };
    geo.features.push(feature);
  }

  // Sort by HDI desc
  geo.features.sort((a, b) => (b.properties['IDH (índice)'] || 0) - (a.properties['IDH (índice)'] || 0));

  console.log(`Features: ${geo.features.length}, matched HDI: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['IDH (índice)']).filter(v => v != null);
  console.log(`HDI range: ${Math.min(...vals).toFixed(3)} — ${Math.max(...vals).toFixed(3)}`);

  return geo;
}

function buildMapPreview(geo) {
  // Preview fiel: usa todos los países como Polygon/MultiPolygon con más detalle.
  // No convertir a LineString (eso hacía que las miniaturas parezcan hilos).
  let bbox = [180, 90, -180, -90];
  function walk(coords) {
    if (typeof coords[0] === 'number') {
      const x = coords[0], y = coords[1];
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y; if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
    } else coords.forEach(walk);
  }
  geo.features.forEach(f => walk(f.geometry.coordinates));
  // Sampling ligero: 80 puntos por anillo preserva forma sin exceder Firestore.
  function sampleRing(ring, maxPts) {
    if (!ring || ring.length <= maxPts) return ring;
    const step = Math.ceil(ring.length / maxPts);
    const out = [];
    for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
    if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
    return out;
  }
  const previewFeatures = geo.features.map(f => {
    const g = f.geometry;
    let geom = null;
    if (g.type === 'Polygon') {
      geom = { type: 'Polygon', coordinatesText: JSON.stringify(g.coordinates.map(r => sampleRing(r, 80))) };
    } else if (g.type === 'MultiPolygon') {
      geom = { type: 'MultiPolygon', coordinatesText: JSON.stringify(g.coordinates.map(poly => poly.map(r => sampleRing(r, 80)))) };
    } else {
      // fallback genérico
      geom = { type: g.type, coordinatesText: JSON.stringify(g.coordinates) };
    }
    return { geometry: geom, color: f.properties._manaColor, emoji: null };
  });
  return { bbox, kind: 'geometry', gridSize: 8, cells: null, features: previewFeatures };
}

async function main() {
  const geo = await buildGeoJSON();
  const geojsonText = JSON.stringify(geo);
  console.log(`GeoJSON ${(geojsonText.length / 1024).toFixed(1)} KB, features ${geo.features.length}`);
  if (geojsonText.length > 1048576) { console.error('ERROR >1MiB'); process.exit(1); }

  // Validations AGENTS.md
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  console.log('hex valid', hexOk);
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle.haloWidth >= 2);
  console.log('haloWidth >=2', haloOk);
  const coordsOk = geo.features.every(f => {
    let ok = true;
    function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  console.log('coords within ±180/±90', coordsOk);
  const dupNames = new Set(geo.features.map(f => f.properties._manaName));
  console.log('unique names', dupNames.size === geo.features.length);

  // Save intermediate data
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'indice-desarrollo-humano-por-pais.geojson'), geojsonText);
  console.log('GeoJSON saved to data/indice-desarrollo-humano-por-pais.geojson');

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const docFields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr('Índice de Desarrollo Humano (IDH) por País'),
    name: fsStr('Índice de Desarrollo Humano (IDH) por País'),
    description: fsStr('Mapa coroplético mundial del Índice de Desarrollo Humano (IDH) por país con datos del UNDP Human Development Report 2025 (datos 2023). Muestra el IDH de 180 países, desde Noruega (0,970) hasta Sudán del Sur (0,388), junto con esperanza de vida, escolaridad y renta per cápita.'),
    lang: fsStr('es'),
    featureCount: fsInt(geo.features.length),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => fsNum(v)) } },
      kind: fsStr('geometry'),
      gridSize: fsInt(8),
      cells: fsNull(),
      features: { arrayValue: { values: preview.features.map(pf => fsMap({
        geometry: fsMap({ type: fsStr('LineString'), coordinatesText: fsStr(pf.geometry.coordinatesText) }),
        color: fsStr(pf.color),
        emoji: fsNull()
      })) } }
    }),
    visibility: fsStr('public'), shareMode: fsStr('view'), allowPublicEdit: fsBool(false), isPublished: fsBool(true),
    shareUrl: fsStr(`https://maña.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText), geojsonChunked: fsNull(),
    dataSource: fsStr('UNDP Human Development Report 2025 — Statistical Annex HDI Table (datos 2023). https://hdr.undp.org/data-center/human-development-index'),
    dataDate: fsStr('2025-05-06'),
    dataYear: fsInt(2025),
    tags: fsArr(['Desarrollo', 'Economía', 'Geografía']),
    legendKey: fsStr('IDH (índice)'),
    legendTitle: fsStr('Índice de Desarrollo Humano'),
    legendFormat: fsStr('number'),
    authorHandle: fsStr('maña-maps'), createdBy: fsStr('maña-maps'), ownerUid: fsStr('maña-maps'),
    createdAtMs: fsInt(now), updatedAtMs: fsInt(now), createdAt: serverNow, updatedAt: serverNow,
    views: fsInt(0), likes: fsInt(0)
  };

  if (DRY_RUN) {
    console.log('\n=== DRY RUN ===');
    const fieldNames = Object.keys(docFields);
    for (const fn of fieldNames) {
      const val = docFields[fn];
      if ('stringValue' in val) console.log(`  ${fn}: "${val.stringValue.substring(0, 120)}${val.stringValue.length > 120 ? '...' : ''}"`);
      else if ('integerValue' in val) console.log(`  ${fn}: ${val.integerValue}`);
      else if ('booleanValue' in val) console.log(`  ${fn}: ${val.booleanValue}`);
      else if ('nullValue' in val) console.log(`  ${fn}: null`);
      else if ('mapValue' in val) console.log(`  ${fn}: [map]`);
      else if ('arrayValue' in val) console.log(`  ${fn}: [array ${val.arrayValue.values.length} items]`);
    }
    return;
  }

  console.log('Authenticating...');
  const { token, uid } = await getAccessToken();
  if (uid) { docFields.createdBy = fsStr(uid); docFields.ownerUid = fsStr(uid); }
  console.log(`Checking /maps/${SLUG}...`);
  const existing = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (existing.status === 200) {
    console.log('Updating document...');
    const fieldPaths = Object.keys(docFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${fieldPaths}`, { fields: docFields });
    if (res.status >= 400) { console.error('Update failed', res.status, JSON.stringify(res.data).slice(0, 600)); process.exit(1); }
    console.log('Updated!');
  } else {
    console.log('Creating...');
    const res = await firestoreRequest(token, 'POST', `/${COLLECTION}?documentId=${SLUG}`, { fields: docFields });
    if (res.status >= 400) { console.error('Create failed', res.status, JSON.stringify(res.data).slice(0, 600)); process.exit(1); }
    console.log('Created!');
  }
  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status === 200) {
    console.log(`✓ isPublished ${verify.data.fields?.isPublished?.booleanValue}, featureCount ${verify.data.fields?.featureCount?.integerValue}`);
    const tags = verify.data.fields?.tags?.arrayValue?.values?.map(v => v.stringValue) || [];
    console.log(`✓ tags: ${tags.join(', ')}`);
    console.log(`✓ Gallery https://maña.com/gallery/?slug=${SLUG}`);
  }
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
