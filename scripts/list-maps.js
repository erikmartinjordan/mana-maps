#!/usr/bin/env node
// ── list-maps.js ─ Lista todos los mapas en Firestore (colección 'maps')
// con sus tags, description, lang para verificar el estado actual.

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';

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

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  const token = await getAccessToken();
  console.log('Access token obtained.\n');

  // List all docs in the collection
  const res = await firestoreRequest(token, 'GET', `/${COLLECTION}`);
  if (res.status !== 200) {
    console.error('Failed to list documents:', res.status, JSON.stringify(res.data).substring(0, 500));
    process.exit(1);
  }

  const docs = res.data.documents || [];
  console.log(`Found ${docs.length} documents in '${COLLECTION}' collection:\n`);

  const maps = docs.map(doc => {
    const name = doc.name.split('/').pop();
    return {
      slug: name,
      title: extractField(doc, 'title'),
      description: extractField(doc, 'description'),
      lang: extractField(doc, 'lang'),
      tags: extractField(doc, 'tags'),
      isPublished: extractField(doc, 'isPublished'),
      featureCount: extractField(doc, 'featureCount'),
      shareUrl: extractField(doc, 'shareUrl'),
    };
  });

  // Sort by slug
  maps.sort((a, b) => a.slug.localeCompare(b.slug));

  for (const m of maps) {
    const tags = Array.isArray(m.tags) ? m.tags.join(', ') : (m.tags || 'NONE');
    const desc = m.description ? (m.description.length > 80 ? m.description.substring(0, 80) + '...' : m.description) : 'NONE';
    console.log(`  ${m.slug}`);
    console.log(`    title: ${m.title || 'NONE'}`);
    console.log(`    lang: ${m.lang || 'NONE'}`);
    console.log(`    tags: [${tags}]`);
    console.log(`    description: ${desc}`);
    console.log(`    isPublished: ${m.isPublished}`);
    console.log(`    featureCount: ${m.featureCount}`);
    console.log('');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
