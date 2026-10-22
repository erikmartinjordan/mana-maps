#!/usr/bin/env node
// ── publish-submarine-fiber-cables.js ─────────────────────────────────────
// Actualiza el mapa `submarine-fiber-cables` en Firestore a partir de
// data/submarine-fiber-cables.geojson:
//   · cables en servicio → azul (#1D4ED8)
//   · Pan-Arctic Cable (en proyecto) → naranja (#EA580C)
//   · leyenda categórica por «Estado»
// Fuente de los cables en servicio: TeleGeography / submarinecablemap.com.
// Pan-Arctic Cable: Comisión Europea (20-10-2026), Euronews y heise online;
// el trazado es indicativo porque la ruta no está fijada.
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SLUG = 'submarine-fiber-cables';
const ROOT = path.join(__dirname, '..');
const GEO_PATH = path.join(ROOT, 'data', 'submarine-fiber-cables.geojson');
const DRY_RUN = process.argv.includes('--dry-run');

const COLOR_EXISTING = '#1D4ED8';
const COLOR_PLANNED = '#EA580C';

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: (options && options.method) || 'GET',
      headers: (options && options.headers) || {}
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, data: d, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function loadPublisherCredentials() {
  const candidates = [
    process.env.PUBLISHER_CREDENTIALS,
    path.join(require('os').homedir(), '.publisher-credentials.json'),
    '/home/erik/autopilot/.publisher-credentials.json',
    '/Users/Erik/autopilot/.publisher-credentials.json',
    '/Users/erik/autopilot/.publisher-credentials.json'
  ].filter(Boolean);
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand, 'utf8'));
    } catch (_) {}
  }
  return null;
}

