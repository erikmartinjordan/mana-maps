#!/usr/bin/env node
// ── publish-bibliotecas-barcelona.js ─
// Mapa de puntos: Bibliotecas públicas de Barcelona
// Fuente: Ajuntament de Barcelona — Opèndata (Espais amb biblioteca o sala d'estudi)
// Cada punto = una biblioteca, coloreada por distrito
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SLUG = 'bibliotecas-barcelona';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Auth helpers (reused from publish-population.js) ──────────
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
  console.error('ERROR: No credentials available'); process.exit(1);
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
const FS_VALUE_KEYS = ['stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'nullValue', 'mapValue', 'arrayValue', 'timestampValue'];
function isFsValue(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && FS_VALUE_KEYS.indexOf(Object.keys(v)[0]) !== -1; }
function fsMap(obj) { const fields = {}; for (const [k, v] of Object.entries(obj)) { if (isFsValue(v)) fields[k] = v; else if (v === null || v === undefined) fields[k] = fsNull(); else if (typeof v === 'string') fields[k] = fsStr(v); else if (typeof v === 'number') fields[k] = fsNum(v); else if (typeof v === 'boolean') fields[k] = fsBool(v); else if (Array.isArray(v)) fields[k] = fsArr(v); else if (typeof v === 'object') fields[k] = fsMap(v); else fields[k] = fsStr(String(v)); } return { mapValue: { fields } }; }

// ── District color palette (warm sequential by district density) ──
const DISTRICT_COLORS = {
  'Ciutat Vella': '#b91c1c',           // deep red (most libraries)
  'Eixample': '#dc2626',               // red
  'Les Corts': '#ea580c',              // orange
  'Sarrià-Sant Gervasi': '#f97316',    // orange-light
  'Sants-Montjuïc': '#eab308',         // yellow
  'Horta-Guinardó': '#84cc16',         // lime
  'Sant Martí': '#22c55e',             // green
  'Gràcia': '#14b8a6',                 // teal
  'Sant Andreu': '#06b6d4',            // cyan
  'Nou Barris': '#3b82f6',             // blue
  '': '#94a3b8',                       // grey for unknown
};
const DISTRICT_COLORS_LIGHT = {
  'Ciutat Vella': '#fecaca',
  'Eixample': '#fecaca',
  'Les Corts': '#ffedd5',
  'Sarrià-Sant Gervasi': '#ffedd5',
  'Sants-Montjuïc': '#fef9c3',
  'Horta-Guinardó': '#ecfccb',
  'Sant Martí': '#dcfce7',
  'Gràcia': '#ccfbf1',
  'Sant Andreu': '#cffafe',
  'Nou Barris': '#dbeafe',
  '': '#f1f5f9',
};

// District population data (for density calculation, Barcelona 2024)
const DISTRICT_POP = {
  'Ciutat Vella': 103000,
  'Eixample': 266000,
  'Les Corts': 82000,
  'Sarrià-Sant Gervasi': 149000,
  'Sants-Montjuïc': 184000,
  'Horta-Guinardó': 164000,
  'Sant Martí': 237000,
  'Gràcia': 123000,
  'Sant Andreu': 151000,
  'Nou Barris': 165000,
};

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

function extractStreetAddress(r) {
  const road = (r.addresses_road_name || '').trim();
  const num = r.addresses_start_street_number;
  if (road && num) return `${road}, ${num}`;
  if (road) return road;
  return '';
}

// Cleans the network's equipment name and fixes the known "J.V. Foix" entry.
function normalizeLibraryName(name) {
  const clean = String(name || 'Biblioteca')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.replace(/^Biblioteca Sarrià J\.?\s*V\.?\s*Foix$/i, 'Biblioteca Sarrià - J. V. Foix');
}

// Barcelona postal codes are 5 digits and start with 08. The inventory stores
// some without the leading zero and a couple are truncated, so normalize and
// drop the invalid ones.
function normalizeZip(zip) {
  const digits = String(zip == null ? '' : zip).replace(/\D/g, '');
  let code = '';
  if (digits.length === 4) code = '0' + digits;
  else if (digits.length === 5) code = digits;
  if (!/^08\d{3}$/.test(code) || code === '08000') return '';
  return code;
}

// Barcelona city bounding box (with margin) used to reject broken coordinates.
const BARCELONA_BBOX = { minLat: 41.2, maxLat: 41.6, minLon: 1.9, maxLon: 2.4 };

function insideBarcelona(lat, lon) {
  return !isNaN(lat) && !isNaN(lon)
    && lat >= BARCELONA_BBOX.minLat && lat <= BARCELONA_BBOX.maxLat
    && lon >= BARCELONA_BBOX.minLon && lon <= BARCELONA_BBOX.maxLon;
}

// Enriches a library with the closest address from the "biblioteques i museus"
// inventory (the network dataset has no street address). Only used when the
// nearest record is within 150 m so we never attach a wrong address.
function nearestAddressRecord(lon, lat, records) {
  let best = null, bestDist = Infinity;
  for (const r of records) {
    const rlon = parseFloat(r.geo_epgs_4326_lon);
    const rlat = parseFloat(r.geo_epgs_4326_lat);
    if (!insideBarcelona(rlat, rlon)) continue;
    const dx = (lon - rlon) * Math.cos((lat * Math.PI) / 180) * 111000;
    const dy = (lat - rlat) * 111000;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return bestDist <= 150 ? best : null;
}

// Sequential monochromatic ramp (light → dark) for the choropleth.
const CHORO_RAMP = ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'];
function choroColor(value, min, max) {
  if (max <= min) return CHORO_RAMP[CHORO_RAMP.length - 1];
  const t = (value - min) / (max - min);
  const idx = Math.max(0, Math.min(CHORO_RAMP.length - 1, Math.round(t * (CHORO_RAMP.length - 1))));
  return CHORO_RAMP[idx];
}

// ── Build GeoJSON ────────────────────────────────────────────
async function buildGeoJSON() {
  const resourceUrl = 'https://opendata-ajuntament.barcelona.cat/data/api/3/action/datastore_search';

  // 1. Authoritative public-library network of Barcelona (Biblioteques de
  // Barcelona). The generic "library or study room" inventory also contains
  // museums, associations, churches and clubs, so we use the official network.
  console.log('Fetching Biblioteques de Barcelona network from Opèndata...');
  const xarxaFields = 'Latitud,Longitud,Nom_Equipament,Titularitat,Nom_Districte,Nom_Barri,Tipus_Us';
  const xarxaUrl = `${resourceUrl}?resource_id=9dbd5010-970d-4308-89ec-4088a90ea9d8&limit=500&fields=${xarxaFields}`;
  const xarxa = await fetchJson(xarxaUrl);
  if (!xarxa.success) throw new Error('Libraries network API request failed');

  const byName = new Map();
  for (const r of xarxa.result.records) {
    if (r.Tipus_Us !== 'Biblioteques de Barcelona' || !r.Nom_Equipament) continue;
    if (!byName.has(r.Nom_Equipament)) byName.set(r.Nom_Equipament, r);
  }
  const records = [...byName.values()];
  console.log(`Fetched ${xarxa.result.records.length} rows -> ${records.length} libraries`);

  // 2. Address inventory (the network dataset has no street). Used only to
  // enrich popups by matching the closest record.
  const addrFields = 'addresses_road_name,addresses_start_street_number,addresses_district_name,addresses_neighborhood_name,addresses_zip_code,geo_epgs_4326_lat,geo_epgs_4326_lon,institution_name,name';
  const addrFilter = encodeURIComponent(JSON.stringify({ secondary_filters_name: 'Biblioteques' }));
  const addrUrl = `${resourceUrl}?resource_id=d4803f9b-5f01-48d5-aeef-4ebbd76c5fd7&filters=${addrFilter}&limit=300&fields=${addrFields}`;
  let addressRecords = [];
  try {
    const addr = await fetchJson(addrUrl);
    if (addr.success) addressRecords = addr.result.records;
  } catch (e) {
    console.warn('address inventory unavailable:', e.message);
  }

  // 3. Count libraries per district
  const districtCounts = {};
  for (const r of records) {
    const d = (r.Nom_Districte || '').trim();
    districtCounts[d] = (districtCounts[d] || 0) + 1;
  }
  console.log('Libraries per district:');
  for (const [d, c] of Object.entries(districtCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${d || '(sin distrito)'}: ${c}`);
  }

  // 4. Build GeoJSON features
  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();

  for (const r of records) {
    const lat = parseFloat(r.Latitud);
    const lon = parseFloat(r.Longitud);
    if (!insideBarcelona(lat, lon)) {
      console.warn(`  skipped library outside Barcelona: ${r.Nom_Equipament}`);
      continue;
    }

    const displayName = normalizeLibraryName(r.Nom_Equipament);
    let uniqueName = displayName;
    let dup = 1;
    while (seenNames.has(uniqueName)) {
      dup++;
      uniqueName = `${displayName} (${dup})`;
    }
    seenNames.add(uniqueName);

    const district = (r.Nom_Districte || '').trim();
    const neighborhood = (r.Nom_Barri || '').trim();
    const holder = (r.Titularitat || '').trim();

    const addr = nearestAddressRecord(lon, lat, addressRecords) || {};
    const street = extractStreetAddress(addr);
    const zip = normalizeZip(addr.addresses_zip_code);

    const districtCount = districtCounts[district] || 0;
    const districtPop = DISTRICT_POP[district] || 150000;
    const density = districtCount > 0 ? (districtCount / (districtPop / 100000)).toFixed(1) : '0';
    const color = DISTRICT_COLORS[district] || '#94a3b8';

    const addressParts = [street, district ? `Dist. ${district}` : '', neighborhood].filter(Boolean).join(', ');
    const description = `Biblioteca pública ${displayName}${addressParts ? '. ' + addressParts : ''}${zip ? ' (' + zip + ')' : ''}. ${districtCount} bibliotecas de la red en ${district || 'Barcelona'}.`;

    const feature = {
      type: 'Feature',
      properties: {
        _manaName: uniqueName,
        name: displayName,
        _manaColor: color,
        _manaFillOpacity: 0.85,
        _manaWeight: 1.5,
        _manaBorderColor: '#ffffff',
        _manaGroupName: 'Bibliotecas de Barcelona',
        _manaGroupId: 1,
        _manaGeometryType: 'point',
        _manaMarkerType: 'emoji_library',
        _manaEmojiSize: 24,
        _manaLabelStyle: {
          enabled: true,
          field: '_manaName',
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: '600',
          color: '#0f172a',
          haloWidth: 3,
          haloColor: '#ffffff',
          opacity: 0.9,
          placement: 'auto',
        },
        'Biblioteca': uniqueName,
        'Dirección': street || '—',
        'Distrito': district || '—',
        'Barrio': neighborhood || '—',
        'Código Postal': zip || '—',
        'Titularidad': holder || '—',
        'Bibliotecas en su distrito': districtCount,
        'Bibliotecas por 100k hab.': parseFloat(density),
        'Description': description,
        'Superficie': district || 'Barcelona',
        'Dato': `${districtCount} en ${district || 'Barcelona'}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [Math.round(lon * 1000000) / 1000000, Math.round(lat * 1000000) / 1000000],
      },
    };
    geo.features.push(feature);
  }

  const libraryCount = geo.features.length;
  console.log(`Libraries: ${libraryCount}`);

  // 5. Merge the official city and neighbourhood boundaries. The geometry is
  // pre-simplified/dissolved with shapely (scripts/build-barcelona-boundaries.py)
  // to keep the Firestore document under 1 MiB.
  const boundariesPath = path.join(__dirname, '..', 'data', 'barcelona-boundaries.geojson');
  if (fs.existsSync(boundariesPath)) {
    const boundaries = JSON.parse(fs.readFileSync(boundariesPath, 'utf8'));
    if (boundaries && Array.isArray(boundaries.features) && boundaries.features.length) {
      geo.features.push(...boundaries.features);
      console.log(`Added ${boundaries.features.length} boundary features`);
    }
  } else {
    console.warn('Boundaries not found. Run: python3 scripts/build-barcelona-boundaries.py');
  }
  geo._libraryCount = libraryCount;

  // 6. Paint districts as a choropleth by number of public libraries.
  const districtFeatures = geo.features.filter(f => f.properties._manaGroupName === 'Distritos de Barcelona');
  if (districtFeatures.length) {
    const countByDistrict = districtCounts;
    const values = Object.values(countByDistrict);
    const minCount = Math.min(...values);
    const maxCount = Math.max(...values);
    for (const d of districtFeatures) {
      const count = countByDistrict[d.properties.name] || 0;
      d.properties['Bibliotecas en distrito'] = count;
      d.properties['Dato'] = `${count} en ${d.properties.name}`;
      d.properties['Description'] = `Distrito de ${d.properties.name} (Barcelona). ${count} biblioteca${count === 1 ? '' : 's'} pública${count === 1 ? '' : 's'}.`;
      d.properties._manaColor = choroColor(count, minCount, maxCount);
      d.properties._manaBorderColor = '#334155';
      d.properties._manaFillOpacity = 0.55;
      d.properties._manaWeight = 1.4;
    }
    console.log(`District choropleth range: ${minCount}–${maxCount}`);
  }

  // Calculate bbox over every geometry type (points and polygons)
  let bbox = [180, 90, -180, -90];
  const visitCoords = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < bbox[0]) bbox[0] = x;
      if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x;
      if (y > bbox[3]) bbox[3] = y;
      return;
    }
    coords.forEach(visitCoords);
  };
  geo.features.forEach(f => visitCoords(f.geometry && f.geometry.coordinates));
  const pad = 0.01;
  bbox = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad];
  geo._bbox = bbox;

  return geo;
}

