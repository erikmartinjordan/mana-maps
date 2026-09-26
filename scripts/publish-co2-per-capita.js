#!/usr/bin/env node
// ── publish-co2-per-capita.js ─
// Publica el mapa de emisiones de CO2 per capita en Firestore.
//
// GeoJSON fuente: data/co2-per-capita-world.geojson (170 países)
// Fuente de datos: Our World in Data (OWID) / IEA / CDIAC / Global Carbon Project
//
// Uso:
//   node scripts/publish-co2-per-capita.js [--dry-run]

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SLUG = 'co2-per-capita-world';
const DRY_RUN = process.argv.includes('--dry-run');

function loadADC() {
  const home = require('os').homedir();
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(home, '.config/gcloud/application_default_credentials.json'),
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
  if (credsPath) {
    const absPath = path.resolve(credsPath);
    if (fs.existsSync(absPath)) return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  }
  try {
    const home = require('os').homedir();
    for (const cand of [home + '/.publisher-credentials.json', '/home/erik/autopilot/.publisher-credentials.json']) {
      if (fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand, 'utf8'));
    }
  } catch(_){}
  return null;
}

async function firebaseAuthSignIn(email, password, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  return { idToken: res.data.idToken, uid: res.data.localId };
}

async function getAccessToken() {
  const sa = loadServiceAccount();
  if (sa) { console.log('Using service account.'); return { token: await getAccessTokenFromSA(sa), uid: null }; }
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher).');
    try {
      const result = await firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
      return { token: result.idToken, uid: result.uid };
    } catch(e) {
      console.log('Publisher auth failed:', e.message, '-> trying anonymous fallback');
    }
  }
  const adc = loadADC();
  if (adc) {
    try { console.log('Using ADC.'); return { token: await getAccessTokenFromADC(adc), uid: null }; }
    catch(e) { console.log('ADC failed:', e.message); }
  }
  console.error('ERROR: No authentication method available');
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

