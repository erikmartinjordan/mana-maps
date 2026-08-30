#!/usr/bin/env node
// ── debug-auth.js ─ Debug authentication to understand the 403 issue

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';

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

async function main() {
  const pub = loadPublisherCredentials();
  if (!pub) { console.error('No publisher credentials'); process.exit(1); }

  // Sign in
  const body = JSON.stringify({ email: pub.email, password: pub.password, returnSecureToken: true });
  const res = await httpsRequest(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${pub.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    body
  );
  
  console.log('Auth response status:', res.status);
  if (res.status !== 200) { console.error('Auth failed:', JSON.stringify(res.data)); process.exit(1); }
  
  const { idToken, localId, refreshToken } = res.data;
  console.log('localId (uid):', localId);
  console.log('idToken length:', idToken.length);
  
  // Decode JWT payload
  const parts = idToken.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  console.log('\nJWT payload:');
  console.log('  sub (uid):', payload.sub);
  console.log('  iss:', payload.iss);
  console.log('  aud:', payload.aud);
  console.log('  email:', payload.email);
  console.log('  exp:', new Date(payload.exp * 1000).toISOString());
  
  // Now try to get the map document to check its current state
  const DATABASE = '(default)';
  const COLLECTION = 'maps';
  const slug = 'active-volcanoes-world';
  
  const docRes = await httpsRequest(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents/${COLLECTION}/${slug}`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${idToken}` } }
  );
  
  console.log(`\nGET /${COLLECTION}/${slug}: status ${docRes.status}`);
  if (docRes.status === 200) {
    const createdBy = docRes.data.fields?.createdBy?.stringValue;
    const ownerUid = docRes.data.fields?.ownerUid?.stringValue;
    console.log('  createdBy:', createdBy || 'NOT SET');
    console.log('  ownerUid:', ownerUid || 'NOT SET');
    console.log('  createdBy matches localId:', createdBy === localId);
    console.log('  createdBy matches JWT sub:', createdBy === payload.sub);
  } else {
    console.log('  Error:', JSON.stringify(docRes.data).substring(0, 300));
  }
  
  // Now try a minimal PATCH - just updating tags on active-volcanoes-world
  console.log('\n--- Attempting PATCH ---');
  const updateBody = {
    fields: {
      createdBy: docRes.data.fields?.createdBy || { stringValue: localId },
      tags: { arrayValue: { values: [{ stringValue: 'Naturaleza' }, { stringValue: 'Volcanes' }, { stringValue: 'Geología' }] } }
    }
  };
  const patchUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents/${COLLECTION}/${slug}?updateMask.fieldPaths=createdBy&updateMask.fieldPaths=tags`;
  const patchRes = await httpsRequest(patchUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(updateBody))
    }
  }, JSON.stringify(updateBody));
  
  console.log('PATCH status:', patchRes.status);
  if (patchRes.status >= 400) {
    console.log('PATCH error:', JSON.stringify(patchRes.data).substring(0, 500));
  } else {
    console.log('PATCH success!');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