const PREVIEW_EMOJI = { emoji_library: '\u{1F4DA}' };
const PREVIEW_TOLERANCE = 0.0003; // ~33 m: suficiente para una miniatura

// Douglas–Peucker simplification (shape preserving) for the stored thumbnail.
function simplifyRingForPreview(ring, tol) {
  if (!Array.isArray(ring) || ring.length <= 4) return ring;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length <= 3) return ring;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [x1, y1] = pts[first], [x2, y2] = pts[last];
    const dx = x2 - x1, dy = y2 - y1;
    const norm = Math.hypot(dx, dy) || 1e-12;
    let maxD = -1, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = pts[i];
      const d = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > first) { keep[idx] = true; stack.push([first, idx], [idx, last]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  if (closed) out.push(out[0]);
  return out;
}

function simplifyGeometryForPreview(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(r => simplifyRingForPreview(r, PREVIEW_TOLERANCE)) };
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(poly => poly.map(r => simplifyRingForPreview(r, PREVIEW_TOLERANCE))) };
  }
  return geometry;
}

function buildMapPreview(geo) {
  const bbox = geo._bbox || [-180, -90, 180, 90];
  // Mirror the shared preview renderer: keep polygons (districts/limits) and
  // points (with their emoji + fill opacity) so the stored thumbnail matches
  // the live gallery preview.
  const previewFeatures = geo.features.map(f => {
    const props = f.properties || {};
    const simplified = simplifyGeometryForPreview(f.geometry);
    const entry = {
      geometry: { type: simplified.type, coordinatesText: JSON.stringify(simplified.coordinates) },
      color: props._manaColor || '#0ea5e9',
    };
    const markerType = props._manaMarkerType || '';
    if (markerType.indexOf('emoji_') === 0 && PREVIEW_EMOJI[markerType]) entry.emoji = PREVIEW_EMOJI[markerType];
    if (typeof props._manaFillOpacity === 'number') entry.fillOpacity = props._manaFillOpacity;
    return entry;
  });
  const preview = { bbox, kind: 'geometry', gridSize: null, cells: null, features: previewFeatures };
  if (geo.manaPreviewStyle === 'dark') preview.theme = 'dark';
  return preview;
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
  const validCoord = (coords) => {
    if (!Array.isArray(coords)) return true;
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      return x >= -180 && x <= 180 && y >= -90 && y <= 90;
    }
    return coords.every(validCoord);
  };
  const coordsOk = geo.features.every(f => validCoord(f.geometry && f.geometry.coordinates));
  console.log('coords within ±180/±90', coordsOk);
  const uniqueNames = new Set(geo.features.map(f => f.properties._manaName));
  console.log('unique names', uniqueNames.size === geo.features.length);

  // Save intermediate GeoJSON
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'bibliotecas-barcelona.geojson'), geojsonText);
  console.log('GeoJSON saved to data/bibliotecas-barcelona.geojson');

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };

  const dataSourceText = 'Ajuntament de Barcelona — Opèndata: Dades de la xarxa de biblioteques de la ciutat de Barcelona (dades-xarxa-biblioteques-catalunya, 2025). Direcciones cruzadas con el inventario «Espais amb biblioteca o sala d\'estudi i museístics» (culturailleure-bibliotequesimuseus).';

  const docFields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr('Bibliotecas públicas de Barcelona'),
    name: fsStr('Bibliotecas públicas de Barcelona'),
    description: fsStr('Mapa de las 41 bibliotecas públicas de la red municipal de Barcelona (Biblioteques de Barcelona) sobre los 10 distritos, pintados en coropletas según el número de bibliotecas. Incluye datos de dirección, distrito, barrio y titularidad. Fuente: Opèndata del Ayuntamiento de Barcelona.'),
    lang: fsStr('es'),
    featureCount: fsInt(geo._libraryCount || geo.features.length),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => fsNum(v)) } },
      kind: fsStr(preview.kind),
      theme: preview.theme ? fsStr(preview.theme) : fsNull(),
      gridSize: preview.gridSize == null ? fsNull() : fsInt(preview.gridSize),
      cells: preview.cells ? fsArr(preview.cells) : fsNull(),
      features: { arrayValue: { values: preview.features.map(pf => fsMap({
        geometry: fsMap({ type: fsStr(pf.geometry.type), coordinatesText: fsStr(pf.geometry.coordinatesText) }),
        color: fsStr(pf.color),
        emoji: pf.emoji ? fsStr(pf.emoji) : fsNull(),
        fillOpacity: typeof pf.fillOpacity === 'number' ? fsNum(pf.fillOpacity) : fsNull()
      })) } }
    }),
    visibility: fsStr('public'), shareMode: fsStr('view'), allowPublicEdit: fsBool(false), isPublished: fsBool(true),
    shareUrl: fsStr(`https://xn--maa-8ma.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText), geojsonChunked: fsNull(),
    dataSource: fsStr(dataSourceText),
    dataDate: fsStr('2026-09-29'),
    dataYear: fsInt(2026),
    tags: fsArr(['Cultura', 'Educación', 'Barcelona']),
    legendKey: fsStr('Bibliotecas en distrito'),
    legendTitle: fsStr('Bibliotecas por distrito'),
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
    // Keep the original creation metadata and engagement counters on updates.
    ['views', 'likes', 'createdAt', 'createdAtMs'].forEach(f => { delete docFields[f]; });
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
