#!/usr/bin/env node
// ── publish-life-expectancy.js ─
// Mapa coroplético: Esperanza de Vida Mundial por País
// Fuente: World Bank / WHO (indicator SP.DYN.LE00.IN, datos 2023)
// Rampa secuencial monocromática azul claro→oscuro por años de vida
// Geometrías Natural Earth 110m + 50m
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SLUG = 'life-expectancy-world';
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

// ── World Bank country → Natural Earth ADMIN name mapping ──
const WB_TO_NE = {
  'United States': 'United States of America',
  'Turkiye': 'Turkey',
  'Viet Nam': 'Vietnam',
  'Lao PDR': 'Laos',
  'Syrian Arab Republic': 'Syria',
  'Russian Federation': 'Russia',
  'Iran, Islamic Rep.': 'Iran',
  'Korea, Rep.': 'South Korea',
  "Korea, Dem. People's Rep.": 'North Korea',
  'Egypt, Arab Rep.': 'Egypt',
  'Bolivia': 'Bolivia',
  'Venezuela, RB': 'Venezuela',
  'Tanzania': 'Tanzania',
  'Moldova': 'Moldova',
  'Micronesia, Fed. Sts.': 'Micronesia',
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
  'United Kingdom': 'United Kingdom',
  'Czechia': 'Czech Republic',
  "Cote d'Ivoire": "Côte d'Ivoire",
  'Gambia, The': 'Gambia',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
  'West Bank and Gaza': 'West Bank',
  'Yemen, Rep.': 'Yemen',
  'Kyrgyz Republic': 'Kyrgyzstan',
  'Slovak Republic': 'Slovakia',
  'Puerto Rico (US)': 'Puerto Rico',
  'Virgin Islands (U.S.)': 'United States Virgin Islands',
  'Hong Kong SAR, China': 'Hong Kong',
  'Macao SAR, China': 'Macao',
  'Singapore': 'Singapore',
  'Somalia, Fed. Rep.': 'Somalia',
  'Kosovo': 'Kosovo',
  'Sint Maarten (Dutch part)': 'Sint Maarten (Dutch part)',
  'St. Martin (French part)': 'St. Martin (French part)',
  'Channel Islands': 'Guernsey',
  'Isle of Man': 'Isle of Man',
  'Naoero': 'Nauru',
  'Curacao': 'Curaçao',
  'Faroe Islands': 'Faroe Islands',
  'Greenland': 'Greenland',
  'New Caledonia': 'New Caledonia',
  'French Polynesia': 'French Polynesia',
  'Aruba': 'Aruba',
  'Bermuda': 'Bermuda',
  'Cayman Islands': 'Cayman Islands',
  'British Virgin Islands': 'British Virgin Islands',
  'Turks and Caicos Islands': 'Turks and Caicos Islands',
  'Northern Mariana Islands': 'Northern Mariana Islands',
  'Guam': 'Guam',
  'American Samoa': 'American Samoa',
  'Gibraltar': 'Gibraltar',
  'San Marino': 'San Marino',
  'Andorra': 'Andorra',
  'Liechtenstein': 'Liechtenstein',
  'Monaco': 'Monaco',
  'Korea, Dem. People\'s Rep.': 'North Korea',
};

// Region codes to exclude from the World Bank data
const WB_REGIONS = new Set([
  'AFE','AFW','ARB','CSS','CEB','EAR','EAS','EAP','TEA','EMU','ECS','ECA','TEC',
  'EUU','HPC','IBD','IBT','IDB','IDX','IDA','LTE','LCN','LAC','TLA','LDC','LMY',
  'MEA','MNA','TMN','MIC','NAC','OED','OSS','PSS','PST','SAS','TSA','SSF','SSA',
  'TSS','WLD'
]);

