#!/usr/bin/env node
// ── publish-cobertura-forestal.js ─
// Mapa coroplético: Cobertura Forestal por País
// Fuente: FAO Global Forest Resources Assessment vía World Bank (AG.LND.FRST.ZS)
// Rampa secuencial monocromática verde claro→oscuro por porcentaje
// 180 países con geometrías preexistentes en data/cobertura-forestal-por-pais.geojson
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SLUG = 'cobertura-forestal-por-pais';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Auth helpers (copy from publish-idh-world.js) ──
function loadADC() {
  const home = require('os').homedir();
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(home, '.config/gcloud/application_default_credentials.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    const abs = path.resolve(p); if (!fs.existsSync(abs)) continue;
    try { const c = JSON.parse(fs.readFileSync(abs, 'utf8')); if (c.type === 'authorized_user' && c.refresh_token) return c; if (c.type === 'service_account' && c.client_email && c.private_key) return c; } catch (_) { }
  }
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

// ── Green sequential ramp (light→dark) for forest coverage ──
function forestColor(pct) {
  if (pct == null) return '#d9d9d9'; // no data → grey
  // 9-step green ramp: lightest to darkest
  const stops = [
    [0,   '#edf8e9'],
    [10,  '#c7e9c0'],
    [20,  '#a1d99b'],
    [30,  '#74c476'],
    [40,  '#41ab5d'],
    [50,  '#238b45'],
    [60,  '#006d2c'],
    [70,  '#005a32'],
    [80,  '#00441b'],
  ];
  for (let i = stops.length - 1; i >= 0; i--) {
    if (pct >= stops[i][0]) return stops[i][1];
  }
  return '#00441b';
}

// ── Fetch World Bank forest coverage data ──
async function fetchForestData() {
  console.log('Fetching forest coverage data from World Bank API...');
  const data = {};
  const aggregates = new Set(['XD','AFE','AFW','ARB','CEB','CSS','EAP','EAR','EAS','ECA','ECS','EMU','EUU','HPC','IBD','IBT','IDA','IDB','IDX','LAC','LCN','LDC','LMY','LTE','MEA','MIC','MNA','NAC','OED','OSS','PRE','PSS','PST','SAS','SSA','SSF','SST','TEA','TEC','TLA','TMN','TSA','TSS','WLD']);

  for (let page = 1; page <= 3; page++) {
    const url = `https://api.worldbank.org/v2/country/all/indicator/AG.LND.FRST.ZS?format=json&per_page=500&date=2020:2023&page=${page}`;
    const res = await httpsRequest(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!Array.isArray(res.data) || res.data.length < 2) continue;
    for (const r of res.data[1]) {
      const iso3 = r.countryiso3code;
      const val = r.value;
      const date = r.date;
      const cid = r.country.id;
      const name = r.country.value;
      if (val != null && !aggregates.has(iso3) && iso3.length === 3 && /^[A-Z]{3}$/.test(iso3) && !(iso3 in data)) {
        data[iso3] = { value: Math.round(val * 10) / 10, date, name, id: cid };
      }
    }
  }
  console.log(`  → ${Object.keys(data).length} countries with data`);
  return data;
}

// ── ISO3 id lookup from country `id` (ISO2) to ISO3 in GeoJSON ──
// The GeoJSON features have `id` which is ISO3 (e.g. "AFG", "ZWE").
// World Bank returns countryiso3code (ISO3) and country.id (ISO2).

function buildMapPreview(geo) {
  let bbox = [180, 90, -180, -90];
  function walk(coords) {
    if (typeof coords[0] === 'number') {
      const x = coords[0], y = coords[1];
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
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
    let geom;
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
  // 1. Load existing GeoJSON
  const geoPath = path.join(__dirname, '..', 'data', 'cobertura-forestal-por-pais.geojson');
  if (!fs.existsSync(geoPath)) { console.error('ERROR: GeoJSON not found at', geoPath); process.exit(1); }
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  console.log(`Loaded ${geo.features.length} features from GeoJSON`);

  // 2. Fetch World Bank data
  const wbData = await fetchForestData();

  // 3. Join and update features
  let matched = 0, unmatched = 0;
  const unmatchedList = [];
  for (const f of geo.features) {
    const iso3 = f.id; // GeoJSON id is ISO3 (e.g. "AFG")
    const wb = wbData[iso3];
    if (wb) {
      matched++;
      const pct = wb.value;
      const pctStr = pct == null ? 'Sin datos' : `${pct.toFixed(1)}%`;
      f.properties['Cobertura forestal (%)'] = pctStr;
      f.properties['Dato'] = pctStr;
      f.properties['Año'] = wb.date;
      f.properties['Fuente'] = 'FAO Global Forest Resources Assessment / Banco Mundial (AG.LND.FRST.ZS)';
      f.properties._manaColor = forestColor(pct);
      // Update description
      const name = f.properties._manaName || f.properties.name;
      if (pct != null) {
        f.properties.Description = `${name} — cobertura forestal: ${pctStr} (${wb.date})`;
      } else {
        f.properties.Description = `${name} — sin datos de cobertura forestal`;
      }
    } else {
      unmatched++;
      unmatchedList.push(`${iso3} (${f.properties._manaName || f.properties.name})`);
    }
  }
  console.log(`Matched: ${matched}, Unmatched: ${unmatched}`);
  if (unmatchedList.length > 0) console.log('Unmatched:', unmatchedList.slice(0, 10).join(', '));

  // 4. Rebuild _manaLabelStyle for features that need it (ensure haloWidth >= 2)
  for (const f of geo.features) {
    if (!f.properties._manaLabelStyle) {
      f.properties._manaLabelStyle = { enabled: true, haloWidth: 2, fontSize: 11 };
    } else if (f.properties._manaLabelStyle.haloWidth < 2) {
      f.properties._manaLabelStyle.haloWidth = 2;
    }
  }

  // 5. Save updated GeoJSON locally
  const geojsonText = JSON.stringify(geo);
  console.log(`GeoJSON ${(geojsonText.length / 1024).toFixed(1)} KB, features ${geo.features.length}`);
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  // Save the updated file
  fs.writeFileSync(geoPath, geojsonText);
  console.log('Updated local GeoJSON with real data');

  // 6. Validations AGENTS.md
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  console.log('hex valid', hexOk);
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2);
  console.log('haloWidth >=2', haloOk);
  const coordsOk = geo.features.every(f => {
    let ok = true;
    function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  console.log('coords within ±180/±90', coordsOk);
  const dupNames = new Set(geo.features.map(f => f.properties._manaName));
  console.log('unique names', dupNames.size === geo.features.length);

  // 7. Build Firestore document
  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const docFields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr('Cobertura Forestal por País'),
    name: fsStr('Cobertura Forestal por País'),
    description: fsStr('Mapa coroplético mundial de la cobertura forestal por país con datos de la FAO Global Forest Resources Assessment (vía Banco Mundial). Muestra el porcentaje de superficie terrestre cubierta por bosques en 180 países, desde Surinam (94,4%) hasta Egipto y Catar (0,0%).'),
    lang: fsStr('es'),
    featureCount: fsInt(geo.features.length),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => fsNum(v)) } },
      kind: fsStr('geometry'),
      gridSize: fsInt(8),
      cells: fsNull(),
      features: { arrayValue: { values: preview.features.map(pf => fsMap({
        geometry: fsMap({ type: fsStr(pf.geometry.type), coordinatesText: fsStr(pf.geometry.coordinatesText) }),
        color: fsStr(pf.color),
        emoji: fsNull()
      })) } }
    }),
    visibility: fsStr('public'), shareMode: fsStr('view'), allowPublicEdit: fsBool(false), isPublished: fsBool(true),
    shareUrl: fsStr(`https://maña.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText), geojsonChunked: fsNull(),
    dataSource: fsStr('FAO Global Forest Resources Assessment (FRA) / Banco Mundial (indicador AG.LND.FRST.ZS). https://data.worldbank.org/indicator/AG.LND.FRST.ZS'),
    dataDate: fsStr('2024-01-01'),
    dataYear: fsInt(2024),
    tags: fsArr(['Naturaleza', 'Medio Ambiente']),
    legendKey: fsStr('Cobertura forestal (%)'),
    legendTitle: fsStr('Cobertura forestal (% de superficie terrestre)'),
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

  // 8. Authenticate and publish
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
