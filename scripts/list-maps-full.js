#!/usr/bin/env node
// ── list-maps-full.js ─ Lista todos los mapas con campos de autorización

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';

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
  return { idToken: res.data.idToken, localId: res.data.localId };
}

async function getAccessToken() {
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    const result = await firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
    console.log('Publisher uid:', result.localId);
    return result.idToken;
  }
  console.error('ERROR: No credentials found.');
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

async function main() {
  const token = await getAccessToken();
  console.log('Access token obtained.\n');

  const res = await firestoreRequest(token, 'GET', `/${COLLECTION}`);
  if (res.status !== 200) {
    console.error('Failed to list documents:', res.status);
    process.exit(1);
  }

  const docs = res.data.documents || [];
  console.log(`Found ${docs.length} documents:\n`);

  for (const doc of docs) {
    const name = doc.name.split('/').pop();
    const createdBy = extractField(doc, 'createdBy');
    const ownerUid = extractField(doc, 'ownerUid');
    const authorHandle = extractField(doc, 'authorHandle');
    const tags = extractField(doc, 'tags');
    const description = extractField(doc, 'description');
    const lang = extractField(doc, 'lang');

    console.log(`  ${name}`);
    console.log(`    createdBy: ${createdBy || 'NONE'}`);
    console.log(`    ownerUid: ${ownerUid || 'NONE'}`);
    console.log(`    authorHandle: ${authorHandle || 'NONE'}`);
    console.log(`    lang: ${lang || 'NONE'}`);
    console.log(`    tags: [${Array.isArray(tags) ? tags.join(', ') : tags || 'NONE'}]`);
    console.log(`    description: ${description ? (description.length > 60 ? description.substring(0, 60) + '...' : description) : 'NONE'}`);
    console.log('');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