const CONTINENT_ES = { Africa: 'África', Asia: 'Asia', Europe: 'Europa', 'North America': 'América del Norte', 'South America': 'América del Sur', Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano' };

// Rampa secuencial monocromática azul claro→oscuro por años de vida
const RAMP = [
  { max: 55, color: '#f7fbff' },
  { max: 60, color: '#deebf7' },
  { max: 65, color: '#c6dbef' },
  { max: 70, color: '#9ecae1' },
  { max: 75, color: '#6baed6' },
  { max: 80, color: '#4292c6' },
  { max: 85, color: '#2171b5' },
  { max: 100, color: '#084594' },
];
function colorForLE(le) {
  if (le == null || isNaN(le)) return '#d9d9d9';
  for (const s of RAMP) if (le <= s.max) return s.color;
  return RAMP[RAMP.length - 1].color;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function fetchJsonWB(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── Build GeoJSON ────────────────────────────────────────────
async function buildGeoJSON() {
  // 1. Fetch World Bank life expectancy data
  console.log('Fetching World Bank life expectancy data (SP.DYN.LE00.IN, 2023)...');
  const wbUrl = 'https://api.worldbank.org/v2/country/all/indicator/SP.DYN.LE00.IN?date=2023&format=json&per_page=300';
  const wbData = await fetchJsonWB(wbUrl);
  const wbEntries = wbData[1] || [];
  console.log(`World Bank returned ${wbEntries.length} entries`);

  // Build lookup by ISO3 code (for matching with Natural Earth)
  const wbByIso3 = {};
  for (const e of wbEntries) {
    if (e.value == null || !e.countryiso3code) continue;
    if (WB_REGIONS.has(e.countryiso3code)) continue;
    wbByIso3[e.countryiso3code] = {
      name: e.country.value,
      iso2: e.country.id,
      iso3: e.countryiso3code,
      lifeExpectancy: Math.round(e.value * 10) / 10,
    };
  }
  console.log(`Countries with data (non-region): ${Object.keys(wbByIso3).length}`);

  // 2. Fetch Natural Earth geometries
  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
  const ne50 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');

  const baseFeatures = ne110.features.filter(f => f.properties.ADMIN !== 'Antarctica');
  const adminSet = new Set(baseFeatures.map(f => f.properties.ADMIN));

  // Microstates from 50m not in 110m
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

  // NE ISO_A3 lookup for matching
  const neByIso3 = {};
  for (const f of dedup) {
    const iso3 = f.properties.ISO_A3;
    if (iso3 && iso3 !== '-99') neByIso3[iso3] = f;
  }

  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();
  let matched = 0, unmatched = 0;

  for (const raw of dedup) {
    const propsRaw = raw.properties;
    const admin = propsRaw.ADMIN;
    if (admin === 'Antarctica') continue;

    // Find life expectancy data for this country
    let wbRecord = null;

    // 1. Exact ISO3 match
    const iso3 = propsRaw.ISO_A3;
    if (iso3 && wbByIso3[iso3]) {
      wbRecord = wbByIso3[iso3];
    }

    // 2. Try ISO_A3_EH (estimated handler)
    if (!wbRecord && propsRaw.ISO_A3_EH && wbByIso3[propsRaw.ISO_A3_EH]) {
      wbRecord = wbByIso3[propsRaw.ISO_A3_EH];
    }

    // 3. Try reverse mapping from WB name to NE ADMIN
    if (!wbRecord) {
      for (const [wbName, neName] of Object.entries(WB_TO_NE)) {
        if (neName === admin) {
          // Find in wbByIso3 by name
          for (const [iso3, rec] of Object.entries(wbByIso3)) {
            if (rec.name === wbName) { wbRecord = rec; break; }
          }
          if (wbRecord) break;
        }
      }
    }

    // 4. Try name containment
    if (!wbRecord) {
      for (const [iso3, rec] of Object.entries(wbByIso3)) {
        if (admin.includes(rec.name) || rec.name.includes(admin)) {
          wbRecord = rec;
          break;
        }
      }
    }

    const leVal = wbRecord ? wbRecord.lifeExpectancy : null;
    if (wbRecord) matched++; else unmatched++;

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

    const color = colorForLE(leVal);
    const opacity = leVal == null ? 0.45 : 0.82;

    const leStr = leVal != null ? leVal.toFixed(1) : 'Sin datos';

    const description = wbRecord
      ? `${uniqueEs} — ${leStr} años — ${continente}`
      : `${uniqueEs} — sin datos de esperanza de vida — ${continente}`;

    // Simplify geometry: round coords to 2 decimals
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
        _manaGroupName: 'Esperanza de vida',
        _manaGroupId: 'esperanza-vida',
        _manaLabelStyle: {
          enabled: true,
          fontSize: 11,
          fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600',
          color: '#1e293b',
          haloWidth: 3,
          haloColor: '#FFFFFF',
          placement: 'point',
          field: '_manaName'
        },
        'País': uniqueEs,
        'País (EN)': admin,
        'Continente': continente,
        'Esperanza de vida (años)': leStr + ' años',
        'Esperanza de vida (num)': leVal,
        'Fuente': 'World Bank / WHO — Life expectancy at birth, total (2023)',
        'Description': description,
        'Superficie': continente,
        'Dato': leStr + ' años',
      },
      geometry: simplifiedGeom,
    };
    geo.features.push(feature);
  }

  // Sort by life expectancy desc (highest first)
  geo.features.sort((a, b) => (b.properties['Esperanza de vida (num)'] || 0) - (a.properties['Esperanza de vida (num)'] || 0));

  console.log(`Features: ${geo.features.length}, matched LE: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Esperanza de vida (num)']).filter(v => v != null);
  console.log(`LE range: ${Math.min(...vals).toFixed(1)} — ${Math.max(...vals).toFixed(1)} años`);

  return geo;
}

function buildMapPreview(geo) {
  let bbox = [180, 90, -180, -90];
  function walk(coords) {
    if (typeof coords[0] === 'number') {
      const x = coords[0], y = coords[1];
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y; if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
    } else coords.forEach(walk);
  }
  geo.features.forEach(f => walk(f.geometry.coordinates));
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
  fs.writeFileSync(path.join(dataDir, 'life-expectancy-world.geojson'), geojsonText);
  console.log('GeoJSON saved to data/life-expectancy-world.geojson');

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const docFields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr('Esperanza de Vida Mundial por País'),
    name: fsStr('Esperanza de Vida Mundial por País'),
    description: fsStr('Mapa coroplético mundial de la esperanza de vida al nacer por país con datos del World Bank / OMS (2023). Muestra los años de vida esperados en más de 200 países, desde Chad (52,5 años) hasta Japón (84,8 años), junto con la fuente y continente de cada nación.'),
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
    shareUrl: fsStr(`https://xn--maa-8ma.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText), geojsonChunked: fsNull(),
    dataSource: fsStr('World Bank / WHO — Life expectancy at birth, total (years). Indicator SP.DYN.LE00.IN. https://data.worldbank.org/indicator/SP.DYN.LE00.IN'),
    dataDate: fsStr('2023-12-31'),
    dataYear: fsInt(2023),
    tags: fsArr(['Salud', 'Geografía', 'Demografía']),
    legendKey: fsStr('Esperanza de vida (num)'),
    legendTitle: fsStr('Esperanza de vida al nacer (años)'),
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
    console.log(`✓ Gallery https://xn--maa-8ma.com/gallery/?slug=${SLUG}`);
  }
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