function loadGeoJSON() {
  const geoPath = path.join(__dirname, '..', 'data', 'co2-per-capita-world.geojson');
  if (!fs.existsSync(geoPath)) {
    console.error('ERROR: GeoJSON not found at', geoPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(geoPath, 'utf8');
  const geojson = JSON.parse(raw);
  console.log(`Loaded ${geojson.features.length} features from ${path.basename(geoPath)}`);
  return geojson;
}

function buildMapPreview(geojson) {
  const PREVIEW_GRID_SIZE = 8;
  let bbox = [180, 90, -180, -90];
  for (const f of geojson.features) {
    const coords = [];
    collectCoords(f.geometry, coords);
    for (const c of coords) {
      if (c[0] < bbox[0]) bbox[0] = c[0];
      if (c[1] < bbox[1]) bbox[1] = c[1];
      if (c[0] > bbox[2]) bbox[2] = c[0];
      if (c[1] > bbox[3]) bbox[3] = c[1];
    }
  }
  const previewFeatures = geojson.features.map(f => {
    const coords = [];
    collectCoords(f.geometry, coords);
    const maxPreviewCoords = 40;
    const step = Math.max(1, Math.floor(coords.length / maxPreviewCoords));
    const simplified = [];
    for (let i = 0; i < coords.length; i += step) simplified.push(coords[i]);
    if (simplified.length < 2) simplified.push(coords[coords.length - 1]);
    return {
      geometry: { type: 'Polygon', coordinatesText: JSON.stringify(simplified) },
      color: f.properties._manaColor,
      emoji: null
    };
  });
  return { bbox, kind: 'geometry', gridSize: PREVIEW_GRID_SIZE, cells: null, features: previewFeatures };
}

function collectCoords(geom, out) {
  if (!geom || !geom.coordinates) return;
  if (geom.type === 'Polygon') {
    if (geom.coordinates[0]) for (const c of geom.coordinates[0]) out.push(c);
  } else if (geom.type === 'MultiPolygon') {
    let largest = null, maxArea = 0;
    for (const poly of geom.coordinates) {
      if (!poly || !poly[0]) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of poly[0]) {
        if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
      }
      const area = (maxX - minX) * (maxY - minY);
      if (area > maxArea) { maxArea = area; largest = poly; }
    }
    if (largest) for (const c of largest[0]) out.push(c);
  } else if (geom.type === 'LineString') {
    for (const c of geom.coordinates) out.push(c);
  } else if (geom.type === 'Point') {
    out.push(geom.coordinates);
  }
}

async function main() {
  console.log('Loading GeoJSON...');
  const geojson = loadGeoJSON();
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
    title: fsStr('Emisiones de CO2 per capita por pais'),
    name: fsStr('Emisiones de CO2 per capita por pais'),
    description: fsStr('Mapa coro\u00f3ple\u00f3tico de las emisiones de di\u00f3xido de carbono per c\u00e1pita por pa\u00eds en todo el mundo, con datos de 170 naciones. Muestra qui\u00e9n contamina realmente por habitante, desde Burundi (0,05 t) hasta Qatar (41 t).'),
    lang: fsStr('es'),
    featureCount: fsInt(geojson.features.length),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => fsNum(v)) } },
      kind: fsStr('geometry'),
      gridSize: fsInt(8),
      cells: fsNull(),
      features: { arrayValue: { values: preview.features.map(pf => fsMap({
        geometry: fsMap({
          type: fsStr('Polygon'),
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
    shareUrl: fsStr(`https://ma\u00f1a.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText),
    geojsonChunked: fsNull(),
    dataSource: fsStr('Our World in Data (OWID) / IEA / CDIAC / Global Carbon Project (ourworldindata.org)'),
    dataDate: fsStr('2024-01-01'),
    tags: fsArr(['Clima', 'Medio ambiente', 'Geograf\u00eda', 'Emisiones']),
    legendKey: fsStr('Emisiones CO2 per c\u00e1pita (num)'),
    legendTitle: fsStr('Toneladas de CO2 por persona'),
    legendFormat: fsStr('number'),
    authorHandle: fsStr('ma\u00f1a-maps'),
    createdBy: fsStr('ma\u00f1a-maps'),
    ownerUid: fsStr('ma\u00f1a-maps'),
    createdAtMs: fsInt(now),
    updatedAtMs: fsInt(now),
    createdAt: serverNow,
    updatedAt: serverNow,
    views: fsInt(0),
    likes: fsInt(0)
  };

  if (DRY_RUN) {
    console.log('\n=== DRY RUN ===');
    console.log('Slug:', SLUG);
    console.log('Features:', geojson.features.length);
    console.log('Size:', (geojsonText.length / 1024).toFixed(1), 'KB');
    return;
  }

  console.log('Authenticating...');
  const { token, uid } = await getAccessToken();
  if (uid) {
    docFields.createdBy = fsStr(uid);
    docFields.ownerUid = fsStr(uid);
  }

  console.log(`Checking if /maps/${SLUG} exists...`);
  const existing = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (existing.status === 200) {
    console.log('Document exists. Updating...');
    const fieldPaths = Object.keys(docFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${fieldPaths}`, { fields: docFields });
    if (res.status >= 400) { console.error('Update failed:', res.status); process.exit(1); }
    console.log('Updated successfully!');
  } else {
    console.log('Creating new document...');
    const res = await firestoreRequest(token, 'POST', `/${COLLECTION}?documentId=${SLUG}`, { fields: docFields });
    if (res.status >= 400) { console.error('Create failed:', res.status); process.exit(1); }
    console.log('Created successfully!');
  }

  console.log('Verifying...');
  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status === 200) {
    const isPublished = verify.data.fields?.isPublished?.booleanValue;
    const fc = verify.data.fields?.featureCount?.integerValue;
    console.log(`✓ isPublished: ${isPublished}, featureCount: ${fc}`);
    console.log(`✓ Gallery URL: https://ma\u00f1a.com/gallery/?slug=${SLUG}`);
  } else {
    console.error('Verification failed:', verify.status);
  }
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