async function getAccessToken() {
  const pub = loadPublisherCredentials();
  if (!pub || !pub.email || !pub.password || !pub.apiKey) {
    throw new Error('No hay credenciales de publicación (~/autopilot/.publisher-credentials.json)');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${pub.apiKey}`;
  const body = JSON.stringify({ email: pub.email, password: pub.password, returnSecureToken: true });
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200 || !res.data.idToken) {
    throw new Error(`Firebase Auth falló (${res.status}): ${JSON.stringify(res.data).slice(0, 400)}`);
  }
  return { token: res.data.idToken, uid: res.data.localId };
}

function firestoreRequest(token, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
    const u = new URL(url);
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, data: d, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function fsStr(v) { return { stringValue: String(v) }; }
function fsInt(v) { return { integerValue: String(v) }; }
function fsNum(v) { return Number.isInteger(v) ? fsInt(v) : { doubleValue: v }; }
function fsNull() { return { nullValue: null }; }
function fsMap(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = fsNull();
    else if (typeof v === 'string') fields[k] = fsStr(v);
    else if (typeof v === 'number') fields[k] = fsNum(v);
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map(x => {
      if (typeof x === 'string') return fsStr(x);
      if (typeof x === 'number') return fsNum(x);
      if (typeof x === 'boolean') return { booleanValue: x };
      if (x && typeof x === 'object') return fsMap(x);
      return fsNull();
    }) } };
    else if (typeof v === 'object') fields[k] = fsMap(v);
    else fields[k] = fsStr(String(v));
  }
  return { mapValue: { fields } };
}
function fsArr(arr) { return { arrayValue: { values: arr.map(v => (typeof v === 'string') ? fsStr(v) : fsNum(v)) } }; }

function buildPreview(geo) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'map-preview.js'), 'utf8'), context, { filename: 'map-preview.js' });
  const lib = context.window.ManaMapPreview;
  if (!lib || typeof lib.build !== 'function') throw new Error('ManaMapPreview no disponible');
  return lib.build(geo);
}

function validate(geo) {
  const errors = [];
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) errors.push('GeoJSON inválido');
  const names = new Set();
  const coordsOk = geo.features.every(f => {
    let ok = true;
    (function walk(c) {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false;
      } else if (Array.isArray(c)) c.forEach(walk);
    })(f.geometry.coordinates);
    return ok;
  });
  if (!coordsOk) errors.push('coordenadas fuera de ±180/±90');
  for (const f of geo.features) {
    const p = f.properties || {};
    if (!/^#[0-9a-fA-F]{6}$/.test(p._manaColor || '')) errors.push(`${p._manaName}: color inválido`);
    if (!p._manaLabelStyle || !(p._manaLabelStyle.haloWidth >= 2)) errors.push(`${p._manaName}: labelStyle incompleto`);
    if (names.has(p._manaName)) errors.push(`nombre duplicado: ${p._manaName}`);
    names.add(p._manaName);
  }
  const colors = new Set(geo.features.map(f => f.properties._manaColor));
  if (colors.size !== 2) errors.push(`se esperaban 2 colores, hay ${colors.size}`);
  if (!colors.has(COLOR_EXISTING) || !colors.has(COLOR_PLANNED)) errors.push('faltan los colores existente/planificado');
  const planned = geo.features.filter(f => f.properties.Estado === 'En proyecto');
  if (planned.length !== 1) errors.push(`se esperaba 1 cable en proyecto, hay ${planned.length}`);
  return errors;
}

async function main() {
  const geo = JSON.parse(fs.readFileSync(GEO_PATH, 'utf8'));
  const errors = validate(geo);
  const geojsonText = JSON.stringify(geo);
  console.log(`features: ${geo.features.length} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`colores: ${[...new Set(geo.features.map(f => f.properties._manaColor))].join(', ')}`);
  if (errors.length) { console.error('VALIDACIÓN FALLIDA:\n- ' + errors.join('\n- ')); process.exit(1); }
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1 MiB'); process.exit(1); }

  const preview = buildPreview(geo);
  if (!preview || !Array.isArray(preview.features) || !preview.features.length) {
    console.error('ERROR: no se pudo construir mapPreview');
    process.exit(1);
  }
  console.log(`preview: ${preview.features.length} features, bbox ${preview.bbox.map(n => n.toFixed(2)).join(', ')}`);

  const now = Date.now();
  const docFields = {
    geojsonText: fsStr(geojsonText),
    geojsonChunked: fsNull(),
    featureCount: fsInt(geo.features.length),
    description: fsStr('Cables troncales de fibra óptica submarina en servicio (azul) y el Pan-Arctic Cable en proyecto (naranja), con trazado indicativo entre Groenlandia y Europa. Cada cable en servicio sigue la curva del gran círculo entre puntos de aterrizaje; la ruta del cable en proyecto no está fijada por la Comisión Europea.'),
    dataSource: fsStr('TeleGeography / submarinecablemap.com (puntos de aterrizaje oficiales) — trazado interpolado por gran círculo; Comisión Europea (20-10-2026), Euronews y heise online para el Pan-Arctic Cable (trazado indicativo); GEBCO/NOAA para contexto oceánico'),
    dataDate: fsStr('2026-10-20'),
    legendKey: fsStr('Estado'),
    legendTitle: fsStr('Estado del cable'),
    legendFormat: fsStr('category'),
    legend: fsMap({
      title: 'Estado del cable',
      steps: [
        { v: 1, c: COLOR_EXISTING, label: 'En servicio' },
        { v: 2, c: COLOR_PLANNED, label: 'En proyecto' }
      ]
    }),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => fsNum(v)) } },
      kind: fsStr(preview.kind || 'geometry'),
      gridSize: preview.gridSize == null ? fsNull() : fsInt(preview.gridSize),
      cells: preview.cells ? fsMap({}) : fsNull(),
      features: {
        arrayValue: {
          values: preview.features.map(pf => fsMap({
            geometry: fsMap({ type: pf.geometry.type, coordinatesText: pf.geometry.coordinatesText }),
            color: pf.color,
            emoji: pf.emoji ? pf.emoji : null,
            fillOpacity: typeof pf.fillOpacity === 'number' ? pf.fillOpacity : null
          }))
        }
      }
    }),
    updatedAtMs: fsInt(now),
    updatedAt: { timestampValue: new Date().toISOString() }
  };

  if (DRY_RUN) {
    console.log('\n=== DRY RUN ===');
    for (const [k, v] of Object.entries(docFields)) {
      if ('stringValue' in v) console.log(`  ${k}: "${v.stringValue.slice(0, 120)}${v.stringValue.length > 120 ? '...' : ''}"`);
      else if ('integerValue' in v) console.log(`  ${k}: ${v.integerValue}`);
      else if ('nullValue' in v) console.log(`  ${k}: null`);
      else if ('mapValue' in v) console.log(`  ${k}: [map]`);
      else if ('arrayValue' in v) console.log(`  ${k}: [array ${v.arrayValue.values.length}]`);
    }
    return;
  }

  console.log('Autenticando…');
  const { token, uid } = await getAccessToken();
  console.log(`uid: ${uid}`);
  const fieldPaths = Object.keys(docFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${fieldPaths}`, { fields: docFields });
  if (res.status >= 400) {
    console.error('PATCH falló', res.status, JSON.stringify(res.data).slice(0, 800));
    process.exit(1);
  }
  console.log('Documento actualizado.');

  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status === 200) {
    const f = verify.data.fields || {};
    const vgeo = JSON.parse(f.geojsonText.stringValue);
    const colors = {};
    vgeo.features.forEach(x => { colors[x.properties._manaColor] = (colors[x.properties._manaColor] || 0) + 1; });
    console.log(`✓ featureCount ${f.featureCount.integerValue} | legendKey ${f.legendKey.stringValue} | ${f.legendFormat.stringValue}`);
    console.log(`✓ colores ${JSON.stringify(colors)}`);
    console.log('✓ https://maña.com/gallery/?slug=' + SLUG);
  }
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
